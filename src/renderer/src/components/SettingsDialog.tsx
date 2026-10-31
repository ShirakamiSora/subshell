import { useState, type ReactNode } from 'react';
import { Loader2, Plus, Trash2, Zap } from 'lucide-react';
import type { ProviderConfig, ProviderInput } from '@shared/types';
import { Modal } from '../components/Modal';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { cn } from '../lib/cn';

const kindLabels: Record<string, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  mock: '演示模型',
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
          ? `连接成功${response.latencyMs ? ` · ${response.latencyMs}ms` : ''}${response.message ? ` · ${response.message}` : ''}`
          : response.error || '连接失败',
      });
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    if (!form.name.trim() || !form.model.trim()) {
      setResult({ ok: false, message: '请填写名称与模型名称' });
      return;
    }
    if (form.kind !== 'mock' && !form.baseUrl.trim()) {
      setResult({ ok: false, message: '请填写 API 地址' });
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
      title={editing ? '编辑模型服务商' : '添加模型服务商'}
      description="支持 OpenAI 兼容接口、Anthropic Messages 与 Ollama。API Key 只保存在系统凭据库。"
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <button className="btn" onClick={() => void test()} disabled={testing || form.kind === 'mock'}>
              {testing ? <Loader2 size={13} className="spin" /> : <Zap size={13} />}
              测试连接
            </button>
            {result && (
              <span className={cn('max-w-[280px] truncate text-[12px]', result.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
                {result.message}
              </span>
            )}
          </div>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
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
              {kindLabels[kind]}
            </button>
          ))}
        </div>

        <div>
          <label className="label">名称</label>
          <input
            className="input"
            placeholder="例如：DeepSeek"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>

        {form.kind !== 'mock' && (
          <>
            <div>
              <label className="label">API 地址</label>
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
              <label className="label">模型</label>
              <input
                className="input mono text-[12.5px]"
                placeholder="deepseek-chat"
                value={form.model}
                onChange={(event) => setForm({ ...form, model: event.target.value })}
              />
            </div>
            <div>
              <label className="label">API Key {editing?.hasApiKey ? '（已保存，留空不修改）' : ''}</label>
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
            演示模型不需要 API Key，会按固定剧本调用工具，用于体验完整流程与界面验收。
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
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | 'new' | null>(null);

  const { t } = useI18n();

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
                        {kindLabels[provider.kind]} · {provider.model}
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
                    {value} 秒
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
