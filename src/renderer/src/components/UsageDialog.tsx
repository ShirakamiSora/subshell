import { useEffect, useState } from 'react';
import { Coins, Loader2, Save } from 'lucide-react';
import type { UsageSummary } from '@shared/types';
import { Modal } from './Modal';
import { useApp } from '../store/app';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/** 全局 Token 用量与按手工单价估算的金额。 */
export function UsageDialog({ onClose }: { onClose: () => void }) {
  const settings = useApp((state) => state.settings);
  const saveSettings = useApp((state) => state.saveSettings);
  const notify = useApp((state) => state.notify);
  const { t } = useI18n();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputPrice, setInputPrice] = useState(String(settings?.inputPricePerMTok ?? 0));
  const [outputPrice, setOutputPrice] = useState(String(settings?.outputPricePerMTok ?? 0));

  useEffect(() => {
    let cancelled = false;
    void api.usage
      .summary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary({ total: { input: 0, output: 0 }, servers: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const inPrice = Number(inputPrice) || 0;
  const outPrice = Number(outputPrice) || 0;
  const costOf = (input: number, output: number) =>
    (input / 1_000_000) * inPrice + (output / 1_000_000) * outPrice;
  const totalCost = summary ? costOf(summary.total.input, summary.total.output) : 0;
  const hasPrice = inPrice > 0 || outPrice > 0;

  const savePrices = async () => {
    await saveSettings({ inputPricePerMTok: inPrice, outputPricePerMTok: outPrice });
    notify('success', t('usage.saved'));
  };

  return (
    <Modal
      title={t('usage.title')}
      description={t('usage.desc')}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <button className="btn btn-primary" onClick={() => void savePrices()}>
          <Save size={13} />
          {t('usage.savePrices')}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t('usage.inputTokens')} value={summary ? formatTokens(summary.total.input) : '—'} />
          <Stat label={t('usage.outputTokens')} value={summary ? formatTokens(summary.total.output) : '—'} />
          <Stat
            label={t('usage.estimated')}
            value={hasPrice && summary ? `¥${totalCost.toFixed(2)}` : '—'}
          />
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
          <div className="mb-2 text-[12px] font-medium text-[var(--text)]">{t('usage.prices')}</div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--muted-2)]">{t('settings.usage.inputPrice')}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="input h-8 !w-32 text-[12.5px]"
                value={inputPrice}
                onChange={(event) => setInputPrice(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--muted-2)]">{t('settings.usage.outputPrice')}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="input h-8 !w-32 text-[12.5px]"
                value={outputPrice}
                onChange={(event) => setOutputPrice(event.target.value)}
              />
            </label>
            <span className="pb-1.5 text-[11px] text-[var(--muted-2)]">{t('usage.priceDesc')}</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-[var(--muted)]">
            <Coins size={12} />
            {t('usage.byServer')}
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="bg-[var(--panel-2)] text-[10.5px] uppercase tracking-wide text-[var(--muted-2)]">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">{t('audit.server')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('usage.input')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('usage.output')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('usage.messages')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('usage.estimate')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[var(--muted-2)]">
                      <Loader2 size={13} className="spin inline" />
                    </td>
                  </tr>
                )}
                {!loading && summary?.servers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[var(--muted-2)]">
                      {t('usage.empty')}
                    </td>
                  </tr>
                )}
                {summary?.servers.map((row) => (
                  <tr key={row.serverId} className="border-t border-[var(--border)]/70">
                    <td className="max-w-[180px] truncate px-3 py-1.5 text-[var(--text)]">{row.name}</td>
                    <td className="px-3 py-1.5 text-right">{formatTokens(row.input)}</td>
                    <td className="px-3 py-1.5 text-right">{formatTokens(row.output)}</td>
                    <td className="px-3 py-1.5 text-right text-[var(--muted-2)]">{row.messages}</td>
                    <td className="px-3 py-1.5 text-right">
                      {hasPrice ? `¥${costOf(row.input, row.output).toFixed(3)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--muted-2)]">{label}</div>
      <div className="mt-0.5 text-[19px] font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}
