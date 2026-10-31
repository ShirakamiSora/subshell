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
  inputPricePerMTok: 0,
  outputPricePerMTok: 0,
};

export class SettingsStore {
  private readonly store: JsonStore<AppSettings>;

  constructor(dataDir: string) {
    this.store = new JsonStore<AppSettings>(
      `${dataDir}/settings.json`,
      () => ({ ...defaultSettings }),
    );
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
