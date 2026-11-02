/** 模型无关的内部消息格式。 */
export interface ToolCallRequest {
  id: string;
  name: string;
  /** JSON 字符串（模型原始输出） */
  arguments: string;
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatOptions {
  messages: ProviderMessage[];
  tools: ToolDefinition[];
  signal: AbortSignal;
  onDelta?: (text: string) => void;
  temperature?: number;
  /** 单次模型调用的超时（毫秒）。默认 180 秒。 */
  timeoutMs?: number;
  /** 单次调用的最大输出 token。 */
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCallRequest[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** 命中服务端上下文缓存的输入 token（OpenAI prompt_tokens_details.cached_tokens 等） */
    cachedInputTokens?: number;
    /** 写入缓存的 token（Anthropic cache_creation_input_tokens） */
    cacheCreationTokens?: number;
  };
}

export interface Provider {
  readonly kind: string;
  chat(options: ChatOptions): Promise<ChatResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** 逐行解析 SSE 响应中的 `data:` 负载。 */
export async function* sseData(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new ProviderError('模型响应没有内容');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim();
    }
  }
  if (buffer.trim().startsWith('data:')) yield buffer.trim().slice(5).trim();
}
