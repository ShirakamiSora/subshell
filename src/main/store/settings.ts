import { join } from 'node:path';
import type { AppSettings } from '../../shared/types';
import type { SubshellDb } from './db';
import { SqliteStore } from './sqlite-store';

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
  smartApprovalEnabled: false,
  smartApprovalUseModel: true,
  commandHistoryEnabled: true,
  commandHistoryRetention: 2000,
  securityAutoScan: true,
  securityScanIntervalHours: 24,
  clusterParallelism: 4,
};

/** settings 的结构版本。新增字段时递增，旧数据会自动补齐默认值。 */
const SCHEMA_VERSION = 5;

export class SettingsStore {
  private readonly store: SqliteStore<AppSettings>;

  constructor(db: SubshellDb) {
    this.store = new SqliteStore<AppSettings>(db, 'settings', () => ({ ...defaultSettings }), {
      version: SCHEMA_VERSION,
      legacyFile: join(db.dataDir, 'settings.json'),
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
