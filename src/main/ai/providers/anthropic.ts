import type { ChatOptions, ChatResult, Provider, ProviderMessage, ToolCallRequest } from './types';
import { sseData } from './types';
import { fetchProvider } from './request';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicBlock[];
}

/** Anthropic Messages 协议。 */
export class AnthropicProvider implements Provider {
  readonly kind = 'anthropic';

  constructor(
    private readonly config: { baseUrl: string; model: string; apiKey: string; headers?: Record<string, string> },
  ) {}

  private convert(messages: ProviderMessage[]): { system: string; messages: AnthropicMessage[] } {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const converted: AnthropicMessage[] = [];

    for (const message of messages) {
      if (message.role === 'system') continue;
      if (message.role === 'user') {
        converted.push({ role: 'user', content: message.content });
        continue;
      }
      if (message.role === 'assistant') {
        const blocks: AnthropicBlock[] = [];
        if (message.content) blocks.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls ?? []) {
          let input: unknown;
          try {
            input = JSON.parse(call.arguments || '{}');
          } catch {
            input = {};
          }
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input });
        }
        if (blocks.length) converted.push({ role: 'assistant', content: blocks });
        continue;
      }
      // tool 结果必须作为 user 消息，并紧跟对应的 tool_use。
      const block: AnthropicBlock = {
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: message.content,
      };
      const last = converted.at(-1);
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        converted.push({ role: 'user', content: [block] });
      }
    }

    return { system, messages: converted };
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const { system, messages } = this.convert(options.messages);
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/messages`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options.maxTokens ?? 4096,
      messages,
      temperature: options.temperature ?? 0.2,
      stream: true,
    };
    if (system.trim()) {
      // 显式声明缓存断点：稳定段（档案、工作方式、安全边界）在多轮之间逐字节一致时，
      // 服务端会复用前缀缓存；实时上下文已由 Agent 放在最后一条用户消息里。
      body.system = [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ];
    }
    if (options.tools.length) {
      body.tools = options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    const response = await fetchProvider(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify(body),
      },
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );

    let text = '';
    const blocks = new Map<number, { id: string; name: string; json: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let cacheCreationTokens = 0;

    for await (const data of sseData(response)) {
      if (!data) continue;
      let payload: {
        type?: string;
        index?: number;
        message?: {
          usage?: {
            input_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
        };
        content_block?: { type?: string; id?: string; name?: string; text?: string };
        delta?: {
          type?: string;
          text?: string;
          partial_json?: string;
          stop_reason?: string;
        };
        usage?: { output_tokens?: number };
      };
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }

      if (payload.type === 'message_start') {
        inputTokens = payload.message?.usage?.input_tokens ?? inputTokens;
        cachedInputTokens = payload.message?.usage?.cache_read_input_tokens ?? cachedInputTokens;
        cacheCreationTokens =
          payload.message?.usage?.cache_creation_input_tokens ?? cacheCreationTokens;
      } else if (payload.type === 'content_block_start') {
        if (payload.content_block?.type === 'tool_use' && typeof payload.index === 'number') {
          blocks.set(payload.index, {
            id: payload.content_block.id ?? `toolu_${payload.index}`,
            name: payload.content_block.name ?? '',
            json: '',
          });
        }
      } else if (payload.type === 'content_block_delta') {
        const delta = payload.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          text += delta.text;
          options.onDelta?.(delta.text);
        } else if (delta?.type === 'input_json_delta' && typeof payload.index === 'number') {
          const entry = blocks.get(payload.index);
          if (entry) entry.json += delta.partial_json ?? '';
        }
      } else if (payload.type === 'message_delta') {
        outputTokens = payload.usage?.output_tokens ?? outputTokens;
      }
    }

    const toolCalls: ToolCallRequest[] = [...blocks.values()]
      .filter((block) => block.name)
      .map((block) => ({ id: block.id, name: block.name, arguments: block.json || '{}' }));

    return {
      text,
      toolCalls,
      usage: {
        // Anthropic 的 input_tokens 不含缓存读写；这里统一成「总输入」便于展示命中率。
        inputTokens: inputTokens + cachedInputTokens + cacheCreationTokens,
        outputTokens,
        ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
        ...(cacheCreationTokens > 0 ? { cacheCreationTokens } : {}),
      },
    };
  }
}
