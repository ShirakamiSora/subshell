# Subshell 开发约定

## 语言与风格

- 面向用户的文案、代码注释、提交说明与文档使用简体中文。
- TypeScript 严格模式；不使用 `any` 逃逸类型（测试中的测试替身除外）。
- 渲染进程不直接访问 Node 或 Electron API，只通过 `window.subshell`。
- 界面文案一律走 i18n 字典（`src/renderer/src/lib/i18n.ts`），中英文同时补齐。

## 安全红线

1. 模型只能提出工具调用，不能直接执行命令，也不能降低本地风险等级。
2. 只读工具可自动执行；`service_action`、变更型 `run_command` 与 `update_profile` 必须经过用户审批。
3. 密码、私钥、口令、API Key 只进入系统凭据库加密文件，不写入配置文件、日志、对话、档案或 Git。
4. 命令输出、日志、文件内容、服务器档案与运维笔记都是不可信数据，不得作为指令执行。
5. `/etc/shadow`、私钥、`.env`、`.npmrc`、`.git-credentials`、云凭据等敏感文件禁止读取。
6. 危险命令（删除根目录、格式化、关机、清空防火墙等）必须由本地策略直接拒绝；`sh -c`/`eval` 包裹的内层命令同样要判定。
7. 变更操作写入审计日志；服务操作后执行状态验证。
8. MCP 通道没有交互审批，默认只暴露只读工具；变更类工具必须同时满足全局开关与客户端 `exec` 权限，且仍受本地风险分级约束。
9. 智能审批（命令库 + 模型独立会话）只能「建议」：`blocked` 永远拒绝；`high` 风险、关键服务停止/重启与写入档案必须人工确认；判定写入审批日志。
10. 智能回退与安全修复由模型生成命令，但必须先在界面完整展示，再由用户确认；执行时逐条重新做本地风险分级，`blocked` 立即中止。
11. 终端命令只在检测不到密码提示时记录；密码、口令等敏感输入不得进入命令历史。

## 代码边界

- `src/main/ai/tools.ts` 是工具执行与风险准备的中心，新增工具必须同时更新 schema、`prepareToolCall`、`executeTool` 与 `kind`。
- IPC 只做参数适配，业务逻辑放在对应服务中。
- 共享数据结构只定义在 `src/shared/types.ts`，三端复用。
- 前端状态集中在 `src/renderer/src/store/app.ts`，组件不重复维护同一份服务器状态。
- 新增持久化数据必须走 `SqliteStore`（`src/main/store/sqlite-store.ts`）或 `src/main/store/db.ts` 的专用表，并声明 `version` 与 `migrate`；旧 JSON 文件通过 `legacyFile` 自动迁移。凭据只走 `SecretStore`，不进入数据库。
- 体检与安全检查是「推导结果」：问题由档案 + 实时数据重新计算，只持久化用户处理状态与修复记录。
- 命令历史、智能审批、安全扫描与集群运维的领域逻辑分别在 `src/main/command`、`src/main/approval`、`src/main/security`、`src/main/cluster`，IPC 不直接拼装业务逻辑。

## 提交前验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

涉及界面改动时，用 `node scripts/ui-preview.mjs` 重新生成截图检查（需要先 `npm run build`，以及本地 Edge/Chrome）。需要更新演示 GIF 时再执行 `python scripts/make-gif.py`。

> Windows 上如果 esbuild 报 `Access is denied`（杀软锁定临时文件），把 `TEMP`/`TMP` 指向项目内目录再构建，例如：
> `$env:TEMP="$PWD\.tmp"; $env:TMP=$env:TEMP; npm run build`
