import type { ProviderConfig, RiskLevel } from '../../shared/types';import type { ProviderStore } from '../store/provider-store';
import type { SettingsStore } from '../store/settings';
import { createProvider } from './providers';
import type { Provider } from './providers/types';

/** 解析当前生效的模型服务商；未配置或缺少 Key 时给出可操作的错误。 */
export function resolveActiveProvider(
  providers: ProviderStore,
  settings: SettingsStore,
): { provider: Provider; config: ProviderConfig } {
  const current = settings.get();
  const configs = providers.list();
  const config =
    (current.activeProviderId ? configs.find((item) => item.id === current.activeProviderId) : null) ??
    configs[0];
  if (!config) throw new Error('尚未配置模型服务商，请先在设置中添加');
  const apiKey = providers.apiKey(config.id);
  if (config.kind !== 'mock' && !apiKey) {
    throw new Error(`「${config.name}」没有保存 API Key，请到设置 → 模型服务商里重新填写并保存`);
  }
  return { provider: createProvider(config, apiKey), config };
}

/** 从模型输出里提取 JSON 对象：兼容 ```json 代码块与前后说明文字。 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function asStringArray(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 风险等级排序：数值越大越危险。 */
export function riskWeight(risk: RiskLevel): number {
  switch (risk) {
    case 'read':
      return 0;
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 3;
    default:
      return 4;
  }
}
