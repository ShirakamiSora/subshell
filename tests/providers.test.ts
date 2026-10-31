import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiProvider } from '../src/main/ai/providers/openai';
import { AnthropicProvider } from '../src/main/ai/providers/anthropic';
import type { ChatOptions, ToolDefinition } from '../src/main/ai/providers/types';

const tools: ToolDefinition[] = [
  {
    name: 'get_overview',
    description: 'overview',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function options(overrides: Partial<ChatOptions> = {}): ChatOptions {
  return {
    messages: [{ role: 'user', content: '检查状态' }],
    tools,
    signal: new AbortController().signal,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI 兼容 Provider', () => {
  it('解析流式文本、工具调用与用量', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"好的，"}}]}',
      'data: {"choices":[{"delta":{"content":"我先看看"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_overview","arguments":"{\\"a\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":7}}',
      'data: [DONE]',
    ];
    let body: unknown = null;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse(chunks);
    });

    const deltas: string[] = [];
    const provider = new OpenAiProvider({
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      apiKey: 'sk-test',
    });
    const result = await provider.chat(options({ onDelta: (text) => deltas.push(text) }));

    expect(deltas.join('')).toBe('好的，我先看看');
    expect(result.text).toBe('好的，我先看看');
    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'get_overview', arguments: '{"a":1}' }]);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
    expect((body as { stream: boolean }).stream).toBe(true);
    expect((body as { tools: unknown[] }).tools).toHaveLength(1);
  });

  it('HTTP 错误抛出明确信息', async () => {
    vi.stubGlobal('fetch', async () => new Response('invalid api key', { status: 401 }));
    const provider = new OpenAiProvider({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' });
    await expect(provider.chat(options())).rejects.toThrow(/401/);
  });
});

describe('Anthropic Provider', () => {
  it('解析文本与 tool_use 输入', async () => {
    const chunks = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":20}}}',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"我来检查"}}',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"list_services"}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"status\\":"}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"failed\\"}"}}',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":9}}',
    ];
    let request: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | null = null;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      request = {
        url,
        body: JSON.parse(String(init.body)),
        headers: init.headers as Record<string, string>,
      };
      return sseResponse(chunks);
    });

    const provider = new AnthropicProvider({
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-test',
      apiKey: 'key-test',
    });
    const result = await provider.chat(options());
    expect(result.text).toBe('我来检查');
    expect(result.toolCalls).toEqual([
      { id: 'toolu_1', name: 'list_services', arguments: '{"status":"failed"}' },
    ]);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 9 });
    expect(request!.url).toContain('/v1/messages');
    expect(request!.headers['x-api-key']).toBe('key-test');
    expect(request!.body.system).toBeUndefined();
  });

  it('把工具结果合并为 user 的 tool_result 块', async () => {
    let captured: { messages: { role: string; content: unknown }[] } | null = null;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: { role: string; content: unknown }[] };
      captured = body;
      return sseResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"完成"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":1}}',
      ]);
    });
    const provider = new AnthropicProvider({ baseUrl: 'https://a', model: 'm', apiKey: 'k' });
    await provider.chat(
      options({
        messages: [
          { role: 'user', content: '检查' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'toolu_1', name: 'get_overview', arguments: '{}' }],
          },
          { role: 'tool', toolCallId: 'toolu_1', name: 'get_overview', content: 'CPU 20%' },
        ],
      }),
    );
    const messages = captured!.messages;
    expect(messages[1]?.role).toBe('assistant');
    const last = messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(Array.isArray(last.content)).toBe(true);
    expect((last.content as { type: string }[])[0]?.type).toBe('tool_result');
  });
});
