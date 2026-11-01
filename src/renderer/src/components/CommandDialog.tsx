import { useState } from 'react';
import { Copy, Loader2, Sparkles, TerminalSquare } from 'lucide-react';
import type { CommandAnalysis } from '@shared/types';
import { Modal } from './Modal';
import { Markdown } from './Markdown';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { riskColor, riskLabelKey } from '../lib/format';

/** 命令分析：本地规则 + AI 解释，只分析不执行。 */
export function CommandDialog({
  serverId,
  onClose,
  onInsert,
}: {
  serverId: string;
  onClose: () => void;
  onInsert: (command: string) => void;
}) {
  const notify = useApp((state) => state.notify);
  const { t } = useI18n();
  const [command, setCommand] = useState('');
  const [result, setResult] = useState<CommandAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    const text = command.trim();
    if (!text) return;
    setLoading(true);
    setResult(null);
    try {
      const analysis = await api.ai.analyzeCommand(serverId, text);
      setResult(analysis);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    notify('success', t('command.copied'));
  };

  const risk = result ? riskColor(result.risk) : null;

  return (
    <Modal
      title={t('command.title')}
      description={t('command.desc')}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button className="btn" onClick={() => void copy()} disabled={!command.trim()}>
            <Copy size={13} />
            {t('command.copy')}
          </button>
          <button
            className="btn"
            onClick={() => onInsert(command)}
            disabled={!command.trim() || !result}
            title={t('command.insertTitle')}
          >
            <TerminalSquare size={13} />
            {t('command.insert')}
          </button>
          <button className="btn btn-primary" onClick={() => void analyze()} disabled={loading || !command.trim()}>
            {loading ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {loading ? t('command.analyzing') : t('command.analyze')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">{t('command.input')}</label>
          <textarea
            className="input mono min-h-[110px] text-[12.5px] leading-relaxed"
            placeholder={t('command.inputPlaceholder')}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            spellCheck={false}
          />
        </div>

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-[var(--muted)]">{t('command.risk.local')}</span>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11.5px] font-medium',
                  risk!.text,
                  risk!.bg,
                  risk!.border,
                )}
              >
                {t(riskLabelKey(result.risk))}
              </span>
              <span className="truncate text-[11.5px] text-[var(--muted-2)]">{result.reasons.join('；')}</span>
            </div>

            {result.explanation ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] text-[var(--muted)]">
                  <Sparkles size={11} className="text-[var(--accent)]" />
                  {t('command.ai.title')}
                </div>
                <Markdown content={result.explanation} />
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-[12px] text-[var(--muted-2)]">
                {result.error ? t('command.ai.failed', { error: result.error }) : t('command.ai.empty')}
              </div>
            )}
          </div>
        )}

        {!result && !loading && (
          <p className="text-[11.5px] leading-relaxed text-[var(--muted-2)]">{t('command.hint')}</p>
        )}
      </div>
    </Modal>
  );
}
