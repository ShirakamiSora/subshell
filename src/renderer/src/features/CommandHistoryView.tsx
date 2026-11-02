import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  XCircle,
} from 'lucide-react';
import type { CommandHistoryEntry, CommandSource, RiskLevel } from '@shared/types';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/cn';
import { formatDateTime, formatRelative, riskColor, riskLabelKey } from '../lib/format';
import { ConfirmDialog } from '../components/Modal';
import { Markdown } from '../components/Markdown';

const EMPTY: CommandHistoryEntry[] = [];

const sourceKeys: Record<CommandSource, string> = {
  ai: 'history.source.ai',
  terminal: 'history.source.terminal',
  manual: 'history.source.manual',
  cluster: 'history.source.cluster',
  mcp: 'history.source.mcp',
  rollback: 'history.source.rollback',
  security: 'history.source.security',
};

const sources: (CommandSource | 'all')[] = [
  'all',
  'ai',
  'terminal',
  'manual',
  'cluster',
  'mcp',
  'rollback',
  'security',
];

function RiskBadge({ risk }: { risk: RiskLevel }) {
  const { t } = useI18n();
  const color = riskColor(risk);
  return (
    <span className={cn('rounded-full border px-1.5 py-px text-[10.5px]', color.text, color.bg, color.border)}>
      {t(riskLabelKey(risk))}
    </span>
  );
}

/** 命令历史回顾：列表、详情、命令分析与智能回退。 */
export function CommandHistoryView({ serverId, active = true }: { serverId: string; active?: boolean }) {
  const { t } = useI18n();
  const entries = useApp((state) => state.commands[serverId]) ?? EMPTY;
  const refreshCommands = useApp((state) => state.refreshCommands);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<CommandSource | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loading, setLoading] = useState(false);

  // 视图首次激活时才读取，避免每次连接服务器都额外查询历史表。
  useEffect(() => {
    if (!active) return;
    setLoading(true);
    void refreshCommands(serverId).finally(() => setLoading(false));
  }, [active, serverId, refreshCommands]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (source !== 'all' && entry.source !== source) return false;
      if (!keyword) return true;
      return (
        entry.command.toLowerCase().includes(keyword) ||
        (entry.purpose ?? '').toLowerCase().includes(keyword)
      );
    });
  }, [entries, query, source]);

  const selected = filtered.find((entry) => entry.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-none flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text)]">
          <History size={14} className="text-[var(--accent)]" />
          {t('history.title')}
          <span className="text-[11px] font-normal text-[var(--muted-2)]">
            {t('history.count', { count: entries.length })}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--muted-2)]" />
            <input
              className="input h-7 !w-48 !pl-7 text-[12px]"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('history.search')}
            />
          </div>
          <select
            className="input h-7 !w-24 text-[12px]"
            value={source}
            onChange={(event) => setSource(event.target.value as CommandSource | 'all')}
          >
            {sources.map((item) => (
              <option key={item} value={item}>
                {item === 'all' ? t('history.source.all') : t(sourceKeys[item])}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost h-7 w-7 !p-0"
            title={t('common.refresh')}
            onClick={() => {
              setLoading(true);
              void refreshCommands(serverId).finally(() => setLoading(false));
            }}
          >
            <RefreshCw size={12} className={loading ? 'spin' : undefined} />
          </button>
          <button
            className="btn btn-ghost h-7 px-2 text-[11.5px] text-rose-300/80 hover:text-[var(--danger)]"
            onClick={() => setConfirmClear(true)}
            disabled={!entries.length}
          >
            <Trash2 size={11} />
            {t('history.clear')}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="scroll-area min-w-0 flex-1 px-3 py-3">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[12.5px] text-[var(--muted-2)]">
              <History size={22} />
              <span>{entries.length ? t('history.noMatch') : t('history.empty')}</span>
              {!entries.length && <span className="max-w-md text-[11.5px]">{t('history.emptyHint')}</span>}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === selectedId}
                  onClick={() => setSelectedId(entry.id === selectedId ? null : entry.id)}
                />
              ))}
            </div>
          )}
        </div>

        {selected && (
          <aside className="scroll-area w-[420px] flex-none border-l border-[var(--border)] bg-[var(--panel)] px-3.5 py-3">
            <EntryDetail serverId={serverId} entry={selected} onClose={() => setSelectedId(null)} />
          </aside>
        )}
      </div>

      {confirmClear && (
        <ConfirmDialog
          title={t('history.clearTitle')}
          message={t('history.clearMessage')}
          confirmText={t('common.delete')}
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            void useApp.getState().clearCommandHistory(serverId);
          }}
        />
      )}
    </div>
  );
}

function EntryRow({
  entry,
  active,
  onClick,
}: {
  entry: CommandHistoryEntry;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border px-3 py-2 text-left transition-colors',
        active
          ? 'border-teal-400/35 bg-teal-400/[0.06]'
          : 'border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)]',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-[var(--text)]">
          <span className="text-[var(--muted-2)]">$ </span>
          {entry.command}
        </span>
        <RiskBadge risk={entry.risk} />
        {entry.reverted && (
          <span className="rounded-full bg-sky-400/10 px-1.5 py-px text-[10.5px] text-[var(--blue)]">
            {t('history.reverted')}
          </span>
        )}
        {entry.analysis && <Sparkles size={11} className="text-[var(--accent)]" />}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-2)]">
        <span className="rounded bg-[var(--panel-2)] px-1.5 py-px">{t(sourceKeys[entry.source])}</span>
        <span>{formatRelative(entry.ts)}</span>
        {entry.purpose && <span className="truncate">· {entry.purpose}</span>}
        <span className={entry.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
          {entry.ok ? t('history.ok') : t('history.failed')}
          {entry.exitCode !== null && entry.exitCode !== undefined ? ` (${entry.exitCode})` : ''}
        </span>
      </div>
    </button>
  );
}

function EntryDetail({
  serverId,
  entry,
  onClose,
}: {
  serverId: string;
  entry: CommandHistoryEntry;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const analyze = useApp((state) => state.analyzeCommandEntry);
  const planRollback = useApp((state) => state.planRollback);
  const applyRollback = useApp((state) => state.applyRollback);
  const deleteEntry = useApp((state) => state.deleteCommandEntry);
  const [busy, setBusy] = useState<'analyze' | 'plan' | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [note, setNote] = useState('');
  const [showOutput, setShowOutput] = useState(false);

  const plan = entry.rollback;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--text)]">{t('history.detail')}</h3>
        <button className="btn btn-ghost ml-auto h-6 w-6 !p-0" onClick={onClose} title={t('common.close')}>
          <XCircle size={13} />
        </button>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
        <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[var(--text)]">
          {entry.command}
        </pre>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted-2)]">
          <RiskBadge risk={entry.risk} />
          <span>{formatDateTime(entry.ts)}</span>
          <span>· {t(sourceKeys[entry.source])}</span>
          {entry.durationMs !== undefined && <span>· {entry.durationMs}ms</span>}
          <span className={entry.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
            {entry.ok ? t('history.ok') : t('history.failed')}
          </span>
        </div>
        {entry.purpose && <p className="mt-1.5 text-[11.5px] text-[var(--muted)]">{entry.purpose}</p>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          className="btn btn-primary h-7 px-2.5 text-[11.5px]"
          disabled={busy !== null}
          onClick={() => {
            setBusy('analyze');
            void analyze(serverId, entry.id).finally(() => setBusy(null));
          }}
        >
          {busy === 'analyze' ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
          {entry.analysis ? t('history.reanalyze') : t('history.analyze')}
        </button>
        <button
          className="btn h-7 px-2.5 text-[11.5px]"
          disabled={busy !== null}
          onClick={() => {
            setBusy('plan');
            void planRollback(serverId, entry.id, note.trim() || undefined).finally(() => setBusy(null));
          }}
        >
          {busy === 'plan' ? <Loader2 size={11} className="spin" /> : <Undo2 size={11} />}
          {plan ? t('history.replan') : t('history.rollback')}
        </button>
        <button
          className="btn btn-ghost h-7 px-2 text-[11.5px] text-rose-300/80 hover:text-[var(--danger)]"
          onClick={() => void deleteEntry(serverId, entry.id)}
        >
          <Trash2 size={11} />
          {t('common.delete')}
        </button>
      </div>

      <div>
        <button
          className="flex items-center gap-1 text-[11.5px] text-[var(--muted)] hover:text-[var(--text)]"
          onClick={() => setShowOutput((value) => !value)}
        >
          {showOutput ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {t('history.output')}
        </button>
        {showOutput && (
          <pre className="mono mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--code-bg)] px-2 py-1.5 text-[11px] text-[var(--muted)]">
            {entry.stdout || t('history.noOutput')}
            {entry.stderr ? `\n\n[stderr]\n${entry.stderr}` : ''}
          </pre>
        )}
      </div>

      {entry.analysis && (
        <section className="rounded-lg border border-sky-400/20 bg-sky-400/[0.04] p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--blue)]">
            <Sparkles size={12} />
            {t('history.analysis')}
          </div>
          {entry.analysis.summary ? (
            <div className="mt-1.5">
              <Markdown content={entry.analysis.summary} />
            </div>
          ) : (
            <p className="mt-1.5 text-[11.5px] text-[var(--muted-2)]">{t('history.analysisEmpty')}</p>
          )}
          {entry.analysis.impact && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
              <span className="text-[var(--muted-2)]">{t('history.impact')}：</span>
              {entry.analysis.impact}
            </p>
          )}
          {entry.analysis.riskNotes.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11.5px] text-[var(--muted)]">
              {entry.analysis.riskNotes.map((noteItem) => (
                <li key={noteItem}>{noteItem}</li>
              ))}
            </ul>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-[var(--muted-2)]">
            <span>
              {entry.analysis.reversible ? t('history.reversible') : t('history.notReversible')}
            </span>
            {entry.analysis.model && <span>· {entry.analysis.model}</span>}
          </div>
          {entry.analysis.error && (
            <p className="mt-1 text-[11px] text-[var(--warning)]">{entry.analysis.error}</p>
          )}
        </section>
      )}

      {plan && (
        <section className="rounded-lg border border-amber-400/25 bg-amber-400/[0.04] p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--warning)]">
            <RotateCcw size={12} />
            {t('history.rollbackPlan')}
            <span className="ml-auto rounded-full border border-[var(--border)] px-1.5 py-px text-[10px] text-[var(--muted-2)]">
              {t(`history.confidence.${plan.confidence}`)}
            </span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text)]">{plan.summary}</p>
          {plan.steps.length > 0 && (
            <ol className="mt-2 space-y-1.5">
              {plan.steps.map((step, index) => {
                const color = riskColor(step.risk);
                return (
                  <li key={`${step.command}-${index}`} className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted-2)]">
                      <span className="font-medium text-[var(--muted)]">
                        {index + 1}. {step.purpose}
                      </span>
                      <span className={cn('ml-auto rounded-full border px-1.5 py-px text-[10px]', color.text, color.bg, color.border)}>
                        {t(riskLabelKey(step.risk))}
                      </span>
                    </div>
                    <pre className="mono mt-1 whitespace-pre-wrap break-all text-[11.5px] text-[var(--text)]">
                      $ {step.command}
                    </pre>
                    {step.risk === 'blocked' && (
                      <p className="mt-1 text-[10.5px] text-[var(--danger)]">{t('history.stepBlocked')}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {plan.predictions.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1 text-[11px] font-medium text-[var(--warning)]">
                <AlertTriangle size={11} />
                {t('history.predictions')}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-[var(--muted)]">
                {plan.predictions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.conflicts.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] font-medium text-[var(--muted-2)]">{t('history.conflicts')}</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-[var(--muted)]">
                {plan.conflicts.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.error && <p className="mt-1.5 text-[11px] text-[var(--danger)]">{plan.error}</p>}
          {plan.status === 'planned' && plan.steps.length > 0 && (
            <>
              <textarea
                className="input mt-2 min-h-[54px] resize-y text-[11.5px]"
                placeholder={t('history.rollbackNote')}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  className="btn btn-primary h-7 px-2.5 text-[11.5px]"
                  onClick={() => setConfirmRollback(true)}
                >
                  <Undo2 size={11} />
                  {t('history.applyRollback')}
                </button>
                <span className="text-[10.5px] text-[var(--muted-2)]">{t('history.rollbackHint')}</span>
              </div>
            </>
          )}
          {plan.results && plan.results.length > 0 && (
            <div className="mt-2 space-y-1">
              {plan.results.map((result, index) => (
                <div key={`${result.command}-${index}`} className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className={result.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                      {result.ok ? t('history.ok') : t('history.failed')}
                    </span>
                    <span className="mono truncate text-[var(--muted-2)]">{result.command}</span>
                  </div>
                  <pre className="mono mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10.5px] text-[var(--muted)]">
                    {result.output}
                  </pre>
                </div>
              ))}
            </div>
          )}
          <div className="mt-1.5 text-[10.5px] text-[var(--muted-2)]">
            {t(`history.planStatus.${plan.status}`)} · {formatRelative(plan.generatedAt)}
          </div>
        </section>
      )}

      {confirmRollback && (
        <ConfirmDialog
          title={t('history.rollbackConfirmTitle')}
          message={t('history.rollbackConfirmMessage', { count: plan?.steps.length ?? 0 })}
          confirmText={t('history.applyRollback')}
          danger
          onCancel={() => setConfirmRollback(false)}
          onConfirm={() => {
            setConfirmRollback(false);
            void applyRollback(serverId, entry.id);
          }}
        />
      )}
    </div>
  );
}
