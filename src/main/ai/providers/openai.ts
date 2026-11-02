import type { ChatOptions, ChatResult, Provider, ProviderMessage, ToolCallRequest } from './types';
import { sseData } from './types';
import { fetchProvider } from './request';

interface OpenAiDelta {
  content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

/** OpenAI Chat Completions 协议，同时兼容 DeepSeek、通义、Moonshot、Ollama 等实现。 */
export class OpenAiProvider implements Provider {
  readonly kind = 'openai';

  constructor(
    private readonly config: { baseUrl: string; model: string; apiKey: string; headers?: Record<string, string> },
  ) {}

  private toApiMessages(messages: ProviderMessage[]): unknown[] {
    return messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        };
      }
      return { role: message.role, content: message.content };
    });
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: this.toApiMessages(options.messages),
      stream: true,
      stream_options: { include_usage: true },
      temperature: options.temperature ?? 0.2,
    };
    if (options.tools.length) {
      body.tools = options.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }));
      body.tool_choice = 'auto';
    }
    if (options.maxTokens) body.max_tokens = options.maxTokens;

    const response = await fetchProvider(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify(body),
      },
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );

    let text = '';
    const calls = new Map<number, ToolCallRequest>();
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;

    for await (const data of sseData(response)) {
      if (!data || data === '[DONE]') continue;
      let payload: {
        choices?: { delta?: OpenAiDelta; finish_reason?: string }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          /** OpenAI 标准字段 */
          prompt_tokens_details?: { cached_tokens?: number };
          /** DeepSeek 兼容字段 */
          prompt_cache_hit_tokens?: number;
          prompt_cache_miss_tokens?: number;
        };
      };
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (payload.usage) {
        inputTokens = payload.usage.prompt_tokens ?? inputTokens;
        outputTokens = payload.usage.completion_tokens ?? outputTokens;
        cachedInputTokens =
          payload.usage.prompt_tokens_details?.cached_tokens ??
          payload.usage.prompt_cache_hit_tokens ??
          cachedInputTokens;
      }
      const delta = payload.choices?.[0]?.delta;
      if (delta?.content) {
        text += delta.content;
        options.onDelta?.(delta.content);
      }
      for (const toolCall of delta?.tool_calls ?? []) {
        const current = calls.get(toolCall.index) ?? {
          id: toolCall.id ?? `call_${toolCall.index}`,
          name: '',
          arguments: '',
        };
        if (toolCall.id) current.id = toolCall.id;
        if (toolCall.function?.name) current.name += toolCall.function.name;
        if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
        calls.set(toolCall.index, current);
      }
    }

    return {
      text,
      toolCalls: [...calls.values()].filter((call) => call.name),
      usage: {
        inputTokens,
        outputTokens,
        // 只在确有缓存命中时携带该字段，保持旧客户端与测试的兼容。
        ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
      },
    };
  }
}
