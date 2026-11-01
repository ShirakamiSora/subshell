import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { ProviderConfig, ProviderInput } from '@shared/types';
import { Modal } from '../components/Modal';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { cn } from '../lib/cn';

const kindLabelKeys: Record<string, string> = {
  openai: 'settings.provider.kind.openai',
  anthropic: 'settings.provider.kind.anthropic',
  ollama: 'settings.provider.kind.ollama',
  mock: 'settings.provider.kind.mock',
};

const presets: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
};

export function ProviderDialog({
  editing,
  onClose,
}: {
  editing: ProviderConfig | null;
  onClose: () => void;
}) {
  const saveProvider = useApp((state) => state.saveProvider);
  const { t } = useI18n();
  const [form, setForm] = useState<ProviderInput>(() => ({
    id: editing?.id,
    name: editing?.name ?? '',
    kind: editing?.kind ?? 'openai',
    baseUrl: editing?.baseUrl ?? presets.openai!.baseUrl,
    model: editing?.model ?? presets.openai!.model,
    apiKey: '',
  }));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const changeKind = (kind: ProviderInput['kind']) => {
    const preset = kind === 'anthropic' ? presets.anthropic : kind === 'ollama' ? presets.ollama : kind === 'openai' ? presets.openai : null;
    setForm((current) => ({
      ...current,
      kind,
      baseUrl: preset?.baseUrl ?? '',
      model: preset?.model ?? 'mock',
    }));
    setResult(null);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await api.ai.testProvider(form);
      setResult({
        ok: response.ok,
        message: response.ok
          ? `${t('settings.provider.testOk')}${response.latencyMs ? ` · ${response.latencyMs}ms` : ''}${response.message ? ` · ${response.message}` : ''}`
          : response.error || t('settings.provider.testFailed'),
      });
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    if (!form.name.trim() || !form.model.trim()) {
      setResult({ ok: false, message: t('settings.provider.needName') });
      return;
    }
    if (form.kind !== 'mock' && !form.baseUrl.trim()) {
      setResult({ ok: false, message: t('settings.provider.needUrl') });
      return;
    }
    setSaving(true);
    const payload: ProviderInput = {
      ...form,
      apiKey: form.apiKey?.trim() ? form.apiKey.trim() : undefined,
    };
    const ok = await saveProvider(payload);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={editing ? t('settings.provider.editTitle') : t('settings.provider.addTitle')}
      description={t('settings.provider.desc')}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <button className="btn" onClick={() => void test()} disabled={testing || form.kind === 'mock'}>
              {testing ? <Loader2 size={13} className="spin" /> : <Zap size={13} />}
              {t('settings.provider.test')}
            </button>
            {result && (
              <span className={cn('max-w-[280px] truncate text-[12px]', result.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
                {result.message}
              </span>
            )}
          </div>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? t('settings.provider.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['openai', 'anthropic', 'ollama', 'mock'] as const).map((kind) => (
            <button
              key={kind}
              onClick={() => changeKind(kind)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors',
                form.kind === kind
                  ? 'border-teal-400/40 bg-teal-400/[0.06] text-[var(--text)]'
                  : 'border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)]',
              )}
            >
              {t(kindLabelKeys[kind] ?? 'settings.provider.kind.openai')}
            </button>
          ))}
        </div>

        <div>
          <label className="label">{t('settings.provider.name')}</label>
          <input
            className="input"
            placeholder={t('settings.provider.namePlaceholder')}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>

        {form.kind !== 'mock' && (
          <>
            <div>
              <label className="label">{t('settings.provider.baseUrl')}</label>
              <input
                className="input mono text-[12.5px]"
                placeholder="https://api.deepseek.com/v1"
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {Object.entries(presets).map(([key, preset]) => (
                  <button
                    key={key}
                    className="chip h-5 text-[11px]"
                    onClick={() => setForm({ ...form, baseUrl: preset.baseUrl, model: preset.model })}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{t('settings.provider.model')}</label>
              <input
                className="input mono text-[12.5px]"
                placeholder="deepseek-chat"
                value={form.model}
                onChange={(event) => setForm({ ...form, model: event.target.value })}
              />
            </div>
            <div>
              <label className="label">
                {t('settings.provider.apiKey')}
                {editing?.hasApiKey ? ` ${t('settings.provider.apiKeySaved')}` : ''}
              </label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder={editing?.hasApiKey ? '••••••••' : 'sk-…'}
                value={form.apiKey ?? ''}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              />
            </div>
          </>
        )}

        {form.kind === 'mock' && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
            {t('settings.provider.mockDesc')}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useApp((state) => state.settings);
  const providers = useApp((state) => state.providers);
  const info = useApp((state) => state.info);
  const saveSettings = useApp((state) => state.saveSettings);
  const removeProvider = useApp((state) => state.removeProvider);
  const setActiveProvider = useApp((state) => state.setActiveProvider);
  const notify = useApp((state) => state.notify);
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | 'new' | null>(null);
  const [mcp, setMcp] = useState<{ running: boolean; port: number; token: string; endpoint: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<{ hasUpdate: boolean; latest: string; url: string; error?: string } | null>(null);

  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    void api.mcp
      .info()
      .then((next) => {
        if (!cancelled) setMcp(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings?.mcpEnabled, settings?.mcpPort]);

  if (!settings) return null;

  return (
    <>
      <Modal title={t('settings.title')} onClose={onClose} width="max-w-2xl">
        <section className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-[13.5px] font-semibold text-[var(--text)]">{t('settings.provider.title')}</h3>
              <p className="text-[12px] text-[var(--muted-2)]">{t('settings.provider.desc')}</p>
            </div>
            <button className="btn h-7 px-2.5 text-[12.5px]" onClick={() => setEditingProvider('new')}>
              <Plus size={12} />
              {t('settings.provider.add')}
            </button>
          </div>
          <div className="space-y-1.5">
            {providers.map((provider) => {
              const active = settings.activeProviderId === provider.id;
              return (
                <div
                  key={provider.id}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2',
                    active ? 'border-teal-400/35 bg-teal-400/[0.05]' : 'border-[var(--border)] bg-[var(--panel-2)]',
                  )}
                >
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => void setActiveProvider(provider.id)}>
                    <span className={cn('dot', active ? 'bg-[var(--accent)]' : 'bg-slate-600')} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-[var(--text)]">
                        {provider.name}
                        {provider.kind === 'mock' && (
                          <span className="ml-1.5 rounded bg-sky-400/10 px-1 text-[10.5px] text-[var(--blue)]">
                            {t('settings.provider.mock')}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11.5px] text-[var(--muted-2)]">
                        {t(kindLabelKeys[provider.kind] ?? 'settings.provider.kind.openai')} · {provider.model}
                        {provider.hasApiKey ? ` · ${t('settings.provider.keySaved')}` : ''}
                      </span>
                    </span>
                  </button>
                  <button className="btn btn-ghost h-6 px-2 text-[11.5px]" onClick={() => setEditingProvider(provider)}>
                    {t('settings.provider.edit')}
                  </button>
                  <button
                    className="btn btn-ghost h-6 w-6 !p-0 text-rose-300/80 hover:text-[var(--danger)]"
                    onClick={() => void removeProvider(provider.id)}
                    title={t('settings.provider.delete')}
                    disabled={providers.length <= 1}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-[13.5px] font-semibold text-[var(--text)]">{t('settings.appearance.title')}</h3>
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-2)]">
            <SettingRow title={t('settings.appearance.theme')} description={t('settings.appearance.themeDesc')}>
              <select
                className="input h-7 !w-28 text-[12px]"
                value={settings.theme}
                onChange={(event) =>
                  void saveSettings({ theme: event.target.value as 'dark' | 'light' | 'system' })
                }
              >
                <option value="light">{t('settings.theme.light')}</option>
                <option value="dark">{t('settings.theme.dark')}</option>
                <option value="system">{t('settings.theme.system')}</option>
              </select>
            </SettingRow>
            <SettingRow title={t('settings.language')} description={t('settings.languageDesc')}>
              <select
                className="input h-7 !w-28 text-[12px]"
                value={settings.language}
                onChange={(event) =>
                  void saveSettings({ language: event.target.value as 'zh' | 'en' })
                }
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </SettingRow>
          </div>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-[13.5px] font-semibold text-[var(--text)]">{t('settings.monitor.title')}</h3>
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-2)]">
            <SettingRow
              title={t('settings.monitor.approval')}
              description={t('settings.monitor.approvalDesc')}
            >
              <select
                className="input h-7 !w-24 text-[12.5px]"
                value={settings.approvalMode}
                onChange={(event) =>
                  void saveSettings({ approvalMode: event.target.value as 'strict' | 'smart' })
                }
              >
                <option value="smart">{t('settings.monitor.approvalSmart')}</option>
                <option value="strict">{t('settings.monitor.approvalStrict')}</option>
              </select>
            </SettingRow>
            <SettingRow
              title={t('settings.monitor.interval')}
              description={t('settings.monitor.intervalDesc')}
            >
              <select
                className="input h-7 !w-24 text-[12.5px]"
                value={settings.monitorIntervalSec}
                onChange={(event) => void saveSettings({ monitorIntervalSec: Number(event.target.value) })}
              >
                {[5, 10, 15, 30, 60].map((value) => (
                  <option key={value} value={value}>
                    {t('settings.monitor.seconds', { value })}
                  </option>
                ))}
              </select>
            </SettingRow>
            <SettingRow title={t('settings.monitor.autoRecon')} description={t('settings.monitor.autoReconDesc')}>
              <Switch checked={settings.autoRecon} onChange={(value) => void saveSettings({ autoRecon: value })} />
            </SettingRow>
            <SettingRow title={t('settings.monitor.autoSummary')} description={t('settings.monitor.autoSummaryDesc')}>
              <Switch checked={settings.aiAutoSummary} onChange={(value) => void saveSettings({ aiAutoSummary: value })} />
            </SettingRow>
            <SettingRow title={t('settings.monitor.autoRead')} description={t('settings.monitor.autoReadDesc')}>
              <Switch
                checked={settings.autoApproveReadOnly}
                onChange={(value) => void saveSettings({ autoApproveReadOnly: value })}
              />
            </SettingRow>
            <SettingRow title={t('settings.monitor.sync')} description={t('settings.monitor.syncDesc')}>
              <Switch
                checked={settings.syncProfileToServer}
                onChange={(value) => void saveSettings({ syncProfileToServer: value })}
              />
            </SettingRow>
            <SettingRow title={t('settings.monitor.font')} description={t('settings.monitor.fontDesc')}>
              <select
                className="input h-7 !w-20 text-[12.5px]"
                value={settings.terminalFontSize}
                onChange={(event) => void saveSettings({ terminalFontSize: Number(event.target.value) })}
              >
                {[12, 13, 14, 15, 16].map((value) => (
                  <option key={value} value={value}>
                    {value}px
                  </option>
                ))}
              </select>
            </SettingRow>
          </div>
        </section>

        <section className="mb-6">
          <div className="mb-2">
            <h3 className="text-[13.5px] font-semibold text-[var(--text)]">{t('settings.mcp.title')}</h3>
            <p className="text-[12px] text-[var(--muted-2)]">{t('settings.mcp.desc')}</p>
          </div>
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-2)]">
            <SettingRow title={t('settings.mcp.enable')} description={t('settings.mcp.enableDesc')}>
              <Switch checked={settings.mcpEnabled} onChange={(value) => void saveSettings({ mcpEnabled: value })} />
            </SettingRow>
            <SettingRow title={t('settings.mcp.port')} description={t('settings.mcp.portDesc')}>
              <input
                type="number"
                className="input mono h-7 !w-24 text-[12px]"
                defaultValue={settings.mcpPort}
                onBlur={(event) => {
                  const port = Number.parseInt(event.target.value, 10);
                  if (Number.isFinite(port) && port > 0 && port < 65536 && port !== settings.mcpPort) {
                    void saveSettings({ mcpPort: port });
                  }
                }}
              />
            </SettingRow>
            <SettingRow title={t('settings.mcp.mutations')} description={t('settings.mcp.mutationsDesc')}>
              <Switch
                checked={settings.mcpAllowMutations}
                onChange={(value) => void saveSettings({ mcpAllowMutations: value })}
              />
            </SettingRow>
          </div>
          {mcp && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--muted-2)]">{t('settings.mcp.endpoint')}</span>
                <span className="mono truncate text-[var(--text)]">
                  {mcp.running ? mcp.endpoint : t('settings.mcp.stopped')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--muted-2)]">{t('settings.mcp.token')}</span>
                <span className="mono truncate text-[var(--muted)]">{mcp.token}</span>
              </div>
              <button
                className="btn h-7 px-2 text-[11.5px]"
                onClick={() => {
                  void navigator.clipboard.writeText(mcp.token);
                  notify('success', t('settings.mcp.copied'));
                }}
              >
                {t('settings.mcp.copy')}
              </button>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[13.5px] font-semibold text-[var(--text)]">{t('settings.about.title')}</h3>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[12.5px] text-[var(--muted)]">
            <div className="flex justify-between py-0.5">
              <span className="text-[var(--muted-2)]">{t('settings.about.version')}</span>
              <span>subshell {info?.version ?? '—'}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-[var(--muted-2)]">Electron</span>
              <span>{info?.electron ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-4 py-0.5">
              <span className="flex-none text-[var(--muted-2)]">{t('settings.about.dataDir')}</span>
              <span className="truncate text-right">{info?.dataDir ?? '—'}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2">
              <div className="min-w-0 flex-1 pr-3">
                <div className="text-[12px] text-[var(--text)]">{t('settings.update.auto')}</div>
                <div className="text-[11.5px] text-[var(--muted-2)]">{t('settings.update.autoDesc')}</div>
              </div>
              <Switch checked={settings.autoCheckUpdate} onChange={(value) => void saveSettings({ autoCheckUpdate: value })} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
              <button
                className="btn h-7 px-2.5 text-[11.5px]"
                disabled={checking}
                onClick={() => {
                  void (async () => {
                    setChecking(true);
                    try {
                      setUpdate(await api.update.check());
                    } finally {
                      setChecking(false);
                    }
                  })();
                }}
              >
                {checking ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
                {t('settings.update.check')}
              </button>
              {update && (
                <span className="text-[11.5px] text-[var(--muted-2)]">
                  {update.error
                    ? t('settings.update.failed')
                    : update.hasUpdate
                      ? t('settings.update.available', { version: update.latest })
                      : t('settings.update.latest')}
                </span>
              )}
              {update?.hasUpdate && update.url && (
                <button className="text-[11.5px] text-[var(--accent)] hover:underline" onClick={() => void api.update.open(update.url)}>
                  {t('settings.update.download')}
                </button>
              )}
            </div>
          </div>
        </section>
      </Modal>

      {editingProvider && (
        <ProviderDialog
          editing={editingProvider === 'new' ? null : editingProvider}
          onClose={() => setEditingProvider(null)}
        />
      )}
    </>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-[var(--text)]">{title}</div>
        <div className="text-[11.5px] text-[var(--muted-2)]">{description}</div>
      </div>
      {children}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 flex-none rounded-full transition-colors',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--panel-3)] ring-1 ring-inset ring-[var(--border-strong)]',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  );
}
