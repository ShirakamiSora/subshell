# 架构说明

## 进程模型

```
┌──────────────────────────── Electron 主进程（Node.js） ────────────────────────────┐
│  AppContext                                                                        │
│  ├── Store：settings / servers / secrets / providers / profiles / runtime / chat / audit │
│  │        health（问题处理状态 + 工单）/ tunnels                                    │
│  ├── SshManager ── SshConnection（连接池、命令队列、shell、SFTP、forwardOut）        │
│  ├── MonitorService（采样定时器、服务/端口/进程快照、告警检测）                      │
│  ├── ReconService（只读侦察 → 结构化档案）                                          │
│  ├── HealthService（体检报告聚合、工单记录）                                        │
│  ├── SftpService（浏览、预览、上传下载）                                            │
│  ├── TunnelService（本地端口转发）                                                  │
│  ├── McpServer（JSON-RPC over HTTP，仅回环 + Token）                                │
│  ├── AgentService（模型循环、工具执行、审批、事件投影）                              │
│  └── DemoServer（内置模拟 SSH 主机）                                                │
│         │ IPC（ipcMain.handle + webContents.send）                                  │
└─────────┼──────────────────────────────────────────────────────────────────────────┘
          │
┌─────────▼──────────── Preload（contextBridge） ────────────┐
│  window.subshell：类型化 API + 事件订阅                    │
└─────────┬──────────────────────────────────────────────────┘
          │
┌─────────▼──────────────── 渲染进程（React） ────────────────┐
│  zustand store ← 事件流（连接/监控/Agent/档案/体检）        │
│  概览 / 体检 / 文件 / 终端 / AI 助手 / 设置 / 审计           │
└─────────────────────────────────────────────────────────────┘
```

**所有特权操作都在主进程**：SSH、凭据解密、文件写入、模型请求、监控。渲染进程没有 Node 集成、开启 sandbox，只通过白名单 IPC 通信。

## 目录结构

```
src/
  shared/              主进程与渲染进程共享的类型与 API 契约
    types.ts           数据模型（ServerConfig / ServerProfile / HealthReport / RemoteEntry ...）
    api.ts             window.subshell 接口与事件类型
  main/
    index.ts           应用入口、窗口、CSP、事件转发
    context.ts         聚合根：构造存储与服务，连接自动流程
    ipc.ts             IPC 命令适配
    ssh/               连接、命令执行、交互 shell、SFTP、端口转发通道
    recon/             侦察脚本、输出解析、档案构建、远端同步
    monitor/           指标采集、CPU 差分、告警检测
    health/            体检报告聚合（纯函数）与 HealthService
    sftp/              文件传输门面（列目录、预览、上传下载、增删改）
    tunnel/            本地端口转发（127.0.0.1 监听 → SSH forwardOut）
    mcp/               MCP 服务器（JSON-RPC over HTTP，只读白名单 + Token）
    update/            版本检查（GitHub Releases）
    ai/
      providers/       OpenAI / Anthropic / Mock 适配器 + 超时重试
      agent.ts         Agent 循环、审批等待、上下文预算
      tools.ts         工具目录、执行、结果裁剪
      risk.ts          命令/服务操作风险分级、敏感路径校验、嵌套命令解析
      prompt.ts        系统提示构建
    store/             JSON 存储（带版本迁移）、凭据、运行时缓存、审计、体检状态
    demo/              内置模拟 SSH 服务器
  preload/             contextBridge API
  renderer/            React 界面
tests/                 vitest 单元与集成测试
scripts/               UI 截图（ui-preview.mjs）、GIF 合成、图标生成
```

## 一次连接的生命周期

1. 渲染进程调用 `connection.connect(serverId)`。
2. `SshManager` 读取服务器配置与系统凭据库中的秘密，构造 `SshConnection`。
3. 主机指纹首次记录；后续不匹配则拒绝连接。
4. 连接成功 → 状态事件 → 自动流程：
   - 启动监控采样（立即一次，之后按间隔）
   - 若开启自动侦察且没有档案 → 执行只读侦察
   - 若开启 AI 摘要 → 延迟生成初始状态摘要
5. 侦察输出按 `##SECTION` 分段解析 → 构建档案 → 保存并推送事件。
6. 监控每 60 秒刷新服务/端口/进程快照，比较前后状态产生服务事件。

## AI Agent 循环

```
用户消息
  → 构建系统提示（档案 + 实时指标 + 服务 + 告警 + 安全规则）
  → 按 token 预算裁剪历史（保留最近 12 轮，超长轮次舍弃早期工具输出）
  → 模型流式响应（单次 180 秒超时，429/5xx 指数退避重试）
  → 若返回工具调用：
       逐条执行
         只读工具 → 直接执行
         变更工具 → 事件通知前端 → 等待用户审批 → 执行 / 拒绝
         执行结果回传模型
  → 模型继续（最多 64 轮 / 30 分钟）
  → 无工具调用或 finish → 结束
```

**工具调用状态**：`pending → awaiting_approval → running → done / error / rejected`。

**上下文管理**：按 `contextWindow × 0.6` 估算 token 预算，保留最近 12 个用户轮次；工具结果裁剪到 4000 字符；单轮过长时从最早的工具段整段舍弃，并追加一行提示。系统提示每次循环重建以反映最新状态。

**审批绑定**：审批只对当前运行、当前工具调用 ID 生效；取消运行时所有待审批自动拒绝。勾选「本次会话始终允许该命令」后会写入**会话级**白名单（按服务器、按完全相同的命令字符串），清空对话或重启应用才失效。

**工单回写**：从体检报告发起的运行会带上 `issueId`，每条变更类工具执行后写一条 `TicketRecord`，用于事后复盘。

## 风险分级

| 级别 | 行为 |
| --- | --- |
| `read` | 自动执行（可配置关闭） |
| `low` | 审批；启动/重启/重载服务 |
| `medium` | 审批；文件修改、停止普通服务、包安装、通用命令 |
| `high` | 审批并醒目标记；递归删除、停止关键服务、修改账户、防火墙变更、下载即执行 |
| `blocked` | 直接拒绝；删除根目录、格式化、关机、Fork 炸弹、清空防火墙 |

本地判定与模型声明取较高者；模型无法降低风险。`sh -c` / `eval` / `bash -lc` / `python -c` 包裹的内层命令会被递归解析（最多 3 层），任一层命中高危即整体升级。

**智能审批**只看 `kind`：只有 `kind = service` 且风险为 `low` 的操作会自动执行；`kind = write`（写档案）与 `kind = command`（任意命令）始终需要确认。

## 体检报告

`health/report.ts` 是纯函数：把「档案风险 + 未确认监控事件（7 天内）+ failed 服务 + 未完成检查项」合成为问题列表，按 `100 - 严重×15 - 警告×6 - 提示×1` 计算健康分（下限 0）。

- 指向同一失败服务的档案风险会被跳过，避免重复。
- 持久化只保存 `health.json`（用户处理状态）与 `tickets.json`（执行记录），问题本身每次重新推导，服务器恢复后自动消失。

## 内置 MCP 服务器

- 仅监听 `127.0.0.1`，所有请求要求 `Authorization: Bearer <token>`（Token 存在系统凭据库）。
- 默认只暴露只读工具；`service_action` / `run_command` 需在设置中显式开启。
- 没有交互审批通道，因此需要审批的调用直接返回错误；`blocked` 一律拒绝。
- 每个工具都要求显式传入 `server`（名称或 ID），防止外部 agent 误操作到别的机器。

## 数据一致性

- JSON 存储采用「临时文件 + rename」原子写入，并带 `__version` 与迁移函数。
- 监控样本内存优先，30 秒批量落盘，避免高频写盘。
- 对话消息同步写盘（每次更新全量重写，数据量小）。
- 审计日志只追加，不修改历史。
- 旧版本数据（无 `__version` 的裸 JSON）在首次读取时自动迁移并写回。

## 扩展点

- **新模型协议**：实现 `Provider` 接口并在 `providers/index.ts` 注册。
- **新工具**：在 `tools.ts` 的 `TOOL_DEFINITIONS` 增加 schema，在 `prepareToolCall`（含 `kind`）与 `executeTool` 增加处理分支。
- **新的采集项**：扩展 `recon/script.ts` 与 `parse.ts`，把结果写入档案（脚本开头必须 `export LC_ALL=C`）。
- **其他服务管理器**：在 `ServiceInfo.kind` 增加类型，并在侦察/操作层适配。
- **新持久化数据**：使用 `JsonStore` 并声明 `version` 与 `migrate`。
