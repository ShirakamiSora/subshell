import type { ProviderConfig, ProviderInput } from '../../shared/types';
import { JsonStore } from './json-store';
import type { SecretStore } from './secrets';
import { shortId } from '../util/id';

/** 模型服务商配置。API Key 只存在于系统凭据库，配置文件中仅保存 hasApiKey 标记。 */
export class ProviderStore {
  private readonly store: JsonStore<ProviderConfig[]>;

  constructor(
    dataDir: string,
    private readonly secrets: SecretStore,
  ) {
    this.store = new JsonStore<ProviderConfig[]>(`${dataDir}/providers.json`, () => []);
  }

  list(): ProviderConfig[] {
    return this.store.read().map((item) => ({ ...item, hasApiKey: this.secrets.has(`provider:${item.id}`) }));
  }

  get(id: string): ProviderConfig | null {
    return this.list().find((item) => item.id === id) ?? null;
  }

  save(input: ProviderInput): ProviderConfig {
    const list = this.store.read();
    const now = new Date().toISOString();
    const id = input.id ?? shortId('prov');
    const existing = list.find((item) => item.id === id);
    const config: ProviderConfig = {
      id,
      name: input.name.trim() || input.model,
      kind: input.kind,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
      model: input.model.trim(),
      hasApiKey: false,
      headers: input.headers,
      contextWindow: input.contextWindow,
      temperature: input.temperature,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    // 只有明确提供了非空 Key 才写入；留空表示“不修改已保存的 Key”，
    // 避免编辑模型时误删凭据。删除凭据走 remove()。
    if (input.apiKey && input.apiKey.trim()) {
      this.secrets.set(`provider:${id}`, { password: input.apiKey.trim() });
    }
    const next = existing ? list.map((item) => (item.id === id ? config : item)) : [...list, config];
    this.store.write(next);
    return { ...config, hasApiKey: this.secrets.has(`provider:${id}`) };
  }

  remove(id: string): void {
    this.store.write(this.store.read().filter((item) => item.id !== id));
    this.secrets.delete(`provider:${id}`);
  }

  apiKey(id: string): string {
    return this.secrets.get(`provider:${id}`)?.password ?? '';
  }
}
