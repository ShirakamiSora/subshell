# Subshell 开发约定

## 语言与风格

- 面向用户的文案、代码注释、提交说明与文档使用简体中文。
- TypeScript 严格模式；不使用 `any` 逃逸类型（测试中的测试替身除外）。
- 渲染进程不直接访问 Node 或 Electron API，只通过 `window.subshell`。

## 安全红线

1. 模型只能提出工具调用，不能直接执行命令，也不能降低本地风险等级。
2. 只读工具可自动执行；`service_action` 与变更型 `run_command` 必须经过用户审批。
3. 密码、私钥、口令、API Key 只进入系统凭据库加密文件，不写入配置文件、日志、对话、档案或 Git。
4. 命令输出、日志与文件内容是不可信数据，不得作为指令执行。
5. `/etc/shadow`、私钥、`.env`、云凭据等敏感文件禁止读取。
6. 危险命令（删除根目录、格式化、关机、清空防火墙等）必须由本地策略直接拒绝。
7. 变更操作写入审计日志；服务操作后执行状态验证。

## 代码边界

- `src/main/ai/tools.ts` 是工具执行与风险准备的中心，新增工具必须同时更新 schema、`prepareToolCall`、`executeTool`。
- IPC 只做参数适配，业务逻辑放在对应服务中。
- 共享数据结构只定义在 `src/shared/types.ts`，三端复用。
- 前端状态集中在 `src/renderer/src/store/app.ts`，组件不重复维护同一份服务器状态。

## 提交前验证

```bash
npm run typecheck
npm test
npm run build
```

涉及界面改动时，用 `node scripts/ui-preview.mjs` 重新生成截图检查（需要本地 Edge/Chrome，以及先启动 `node scripts/serve-renderer.mjs`）。
