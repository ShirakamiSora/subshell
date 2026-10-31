import { useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react';
import type { ServerConfig } from '@shared/types';
import type { ServerInput } from '@shared/api';
import { Modal } from '../components/Modal';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';

interface Props {
  editing: ServerConfig | null;
  onClose: () => void;
}

export function ServerDialog({ editing, onClose }: Props) {
  const saveServer = useApp((state) => state.saveServer);
  const { t } = useI18n();
  const defaultGroup = t('sidebar.defaultGroup');
  const [form, setForm] = useState(() => ({
    name: editing?.name ?? '',
    host: editing?.host ?? '',
    port: String(editing?.port ?? 22),
    username: editing?.username ?? 'root',
    authType: editing?.authType ?? ('password' as 'password' | 'key'),
    password: '',
    privateKeyPath: editing?.privateKeyPath ?? '',
    passphrase: '',
    group: editing?.group ?? defaultGroup,
    description: editing?.description ?? '',
    tags: (editing?.tags ?? []).join(', '),
  }));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setResult(null);
  };

  const buildInput = (): ServerInput => ({
    name: form.name.trim() || form.host.trim(),
    host: form.host.trim(),
    port: Number.parseInt(form.port, 10) || 22,
    username: form.username.trim(),
    authType: form.authType,
    privateKeyPath: form.authType === 'key' ? form.privateKeyPath.trim() : undefined,
    password: form.authType === 'password' ? form.password || undefined : undefined,
    passphrase: form.authType === 'key' ? form.passphrase || undefined : undefined,
    group: form.group.trim() || defaultGroup,
    description: form.description.trim() || undefined,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  });

  const test = async () => {
    if (!form.host.trim() || !form.username.trim()) {
      setResult({ ok: false, message: t('serverDialog.needHost') });
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      const response = await api.servers.test(buildInput());
      setResult({
        ok: response.ok,
        message: response.ok
          ? t('serverDialog.testSuccess', { ms: response.latencyMs ?? 0 })
          : response.error || t('serverDialog.testFailed'),
      });
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    if (!form.host.trim() || !form.username.trim()) {
      setResult({ ok: false, message: t('serverDialog.needHost') });
      return;
    }
    setSaving(true);
    const ok = await saveServer(buildInput(), editing?.id);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={editing ? t('serverDialog.editTitle') : t('serverDialog.addTitle')}
      description={t('serverDialog.desc')}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <button className="btn" onClick={() => void test()} disabled={testing}>
              {testing ? <Loader2 size={13} className="spin" /> : <PlugZap size={13} />}
              {t('serverDialog.test')}
            </button>
            {result && (
              <span className={`flex items-center gap-1 text-[12px] ${result.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                {result.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {result.message}
              </span>
            )}
          </div>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? t('serverDialog.saving') : t('serverDialog.save')}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('serverDialog.name')}</label>
          <input
            className="input"
            placeholder={t('serverDialog.namePlaceholder')}
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('serverDialog.group')}</label>
          <input className="input" value={form.group} onChange={(event) => update('group', event.target.value)} />
        </div>
        <div>
          <label className="label">{t('serverDialog.host')}</label>
          <input
            className="input"
            placeholder={t('serverDialog.hostPlaceholder')}
            value={form.host}
            onChange={(event) => update('host', event.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('serverDialog.port')}</label>
          <input
            className="input"
            value={form.port}
            onChange={(event) => update('port', event.target.value.replace(/[^\d]/g, ''))}
          />
        </div>
        <div>
          <label className="label">{t('serverDialog.username')}</label>
          <input
            className="input"
            value={form.username}
            onChange={(event) => update('username', event.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('serverDialog.authType')}</label>
          <select
            className="input"
            value={form.authType}
            onChange={(event) => update('authType', event.target.value as 'password' | 'key')}
          >
            <option value="password">{t('serverDialog.password')}</option>
            <option value="key">{t('serverDialog.key')}</option>
          </select>
        </div>

        {form.authType === 'password' ? (
          <div className="col-span-2">
            <label className="label">
              {t('serverDialog.password')}
              {editing ? t('serverDialog.passwordKeep') : ''}
            </label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder={editing ? '••••••••' : t('serverDialog.passwordPlaceholder')}
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
            />
          </div>
        ) : (
          <>
            <div className="col-span-2">
              <label className="label">{t('serverDialog.privateKey')}</label>
              <input
                className="input mono"
                placeholder="C:\Users\you\.ssh\id_ed25519 或 ~/.ssh/id_ed25519"
                value={form.privateKeyPath}
                onChange={(event) => update('privateKeyPath', event.target.value)}
              />
            </div>
            <div className="col-span-2">
              <label className="label">{t('serverDialog.passphrase')}</label>
              <input
                className="input"
                type="password"
                placeholder={t('serverDialog.passphrasePlaceholder')}
                value={form.passphrase}
                onChange={(event) => update('passphrase', event.target.value)}
              />
            </div>
          </>
        )}

        <div className="col-span-2">
          <label className="label">{t('serverDialog.description')}</label>
          <input
            className="input"
            placeholder={t('serverDialog.descriptionPlaceholder')}
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="label">{t('serverDialog.tags')}</label>
          <input
            className="input"
            placeholder={t('serverDialog.tagsPlaceholder')}
            value={form.tags}
            onChange={(event) => update('tags', event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
