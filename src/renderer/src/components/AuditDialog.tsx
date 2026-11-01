import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import type { AuditEntry } from '@shared/types';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/cn';
import { formatDateTime, riskColor, riskLabelKey } from '../lib/format';

export function AuditDialog({ onClose }: { onClose: () => void }) {
  const activeServerId = useApp((state) => state.activeServerId);
  const servers = useApp((state) => state.servers);
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.audit
      .list(activeServerId ?? undefined, 200)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeServerId]);

  return (
    <Modal title={t('audit.title')} description={t('audit.desc')} onClose={onClose} width="max-w-3xl">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-[var(--muted)]">
          <Loader2 size={14} className="spin" />
          {t('audit.loading')}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-[12.5px] text-[var(--muted-2)]">
          <ShieldCheck size={22} />
          {t('audit.empty')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="bg-[var(--panel-2)] text-[11px] uppercase tracking-wider text-[var(--muted-2)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('audit.col.time')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('audit.col.server')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('audit.col.actor')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('audit.col.action')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('audit.col.risk')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('audit.col.result')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const server = servers.find((item) => item.id === entry.serverId);
                const risk = riskColor(entry.risk ?? 'medium');
                return (
                  <tr key={entry.id} className="border-t border-[var(--border)]/70 hover:bg-[var(--panel-2)]">
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--muted-2)]">
                      {formatDateTime(entry.ts, language)}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-[var(--text)]">{server?.name ?? entry.serverId}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10.5px]',
                          entry.actor === 'ai' ? 'bg-sky-400/10 text-[var(--blue)]' : 'bg-slate-400/10 text-slate-300',
                        )}
                      >
                        {entry.actor === 'ai' ? t('audit.actor.ai') : t('audit.actor.user')}
                      </span>
                    </td>
                    <td className="max-w-[260px] px-3 py-2">
                      <div className="truncate text-[var(--text)]" title={entry.detail}>
                        {entry.action}
                      </div>
                      <div className="truncate text-[11px] text-[var(--muted-2)]" title={entry.detail}>
                        {entry.detail}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {entry.risk && (
                        <span className={cn('rounded-full border px-1.5 py-0.5 text-[10.5px]', risk.text, risk.bg, risk.border)}>
                          {t(riskLabelKey(entry.risk))}
                        </span>
                      )}
                    </td>
                    <td className={cn('px-3 py-2', entry.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
                      {entry.ok ? t('audit.ok') : t('audit.fail')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
