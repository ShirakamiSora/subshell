import { ProviderError } from './types';

export interface ProviderFetchOptions {
  /** 调用方（一次 Agent 运行）的中止信号。 */
  signal: AbortSignal;
  /** 单次模型调用的超时，超时后按可重试错误处理。 */
  timeoutMs?: number;
  /** 建立响应阶段的重试次数（不含首次）。 */
  retries?: number;
}

/** 这些状态码通常是瞬时的，可以安全重试。 */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_RETRIES = 2;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ProviderError('请求已取消'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError('请求已取消'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function backoffMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return '请求超时';
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error) return cause.message;
    return error.message;
  }
  return String(error);
}

/**
 * 带超时与重试的模型请求。
 *
 * 只重试「建立响应」阶段：一旦开始消费流式响应体，重试会让半轮工具调用重复执行，
 * 因此流中途断开交给上层报错处理。这与 OpenAI/Anthropic 的流式语义一致。
 */
export async function fetchProvider(
  url: string,
  init: RequestInit,
  options: ProviderFetchOptions,
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError: ProviderError | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal.aborted) throw new ProviderError('请求已取消');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    options.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok) return response;

      const detail = await response.text().catch(() => '');
      lastError = new ProviderError(
        `模型请求失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 500)}` : ''}`,
        response.status,
      );
      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) throw lastError;
      await delay(backoffMs(attempt), options.signal);
    } catch (error) {
      if (options.signal.aborted) throw new ProviderError('请求已取消');
      if (error instanceof ProviderError && !RETRYABLE_STATUS.has(error.status ?? 0)) throw error;

      const message = timedOut
        ? `模型请求超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络或模型服务状态`
        : `模型请求失败：${describe(error)}`;
      lastError = error instanceof ProviderError ? error : new ProviderError(message);
      if (attempt === retries) throw new ProviderError(message, lastError.status);
      await delay(backoffMs(attempt), options.signal);
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
    }
  }

  throw lastError ?? new ProviderError('模型请求失败');
}
