import { useEffect, useState } from 'react';
import { Loader2, Plus, Square, Trash2, Zap } from 'lucide-react';
import type { TunnelStatus } from '@shared/types';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/cn';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 端口转发：把远端服务映射到本机 127.0.0.1，方便本地数据库客户端/浏览器访问。 */
export function TunnelDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const { t } = useI18n();
  const notify = useApp((state) => state.notify);
  const [items, setItems] = useState<TunnelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ localPort: '3306', remoteHost: '127.0.0.1', remotePort: '3306' });

  const refresh = async () => {
    try {
      setItems(await api.tunnels.list(serverId));
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const add = async () => {
    const localPort = Number.parseInt(form.localPort, 10);
    const remotePort = Number.parseInt(form.remotePort, 10);
    if (!Number.isFinite(localPort) || !Number.isFinite(remotePort)) {
      notify('warning', t('tunnel.invalidPort'));
      return;
    }
    setBusy('new');
    try {
      setItems(await api.tunnels.save(serverId, { localPort, remoteHost: form.remoteHost, remotePort }));
      notify('success', t('tunnel.saved'));
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (item: TunnelStatus) => {
    setBusy(item.id);
    try {
      if (item.running) await api.tunnels.stop(item.id);
      else await api.tunnels.start(item.id);
      await refresh();
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: TunnelStatus) => {
    setBusy(item.id);
    try {
      setItems(await api.tunnels.remove(serverId, item.id));
    } catch (error) {
      notify('error', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={t('tunnel.title')}
      description={t('tunnel.desc')}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
          <div className="grid grid-cols-[1fr_1.4fr_1fr_auto] items-end gap-2">
            <div>
              <label className="label">{t('tunnel.localPort')}</label>
              <input
                className="input mono text-[12.5px]"
                value={form.localPort}
                onChange={(event) => setForm({ ...form, localPort: event.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('tunnel.remoteHost')}</label>
              <input
                className="input mono text-[12.5px]"
                value={form.remoteHost}
                onChange={(event) => setForm({ ...form, remoteHost: event.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('tunnel.remotePort')}</label>
              <input
                className="input mono text-[12.5px]"
                value={form.remotePort}
                onChange={(event) => setForm({ ...form, remotePort: event.target.value })}
              />
            </div>
            <button className="btn h-8 px-2.5" onClick={() => void add()} disabled={busy === 'new'}>
              {busy === 'new' ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
              {t('tunnel.add')}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--muted-2)]">{t('tunnel.hint')}</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[12.5px] text-[var(--muted-2)]">
            <Loader2 size={13} className="spin" />
            {t('common.loading')}
          </div>
        ) : items.length === 0 ? (
          <p className="py-2 text-[12.5px] text-[var(--muted-2)]">{t('tunnel.empty')}</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2',
                  item.running ? 'border-teal-400/35 bg-teal-400/[0.05]' : 'border-[var(--border)] bg-[var(--panel-2)]',
                )}
              >
                <span className={cn('dot flex-none', item.running ? 'bg-[var(--success)]' : 'bg-slate-600')} />
                <div className="min-w-0 flex-1">
                  <div className="mono truncate text-[12.5px] text-[var(--text)]">
                    {item.localPort} → {item.remoteHost}:{item.remotePort}
                  </div>
                  <div className="truncate text-[11px] text-[var(--muted-2)]">
                    {item.running ? t('tunnel.running', { count: item.connections }) : t('tunnel.stopped')}
                  </div>
                </div>
                <button
                  className="btn h-7 px-2 text-[11.5px]"
                  onClick={() => void toggle(item)}
                  disabled={busy === item.id}
                >
                  {busy === item.id ? (
                    <Loader2 size={11} className="spin" />
                  ) : item.running ? (
                    <Square size={11} />
                  ) : (
                    <Zap size={11} />
                  )}
                  {item.running ? t('tunnel.stop') : t('tunnel.start')}
                </button>
                <button
                  className="btn btn-ghost h-7 w-7 !p-0 text-rose-300/80 hover:text-[var(--danger)]"
                  onClick={() => void remove(item)}
                  disabled={busy === item.id}
                  title={t('tunnel.delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
