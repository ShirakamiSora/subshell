# 架构说明

## 进程模型

```
┌──────────────────────────── Electron 主进程（Node.js） ────────────────────────────┐
│  AppContext                                                                        │
│  ├── Store：settings / servers / secrets / providers / profiles / runtime / chat / audit │
│  ├── SshManager ── SshConnection（连接池、命令队列、shell、SFTP）                    │
│  ├── MonitorService（采样定时器、服务/端口/进程快照、告警检测）                      │
│  ├── ReconService（只读侦察 → 结构化档案）                                          │
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
│  zustand store ← 事件流（连接/监控/Agent/档案）             │
│  概览 / 终端 / AI 助手 / 设置 / 审计                         │
└─────────────────────────────────────────────────────────────┘
```

**所有特权操作都在主进程**：SSH、凭据解密、文件写入、模型请求、监控。渲染进程没有 Node 集成，只通过白名单 IPC 通信。

## 目录结构

```
src/
  shared/              主进程与渲染进程共享的类型与 API 契约
    types.ts           数据模型（ServerConfig / ServerProfile / AgentToolCall ...）
    api.ts             window.subshell 接口与事件类型
  main/
    index.ts           应用入口、窗口、事件转发
    context.ts         聚合根：构造存储与服务，连接自动流程
    ipc.ts             IPC 命令适配
    ssh/               连接、命令执行、交互 shell、连接测试
    recon/             侦察脚本、输出解析、档案构建、远端同步
    monitor/           指标采集、CPU 差分、告警检测
    ai/
      providers/       OpenAI / Anthropic / Mock 适配器
      agent.ts         Agent 循环、审批等待、上下文构建
      tools.ts         工具目录、执行、结果裁剪
      risk.ts          命令/服务操作风险分级、敏感路径校验
      prompt.ts        系统提示构建
    store/             JSON 存储、凭据、运行时缓存、审计
    demo/              内置模拟 SSH 服务器
  preload/             contextBridge API
  renderer/            React 界面
tests/                 vitest 单元与集成测试
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
  → 模型流式响应
  → 若返回工具调用：
       逐条执行
         只读工具 → 直接执行
         变更工具 → 事件通知前端 → 等待用户审批 → 执行 / 拒绝
         执行结果回传模型
  → 模型继续（最多 12 轮）
  → 无工具调用或 finish → 结束
```

**工具调用状态**：`pending → awaiting_approval → running → done / error / rejected`。

**上下文管理**：保留最近 12 个用户轮次；工具结果裁剪到 4000 字符；系统提示每次循环重建以反映最新状态。

**审批绑定**：审批只对当前运行、当前工具调用 ID 生效；取消运行时所有待审批自动拒绝。同一会话内可勾选“始终允许该命令”，仅对完全相同的命令字符串生效。

## 风险分级

| 级别 | 行为 |
| --- | --- |
| `read` | 自动执行（可配置关闭） |
| `low` | 审批；启动/重启/重载服务、更新档案 |
| `medium` | 审批；文件修改、停止普通服务、包安装、通用命令 |
| `high` | 审批并醒目标记；递归删除、停止关键服务、修改账户、防火墙变更 |
| `blocked` | 直接拒绝；删除根目录、格式化、关机、Fork 炸弹、清空防火墙 |

本地判定与模型声明取较高者；模型无法降低风险。

## 数据一致性

- JSON 存储采用「临时文件 + rename」原子写入。
- 监控样本内存优先，30 秒批量落盘，避免高频写盘。
- 对话消息先落内存、5 秒防抖写盘。
- 审计日志只追加，不修改历史。

## 扩展点

- **新模型协议**：实现 `Provider` 接口并在 `providers/index.ts` 注册。
- **新工具**：在 `tools.ts` 的 `TOOL_DEFINITIONS` 增加 schema，在 `prepareToolCall` 与 `executeTool` 增加处理分支。
- **新的采集项**：扩展 `recon/script.ts` 与 `parse.ts`，把结果写入档案。
- **其他服务管理器**：在 `ServiceInfo.kind` 增加类型，并在侦察/操作层适配。
