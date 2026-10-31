import { EventEmitter } from 'node:events';
import type {
  AgentRunStatus,
  AgentStreamEvent,
  AgentToolCall,
  ApprovalDecision,
  ChatMessage,
  CommandAnalysis,
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
import { createProvider } from './providers';
import type { Provider, ProviderMessage } from './providers/types';
import { buildSystemPrompt } from './prompt';
import { classifyCommand } from './risk';
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

interface RunState {
  serverId: string;
  status: AgentRunStatus;
  abort: AbortController;
  pending: Map<string, (decision: ApprovalDecision) => void>;
  allowedCommands: Set<string>;
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
}

/**
 * AI 运维 Agent。负责多轮工具调用、审批等待、执行验证与事件投影。
 * 模型只提出调用；执行、风险分级、审批与持久化都由本地控制。
 */
export class AgentService extends EventEmitter {
  private runs = new Map<string, RunState>();
  private lastStates = new Map<string, AgentRunStatus>();

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
    this.deps.chat.clear(serverId);
  }

  private emitEvent(event: AgentStreamEvent): void {
    this.emit('event', event);
  }

  private emitRun(run: RunState, patch: Partial<AgentRunStatus>): void {
    run.status = { ...run.status, ...patch };
    this.emitEvent({ type: 'run', payload: run.status });
  }

  private resolveProvider(): { provider: Provider; configId: string } {
    const settings = this.deps.settings.get();
    const configs = this.deps.providers.list();
    const config =
      (settings.activeProviderId ? configs.find((item) => item.id === settings.activeProviderId) : null) ??
      configs[0];
    if (!config) throw new Error('尚未配置模型服务商，请先在设置中添加');
    const apiKey = this.deps.providers.apiKey(config.id);
    if (config.kind !== 'mock' && !apiKey) {
      throw new Error(`「${config.name}」没有保存 API Key，请到设置 → 模型服务商里重新填写并保存`);
    }
    const provider = createProvider(config, apiKey);
    return { provider, configId: config.id };
  }

  /** 启动一次对话，立即返回消息 ID，循环在后台继续。 */
  send(serverId: string, text: string): { messageId: string } {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('消息不能为空');
    if (this.runs.has(serverId)) throw new Error('当前服务器已有正在运行的任务，请等待完成或先停止');

    const { provider } = this.resolveProvider();
    const server = this.deps.servers.get(serverId);
    if (!server) throw new Error('服务器不存在');

    const run: RunState = {
      serverId,
      status: { serverId, state: 'thinking', round: 0 },
      abort: new AbortController(),
      pending: new Map(),
      allowedCommands: new Set(),
    };
    this.runs.set(serverId, run);

    const messageId = newMessageId();
    const userMessage: ChatMessage = { id: messageId, role: 'user', content: trimmed, ts: Date.now() };
    this.deps.chat.append(serverId, userMessage);
    this.emitEvent({ type: 'message', serverId, message: userMessage });
    this.emitRun(run, { state: 'thinking', round: 0 });

    void this.runLoop(run, provider).catch((error) => {
      if (run.abort.signal.aborted) {
        this.finishRun(run, 'cancelled');
        return;
      }
      log.error('Agent 运行失败', error);
      const message = error instanceof Error ? error.message : String(error);
      this.appendAssistantText(run, `⚠ 模型调用失败：${message}`);
      this.emitRun(run, { state: 'error', error: message });
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

  private async runLoop(run: RunState, provider: Provider): Promise<void> {
    const server = this.deps.servers.get(run.serverId);
    if (!server) throw new Error('服务器不存在');
    const startedAt = Date.now();

    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      if (run.abort.signal.aborted) return;
      if (Date.now() - startedAt > MAX_RUN_MS) {
        this.appendAssistantText(run, '本次任务运行时间已超过 30 分钟，已自动停止。你可以继续提问，我会接着处理。');
        this.finishRun(run, 'done');
        return;
      }
      this.emitRun(run, { state: 'thinking', round });

      const systemPrompt = buildSystemPrompt(
        this.buildContext(run.serverId, server),
        this.deps.settings.get().language,
      );
      const messages = toProviderMessages(this.deps.chat.list(run.serverId), systemPrompt);

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
        onDelta: (text) => {
          this.emitEvent({ type: 'delta', serverId: run.serverId, messageId: assistant.id, text });
        },
      });

      if (run.abort.signal.aborted) return;

      assistant.content = result.text;
      assistant.usage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
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
    };

    const prepared: PreparedToolCall = parseError
      ? {
          name,
          args,
          title: `调用 ${name}`,
          risk: 'read',
          impact: parseError,
          needsApproval: false,
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
    const autoApproved =
      !prepared.needsApproval ||
      (prepared.risk === 'read' && settings.autoApproveReadOnly) ||
      // 智能审批：低风险变更（启动/重启/重载普通服务、更新档案）直接执行，
      // 中高风险（停止服务、文件修改、任意命令）仍然必须确认。
      (settings.approvalMode === 'smart' && prepared.risk === 'low') ||
      (prepared.command ? run.allowedCommands.has(prepared.command) : false);

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
      if (decision.always && prepared.command) run.allowedCommands.add(prepared.command);
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

/** 把本地对话历史转换为模型消息，控制上下文长度并保留工具结果。 */
export function toProviderMessages(history: ChatMessage[], system: string): ProviderMessage[] {
  const userIndices = history
    .map((message, index) => (message.role === 'user' ? index : -1))
    .filter((index) => index >= 0);
  const start = userIndices.length > 12 ? userIndices[userIndices.length - 12]! : 0;
  const recent = history.slice(start);

  const messages: ProviderMessage[] = [{ role: 'system', content: system }];
  for (const message of recent) {
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
