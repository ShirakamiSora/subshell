# 待开发事项

> 记录已确认、但尚未排期开发的事项。每条都写清楚现状（代码事实）、目标、验收标准与实现要点，
> 目的是换一个会话、换一个人也能直接开工。

| 编号 | 事项 | 优先级 | 状态 |
| --- | --- | --- | --- |
| 1 | Prompt 缓存命中率（含用量采集与展示） | 高 | 已完成（0.3.6） |

---

## 1. Prompt 缓存命中率

**优先级**：高　**状态**：已完成（0.3.6）

> 实现位置：`src/main/ai/prompt.ts`（稳定段/实时段拆分与版本指纹）、
> `src/main/ai/agent.ts`（实时段附加到最后一条用户消息）、
> `src/main/ai/providers/anthropic.ts`（显式 `cache_control`）、
> `src/main/ai/providers/openai.ts`（解析缓存 token）、
> `tests/prompt.test.ts`（稳定段一致性）。下方背景保留作历史记录。

### 背景

`agent.ts` 的 `runLoop` 每一轮都会调用 `buildSystemPrompt` 重建系统提示，而这份提示里混入了
实时指标、服务快照与最近告警（`prompt.ts` 的「实时状态」「服务概况」「最近告警」三段）。
结果是：同一会话内连续多轮，系统提示几乎每轮都不一样，任何前缀缓存都会失效。

同时，两家 provider 的适配层都没有处理缓存：

- `anthropic.ts` 把 system 拼成纯字符串放进 `body.system`，没有使用 `cache_control`，
  因此 Anthropic 侧不会产生任何缓存读写。
- `openai.ts` 只读 `prompt_tokens` / `completion_tokens`，没有读
  `prompt_tokens_details.cached_tokens`。
- `anthropic.ts` 只读 `input_tokens` / `output_tokens`，没有读
  `cache_read_input_tokens` / `cache_creation_input_tokens`。
- `shared/types` 与界面的用量只展示输入/输出 token，缓存情况完全不可观测。

也就是说：现在的状况不是「命中率下降」，而是「既没有做缓存，也没有采集缓存数据」。

### 目标

1. 把系统提示拆成**稳定段**与**易变段**，让稳定前缀在多轮之间字节一致。
2. Anthropic 侧显式声明缓存断点（`cache_control`）；OpenAI 侧保证前缀稳定以吃到自动缓存。
3. 采集并展示缓存用量，能看到命中率。
4. 用同一组任务对比改动前后的输入 token 成本与首 token 延迟。

### 验收标准

- 同一会话中，从第 2 轮起 Anthropic 返回的 `cache_read_input_tokens > 0`。
- 界面的 AI 助手用量区与「用量」弹窗显示 `缓存命中率 = cached / input`。
- 固定任务集（见投递计划里的评测集）跑两版，输入 token 成本下降 ≥ 30%，且任务成功率不下降。
- 单测：档案与设置未变时，稳定段函数输出字节完全一致；档案变更时稳定段版本号递增。

### 实现要点

- `prompt.ts` 拆成两个函数：
  - `buildStablePrompt(context)`：身份、工作方式、安全边界、工具说明、档案综述（不含实时数值）。
  - `buildLiveContext(context)`：CPU / 内存 / 磁盘 / 负载 / 进程数 / 服务状态 / 最近告警。
- 稳定段缓存键：`profile.hash + server.id + language`。档案未变则复用上一份字符串与版本号。
- 易变段放到消息序列末尾（最后一条 user 消息的附加上下文，或单独的 system 消息），
  不要放进被缓存的前缀里。
- `anthropic.ts`：`system` 改为 content blocks，在稳定段末尾加
  `cache_control: { type: "ephemeral" }`；注意最小可缓存长度与 TTL 以官方文档为准。
- `openai.ts`：解析 `prompt_tokens_details.cached_tokens`；`openai.ts` 的前缀要保证
  system 在前、工具定义稳定（以官方文档的前缀匹配规则为准）。
- `shared/types`：`usage` 增加 `cachedInputTokens`，并同步 IPC 与界面文案（中英文都要补）。
- 上下文裁剪（`toProviderMessages`）触发时前缀会变，需要在事件里标注「本轮缓存失效原因」，
  否则命中率排查会很痛苦。

### 相关位置

- `src/main/ai/agent.ts:204`（每轮重建系统提示）
- `src/main/ai/prompt.ts`
- `src/main/ai/providers/anthropic.ts:78`（`body.system`）
- `src/main/ai/providers/openai.ts:94`（usage 解析）
- `src/shared/types.ts`（usage 结构）
