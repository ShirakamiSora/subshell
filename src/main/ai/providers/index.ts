import type { ProviderConfig } from '../../../shared/types';
import { AnthropicProvider } from './anthropic';
import { MockProvider } from './mock';
import { OpenAiProvider } from './openai';
import type { Provider } from './types';

/** 根据配置创建模型客户端。 */
export function createProvider(config: ProviderConfig, apiKey: string): Provider {
  const settings = {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey,
    headers: config.headers,
  };
  switch (config.kind) {
    case 'anthropic':
      return new AnthropicProvider(settings);
    case 'mock':
      return new MockProvider();
    case 'ollama':
    case 'openai':
    default:
      return new OpenAiProvider(settings);
  }
}
