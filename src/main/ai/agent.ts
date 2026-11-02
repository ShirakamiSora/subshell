import { EventEmitter } from 'node:events';
import type {
  AgentRunStatus,
  AgentStreamEvent,
  AgentToolCall,
  ApprovalDecision,
  ChatMessage,
  CommandAnalysis,
  ProviderConfig,
  RiskLevel,
  ServerConfig,
} from '../../shared/types';
import type { SshManager } from '../ssh/manager';
import type { ServerStore } from '../store/servers';
import type { ProfileStore } from '../store/profile-store';
import type { RuntimeStore } from '../store/runtime-store';
import type { ChatStore } from '../store/chat-store';
import type { AuditStore } from '../store/audit';
import type { SettingsStore } from '../store/settings';
import type { ProviderStore } from '../store/provider-store';
import type { MonitorService } from '../monitor/collector';
import type { HealthService } from '../health/service';
import type { Provider, ProviderMessage } from './providers/types';
import { buildPromptParts, buildSystemPrompt } from './prompt';
import { classifyCommand } from './risk';import type { SmartApprovalService } from '../approval/service';
import type { CommandService } from '../command/service';
import { resolveActiveProvider } from './provider-resolver';
import {
  TOOL_DEFINITIONS,
  executeTool,
  prepareToolCall,
  type PreparedToolCall,
  type ToolContext,
} from './tools';
import { messageId as newMessageId, toolCallId as newCallId } from '../util/id';
import { createLogger } from '../util/logger';

const log = createLogger('agent');
/** 单次任务允许的工具轮次。参考编码类 Agent 的做法，给足探索与修正空间。 */
const MAX_ROUNDS = 64;
/** 单次任务的总时长上限，防止异常循环无限运行。 */
const MAX_RUN_MS = 30 * 60 * 1000;
const MAX_TOOL_RESULT = 4000;
/** 单次模型调用的超时，避免模型端无响应时界面一直转圈。 */
const CHAT_TIMEOUT_MS = 180_000;
/** 单次调用预留的输出 token。 */
const CHAT_MAX_TOKENS = 4096;
/** 未配置 contextWindow 时假设的上下文长度。 */
const DEFAULT_CONTEXT_WINDOW = 128_000;

interface RunState {
  serverId: string;
  status: AgentRunStatus;
  abort: AbortController;
  pending: Map<string, (decision: ApprovalDecision) => void>;
  /** 从体检报告「让 AI 修复」发起时携带的问题 ID，用于回写工单。 */
  issueId?: string;
}

export interface AgentDeps {
  ssh: SshManager;
  servers: ServerStore;
  profiles: ProfileStore;
  runtime: RuntimeStore;
  chat: ChatStore;
  audit: AuditStore;
  settings: SettingsStore;
  providers: ProviderStore;
  monitor: MonitorService;
  health: HealthService;
  /** 智能审批（可选，便于测试与旧调用方） */
  approvals?: SmartApprovalService;
  /** 命令历史（可选） */
  commands?: CommandService;
}

/**
 * AI 运维 Agent。负责多轮工具调用、审批等待、执行验证与事件投影。
 * 模型只提出调用；执行、风险分级、审批与持久化都由本地控制。
 */
export class AgentService extends EventEmitter {
  private runs = new Map<string, RunState>();
  private lastStates = new Map<string, AgentRunStatus>();
  /**
   * 会话级「始终允许该命令」白名单。按服务器保存，清空对话或重启应用时失效；
   * 只对完全相同的命令字符串生效，不会放宽风险等级。
   */
  private sessionAllowed = new Map<string, Set<string>>();

  constructor(private readonly deps: AgentDeps) {
    super();
  }

  status(serverId: string): AgentRunStatus {
    const running = this.runs.get(serverId);
    if (running) return running.status;
    return this.lastStates.get(serverId) ?? { serverId, state: 'idle', round: 0 };
  }

  history(serverId: string): ChatMessage[] {
    return this.deps.chat.list(serverId);
  }

  clear(serverId: string): void {
    this.cancel(serverId);
    this.sessionAllowed.delete(serverId);
    this.lastStates.delete(serverId);
    this.deps.chat.clear(serverId);
  }

  private emitEvent(event: AgentStreamEvent): void {
    this.emit('event', event);
  }

  private emitRun(run: RunState, patch: Partial<AgentRunStatus>): void {
    run.status = { ...run.status, ...patch };
    this.emitEvent({ type: 'run', payload: run.status });
  }

  private resolveProvider(): { provider: Provider; config: ProviderConfig } {
    return resolveActiveProvider(this.deps.providers, this.deps.settings);
  }

  /** 启动一次对话，立即返回消息 ID，循环在后台继续。 */
  send(serverId: string, text: string, issueId?: string): { messageId: string } {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('消息不能为空');
    if (this.runs.has(serverId)) throw new Error('当前服务器已有正在运行的任务，请等待完成或先停止');

    const { provider, config } = this.resolveProvider();
    const server = this.deps.servers.get(serverId);
    if (!server) throw new Error('服务器不存在');

    const run: RunState = {
      serverId,
      status: { serverId, state: 'thinking', round: 0 },
      abort: new AbortController(),
      pending: new Map(),
      issueId,
    };
    this.runs.set(serverId, run);

    const messageId = newMessageId();
    const userMessage: ChatMessage = { id: messageId, role: 'user', content: trimmed, ts: Date.now() };
    this.deps.chat.append(serverId, userMessage);
    this.emitEvent({ type: 'message', serverId, message: userMessage });
    this.emitRun(run, { state: 'thinking', round: 0 });

    void this.runLoop(run, provider, config).catch((error) => {
      if (run.abort.signal.aborted) {
        this.finishRun(run, 'cancelled');
        return;
      }
      log.error('Agent 运行失败', error);
      const message = error instanceof Error ? error.message : String(error);
      this.appendAssistantText(run, `⚠ 模型调用失败：${message}`);
      this.emitRun(run, { state: 'error', error: message });
      // 保留错误状态，刷新界面后仍能看到失败原因。
      this.lastStates.set(serverId, run.status);
      this.runs.delete(serverId);
    });

    return { messageId };
  }

  private finishRun(run: RunState, state: AgentRunStatus['state']): void {
    this.emitRun(run, { state });
    this.lastStates.set(run.serverId, run.status);
    this.runs.delete(run.serverId);
  }

  private appendAssistantText(run: RunState, text: string): void {
    const message: ChatMessage = {
      id: newMessageId(),
      role: 'assistant',
      content: text,
      ts: Date.now(),
    };
    this.deps.chat.append(run.serverId, message);
    this.emitEvent({ type: 'message', serverId: run.serverId, message });
  }

  private async runLoop(run: RunState, provider: Provider, config: ProviderConfig): Promise<void> {
    const server = this.deps.servers.get(run.serverId);
    if (!server) throw new Error('服务器不存在');
    const startedAt = Date.now();
    const budgetTokens = Math.max(16_000, Math.floor((config.contextWindow ?? DEFAULT_CONTEXT_WINDOW) * 0.6));

    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      if (run.abort.signal.aborted) return;
      if (Date.now() - startedAt > MAX_RUN_MS) {
        this.appendAssistantText(run, '本次任务运行时间已超过 30 分钟，已自动停止。你可以继续提问，我会接着处理。');
        this.finishRun(run, 'done');
        return;
      }
      // 稳定段（档案、工作方式、安全边界）在多轮之间保持一致，便于命中前缀缓存；
      // 实时指标与服务快照作为 liveContext 附加到最后一条用户消息，不污染缓存前缀。
      const parts = buildPromptParts(
        this.buildContext(run.serverId, server),
        this.deps.settings.get().language,
      );
      this.emitRun(run, { state: 'thinking', round, promptVersion: parts.version });

      const messages = toProviderMessages(this.deps.chat.list(run.serverId), parts.stable, {
        budgetTokens,
        reservedTokens: CHAT_MAX_TOKENS,
        liveContext: parts.live,
      });
      const assistant: ChatMessage = {
        id: newMessageId(),
        role: 'assistant',
        content: '',
        ts: Date.now(),
        toolCalls: [],
      };
      this.deps.chat.append(run.serverId, assistant);

      const result = await provider.chat({
        messages,
        tools: TOOL_DEFINITIONS,
        signal: run.abort.signal,
        timeoutMs: CHAT_TIMEOUT_MS,
        maxTokens: CHAT_MAX_TOKENS,
        onDelta: (text) => {
          this.emitEvent({ type: 'delta', serverId: run.serverId, messageId: assistant.id, text });
        },
      });

      if (run.abort.signal.aborted) return;

      assistant.content = result.text;
      assistant.usage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens,
      };
      this.deps.chat.updateMessage(run.serverId, assistant.id, {
        content: assistant.content,
        usage: assistant.usage,
      });
      if (result.usage.inputTokens || result.usage.outputTokens) {
        this.emitEvent({
          type: 'usage',
          serverId: run.serverId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cachedInputTokens: result.usage.cachedInputTokens,
        });
      }

      if (!result.toolCalls.length) {
        this.emitEvent({
          type: 'message',
          serverId: run.serverId,
          message: { ...assistant, toolCalls: [] },
        });
        this.finishRun(run, 'done');
        return;
      }

      let shouldFinish = false;
      for (const request of result.toolCalls) {
        if (run.abort.signal.aborted) return;
        const call = await this.runTool(run, assistant, request.id, request.name, request.arguments);
        if (!call) continue;
        if (request.name === 'finish' && call.status === 'done') {
          shouldFinish = true;
          if (!assistant.content.trim()) {
            assistant.content = call.stdout ?? '';
            this.deps.chat.updateMessage(run.serverId, assistant.id, { content: assistant.content });
          }
        }
      }

      this.deps.chat.updateMessage(run.serverId, assistant.id, {
        content: assistant.content,
        toolCalls: assistant.toolCalls,
      });
      this.emitEvent({ type: 'message', serverId: run.serverId, message: assistant });

      if (shouldFinish) {
        this.finishRun(run, 'done');
        return;
      }
    }

    this.appendAssistantText(run, '已达到单次任务的最大工具轮次（64 轮），已停止继续执行。你可以继续提问。');
    this.finishRun(run, 'done');
  }

  private async runTool(
    run: RunState,
    assistant: ChatMessage,
    id: string,
    name: string,
    rawArguments: string,
  ): Promise<AgentToolCall | null> {
    const serverId = run.serverId;
    let args: Record<string, unknown> = {};
    let parseError: string | undefined;
    try {
      args = rawArguments?.trim() ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
    } catch {
      parseError = '工具参数不是合法 JSON';
    }

    const toolCtx: ToolContext = {
      serverId,
      ssh: this.deps.ssh,
      profiles: this.deps.profiles,
      runtime: this.deps.runtime,
      servers: this.deps.servers,
      audit: this.deps.audit,
      settings: this.deps.settings,
      monitor: this.deps.monitor,
      source: 'ai',
      recordCommand: (target, input) => this.deps.commands?.record(target, input),
    };

    const prepared: PreparedToolCall = parseError
      ? {
          name,
          args,
          title: `调用 ${name}`,
          risk: 'read',
          impact: parseError,
          needsApproval: false,
          kind: 'read',
          blocked: parseError,
        }
      : prepareToolCall(name, args, toolCtx);

    const call: AgentToolCall = {
      id: id || newCallId(),
      name,
      args,
      status: 'pending',
      risk: prepared.risk,
      title: prepared.title,
      command: prepared.command,
      impact: prepared.impact,
      rollback: prepared.rollback,
      createdAt: Date.now(),
    };
    assistant.toolCalls = [...(assistant.toolCalls ?? []), call];
    // 先让前端拿到包含该调用的消息，否则等待审批时找不到对应卡片。
    this.deps.chat.updateMessage(serverId, assistant.id, { toolCalls: assistant.toolCalls });
    this.emitEvent({
      type: 'message',
      serverId,
      message: { ...assistant, toolCalls: [...assistant.toolCalls] },
    });
    this.emitEvent({ type: 'tool', serverId, call: { ...call } });

    if (prepared.blocked) {
      call.status = 'error';
      call.error = prepared.blocked;
      call.finishedAt = Date.now();
      this.emitEvent({ type: 'tool', serverId, call: { ...call } });
      return call;
    }

    const settings = this.deps.settings.get();
    const sessionAllowed = this.sessionAllowed.get(serverId) ?? new Set<string>();
    let autoApproved =
      !prepared.needsApproval ||
      (prepared.risk === 'read' && settings.autoApproveReadOnly) ||
      // 未开启智能审批时保留原有的「低风险服务启停直接执行」；
      // 开启后统一由命令库/模型判定，避免绕过用户维护的规则。
      (settings.approvalMode === 'smart' &&
        !settings.smartApprovalEnabled &&
        prepared.risk === 'low' &&
        prepared.kind === 'service') ||
      (prepared.command ? sessionAllowed.has(prepared.command) : false);

    // v0.3.2 智能审批：命令库匹配 + 模型独立会话判定。
    // 只在原本需要审批时介入，判定结果与理由展示在工具卡片上。
    if (!autoApproved && prepared.needsApproval && settings.smartApprovalEnabled && this.deps.approvals) {
      try {
        const verdict = await this.deps.approvals.decide({
          serverId,
          command: prepared.command ?? '',
          risk: prepared.risk,
          kind: prepared.kind,
          purpose: typeof prepared.args.purpose === 'string' ? prepared.args.purpose : undefined,
          title: prepared.title,
        });
        call.approval = {
          source: verdict.source,
          reason: verdict.reason,
          auto: verdict.decision !== 'ask',
          ruleName: verdict.ruleName,
        };
        this.deps.chat.updateMessage(serverId, assistant.id, { toolCalls: assistant.toolCalls });
        this.emitEvent({ type: 'tool', serverId, call: { ...call } });
        if (verdict.decision === 'approve') {
          autoApproved = true;
        } else if (verdict.decision === 'reject') {
          call.status = 'rejected';
          call.error = `智能审批拒绝：${verdict.reason}`;
          call.finishedAt = Date.now();
          this.emitEvent({ type: 'tool', serverId, call: { ...call } });
          this.emitRun(run, { state: 'thinking' });
          return call;
        }
      } catch (error) {
        log.warn('智能审批失败，转人工确认', error);
      }
    }

    if (!autoApproved) {
      call.status = 'awaiting_approval';
      this.emitEvent({ type: 'tool', serverId, call: { ...call } });
      this.emitRun(run, { state: 'awaiting_approval' });
      const decision = await this.waitForApproval(run, call.id);
      if (!decision.approved) {
        call.status = 'rejected';
        call.error = decision.reason || '用户拒绝了该操作';
        call.finishedAt = Date.now();
        this.emitEvent({ type: 'tool', serverId, call: { ...call } });
        this.emitRun(run, { state: 'thinking' });
        return call;
      }
      if (decision.always && prepared.command) {
        const next = new Set(sessionAllowed);
        next.add(prepared.command);
        this.sessionAllowed.set(serverId, next);
      }
    }

    call.status = 'running';
    this.emitEvent({ type: 'tool', serverId, call: { ...call } });
    this.emitRun(run, { state: 'tool' });

    const result = await executeTool(prepared, toolCtx);
    call.status = result.ok ? 'done' : 'error';
    call.stdout = result.output;
    call.stderr = result.error;
    call.exitCode = result.exitCode ?? null;
    call.durationMs = result.durationMs;
    call.finishedAt = Date.now();
    if (!result.ok && result.error) call.error = result.error;

    this.emitEvent({ type: 'tool', serverId, call: { ...call } });

    // 从体检报告发起的修复，把执行结果记成工单，便于事后复盘「我对这个问题做过什么」。
    if (run.issueId && prepared.kind !== 'read') {
      this.deps.health.recordTicket({
        id: newCallId(),
        serverId,
        issueId: run.issueId,
        title: prepared.title,
        action: prepared.name,
        command: prepared.command,
        ok: result.ok,
        detail: (result.error || result.output || '').slice(0, 800),
        ts: Date.now(),
      });
    }

    if (!['get_overview', 'list_services', 'list_ports', 'list_processes', 'inspect_service', 'read_logs', 'read_file', 'list_files', 'update_profile', 'finish'].includes(name)) {
      try {
        await this.deps.monitor.refreshStatus(serverId);
      } catch {
        // 状态刷新失败不影响工具结果
      }
    }

    this.emitRun(run, { state: 'thinking' });
    return call;
  }

  private waitForApproval(run: RunState, callId: string): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      run.pending.set(callId, resolve);
    });
  }

  /** 用户对某个待审批工具调用做出决定。 */
  decide(serverId: string, decision: ApprovalDecision): void {
    const run = this.runs.get(serverId);
    if (!run) return;
    const resolve = run.pending.get(decision.callId);
    if (!resolve) return;
    run.pending.delete(decision.callId);
    resolve(decision);
  }

  cancel(serverId: string): void {
    const run = this.runs.get(serverId);
    if (!run) return;
    for (const [, resolve] of run.pending) {
      resolve({ callId: '', approved: false, reason: '任务已取消' });
    }
    run.pending.clear();
    run.abort.abort();
    this.finishRun(run, 'cancelled');
  }

  /**
   * 分析一条 shell 命令：本地规则给出风险等级，可选让模型解释影响与替代方案。
   * 只做分析，绝不执行。
   */
  async analyzeCommand(serverId: string, command: string): Promise<CommandAnalysis> {
    const assessment = classifyCommand(command);
    let explanation = '';
    let error: string | undefined;
    try {
      const { provider } = this.resolveProvider();
      const server = this.deps.servers.get(serverId);
      if (server) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const result = await provider.chat({
            messages: [
              {
                role: 'system',
                content: buildSystemPrompt(this.buildContext(serverId, server), this.deps.settings.get().language),
              },
              {
                role: 'user',
                content: `请分析下面这条 shell 命令：它做什么、影响范围、风险点、是否建议执行、有没有更安全的替代写法。只做分析，不要执行，也不要调用工具。\n\n命令：\n${command}`,
              },
            ],
            tools: [],
            signal: controller.signal,
          });
          explanation = result.text.trim();
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return { risk: assessment.level, reasons: assessment.reasons, explanation, error };
  }

  /** 生成一段服务器状态摘要，保存到运行时并用事件通知前端。 */
  async summarize(serverId: string): Promise<string | null> {
    const server = this.deps.servers.get(serverId);
    if (!server) return null;
    let provider: Provider;
    try {
      ({ provider } = this.resolveProvider());
    } catch {
      return null;
    }
    const system = buildSystemPrompt(this.buildContext(serverId, server), this.deps.settings.get().language);
    const controller = new AbortController();
    try {
      const result = await provider.chat({
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content:
              '请用 3-5 句话总结这台服务器当前的运行状态、最值得注意的问题和建议的下一步。不要调用工具，不要罗列原始数据。',
          },
        ],
        tools: [],
        signal: controller.signal,
        temperature: 0.3,
      });
      const text = result.text.trim();
      if (!text) return null;
      this.deps.runtime.setSummary(serverId, text);
      this.emitEvent({ type: 'summary', serverId, text, ts: Date.now() });
      return text;
    } catch (error) {
      log.warn('自动摘要失败', error);
      return null;
    }
  }

  private buildContext(serverId: string, server: ServerConfig) {
    const runtime = this.deps.runtime.get(serverId);
    return {
      server,
      profile: this.deps.profiles.get(serverId),
      sample: runtime.samples.at(-1),
      services: runtime.services,
      events: runtime.events,
    };
  }
}

/** 粗略估算 token 数：CJK 按 1 token/字，拉丁文按约 3.6 字符/token。 */
export function estimateTokens(text: string): number {
  let wide = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) > 0x2e7f) wide += 1;
  }
  const narrow = text.length - wide;
  return Math.ceil(wide + narrow / 3.6);
}

function messageTokens(message: ChatMessage): number {
  let total = estimateTokens(message.content) + 8;
  for (const call of message.toolCalls ?? []) {
    total += estimateTokens(JSON.stringify(call.args ?? {})) + 16;
    total += estimateTokens(call.stdout ?? '') + 8;
  }
  return total;
}

/**
 * 单轮过长（一次任务几十条工具输出）时，从最早的工具段开始整段舍弃，
 * 直到回到预算内。assistant 消息与其 tool 结果必须成对保留，否则模型协议会报错。
 */
function trimTurn(turn: ChatMessage[], allowance: number): ChatMessage[] {
  let current = [...turn];
  const cost = (list: ChatMessage[]) => list.reduce((sum, item) => sum + messageTokens(item), 0);
  let trimmed = false;

  // 本地历史里没有独立的 tool 消息，工具结果挂在 assistant.toolCalls 上，
  // 所以按「整条 assistant 消息」删除即可保持上下文自洽。
  while (cost(current) > allowance) {
    const index = current.findIndex((message, position) => position > 0 && message.role === 'assistant');
    if (index < 0 || index === current.length - 1) break;
    current = [...current.slice(0, index), ...current.slice(index + 1)];
    trimmed = true;
  }

  if (trimmed && current[0]) {
    current[0] = {
      ...current[0],
      content: `${current[0].content}\n\n[上下文超长：本次任务早期步骤的工具输出已省略]`,
    };
  }
  return current;
}

export interface MessageBuildOptions {
  /** 允许送入模型的总 token 预算（含系统提示与预留输出）。 */
  budgetTokens?: number;
  /** 预留给模型输出的 token。 */
  reservedTokens?: number;
  /** 最多保留多少个用户轮次。 */
  maxTurns?: number;
  /** 每轮变化的实时上下文，附加到最后一条用户消息，避免破坏稳定前缀。 */
  liveContext?: string;
}

/** 把本地对话历史转换为模型消息，在 token 预算内保留最近的完整轮次。 */
export function toProviderMessages(
  history: ChatMessage[],
  system: string,
  options: MessageBuildOptions = {},
): ProviderMessage[] {
  const maxTurns = Math.max(1, options.maxTurns ?? 12);
  const reserved = Math.max(1_024, options.reservedTokens ?? CHAT_MAX_TOKENS);
  const budget = Math.max(8_000, options.budgetTokens ?? DEFAULT_CONTEXT_WINDOW);
  const live = options.liveContext?.trim() ?? '';

  // 按用户消息切轮，保证 assistant/tool 不会被从中间截断。
  const turns: ChatMessage[][] = [];
  for (const message of history) {
    if (!turns.length || message.role === 'user') turns.push([message]);
    else turns.at(-1)!.push(message);
  }

  let used = estimateTokens(system) + estimateTokens(live) + reserved;
  const selected: ChatMessage[][] = [];
  for (let index = turns.length - 1; index >= 0 && selected.length < maxTurns; index -= 1) {
    const turn = turns[index]!;
    const cost = turn.reduce((sum, message) => sum + messageTokens(message), 0);
    if (selected.length > 0 && used + cost > budget) break;
    selected.unshift(turn);
    used += cost;
  }

  // 最新一轮本身也可能超出预算，此时在轮内裁剪。
  const latest = selected[0];
  if (latest) {
    const rest = used - latest.reduce((sum, message) => sum + messageTokens(message), 0);
    const allowance = Math.max(1_500, budget - rest);
    if (latest.reduce((sum, message) => sum + messageTokens(message), 0) > allowance) {
      selected[0] = trimTurn(latest, allowance);
    }
  }

  const messages: ProviderMessage[] = [{ role: 'system', content: system }];
  for (const turn of selected) {
    for (const message of turn) {
      if (message.role === 'user') {
        messages.push({ role: 'user', content: message.content });
        continue;
      }
      if (message.role !== 'assistant') continue;
      if (!message.content.trim() && !message.toolCalls?.length) continue;

      messages.push({
        role: 'assistant',
        content: message.content,
        toolCalls: message.toolCalls?.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        })),
      });

      for (const call of message.toolCalls ?? []) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: toolResultText(call),
        });
      }
    }
  }

  if (live) {
    // 实时上下文只影响最后一条用户消息，系统提示与工具定义保持稳定。
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (message.role === 'user') {
        message.content = `${message.content}\n\n${live}`;
        break;
      }
    }
  }
  return messages;
}

function toolResultText(call: AgentToolCall): string {
  if (call.status === 'rejected') return '用户拒绝了该操作，未执行。';
  if (call.status === 'cancelled') return '任务已取消，未执行。';
  if (call.status === 'error') return `执行失败：${call.error ?? '未知错误'}`;
  if (call.status !== 'done') return '该操作未完成。';
  const text = call.stdout ?? '';
  return text.length > MAX_TOOL_RESULT
    ? `${text.slice(0, MAX_TOOL_RESULT - 500)}\n…[输出过长已截断]…`
    : text;
}

export type { RiskLevel };
