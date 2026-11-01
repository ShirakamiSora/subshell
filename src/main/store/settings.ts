import type { AppSettings } from '../../shared/types';
import { JsonStore } from './json-store';

export const defaultSettings: AppSettings = {
  activeProviderId: null,
  theme: 'light',
  language: 'zh',
  approvalMode: 'smart',
  monitorIntervalSec: 15,
  autoRecon: true,
  autoApproveReadOnly: true,
  syncProfileToServer: false,
  aiAutoSummary: true,
  sampleRetention: 720,
  terminalFontSize: 14,
  auditEnabled: true,
  mcpEnabled: false,
  mcpPort: 3929,
  mcpAllowMutations: false,
  autoCheckUpdate: true,
  inputPricePerMTok: 0,
  outputPricePerMTok: 0,
};

/** settings.json 的结构版本。新增字段时递增，旧文件会自动补齐默认值。 */
const SCHEMA_VERSION = 4;

export class SettingsStore {
  private readonly store: JsonStore<AppSettings>;

  constructor(dataDir: string) {
    this.store = new JsonStore<AppSettings>(`${dataDir}/settings.json`, () => ({ ...defaultSettings }), {
      version: SCHEMA_VERSION,
      migrate: (data) => ({
        ...defaultSettings,
        ...(typeof data === 'object' && data !== null ? (data as Partial<AppSettings>) : {}),
      }),
    });
  }

  get(): AppSettings {
    return { ...defaultSettings, ...this.store.read() };
  }

  save(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.get(), ...patch };
    this.store.write(next);
    return next;
  }
}
