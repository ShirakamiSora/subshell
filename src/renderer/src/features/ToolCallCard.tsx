import { useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Database,
  FileText,
  FolderOpen,
  Loader2,
  Play,
  RotateCw,
  ScrollText,
  Server,
  ShieldAlert,
  Sparkles,
  Square,
  Terminal,
  XCircle,
} from 'lucide-react';
import type { AgentToolCall, RiskLevel, ToolCallStatus } from '@shared/types';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/cn';
import { riskColor } from '../lib/format';

const iconMap: Record<string, typeof Activity> = {
  get_overview: Activity,
  list_services: Database,
  inspect_service: Server,
  service_action: RotateCw,
  list_processes: Activity,
  list_ports: Terminal,
  read_logs: ScrollText,
  read_file: FileText,
  list_files: FolderOpen,
  run_command: Terminal,
  update_profile: Sparkles,
  finish: CircleCheck,
};

const statusKeys: Record<ToolCallStatus, string> = {
  pending: 'tool.status.pending',
  awaiting_approval: 'tool.status.awaiting',
  running: 'tool.status.running',
  done: 'tool.status.done',
  error: 'tool.status.error',
  rejected: 'tool.status.rejected',
  cancelled: 'tool.status.cancelled',
};

const statusColor: Record<ToolCallStatus, string> = {
  pending: 'text-[var(--muted-2)]',
  awaiting_approval: 'text-[var(--warning)]',
  running: 'text-[var(--blue)]',
  done: 'text-[var(--success)]',
  error: 'text-[var(--danger)]',
  rejected: 'text-slate-400',
  cancelled: 'text-slate-400',
};

export function ToolCallCard({ serverId, call }: { serverId: string; call: AgentToolCall }) {
  const decide = useApp((state) => state.decide);
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [always, setAlways] = useState(false);
  const Icon = iconMap[call.name] ?? Terminal;
  const waiting = call.status === 'awaiting_approval';
  const risk = riskColor(call.risk);

  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5 transition-colors',
        waiting
          ? 'border-amber-400/35 bg-amber-400/[0.05]'
          : call.status === 'error'
            ? 'border-rose-400/20 bg-rose-400/[0.03]'
            : 'border-[var(--border)] bg-[var(--panel)]',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon size={13} className={cn('flex-none', waiting ? 'text-[var(--warning)]' : 'text-[var(--muted)]')} />
        <span className="min-w-0 truncate text-[13px] font-medium text-[var(--text)]">{call.title}</span>
        <span className={cn('flex-none rounded-full border px-1.5 py-px text-[10.5px]', risk.text, risk.bg, risk.border)}>
          {t(`tool.risk.${call.risk as RiskLevel}`)}
        </span>
        <span className={cn('ml-auto flex flex-none items-center gap-1 text-[11.5px]', statusColor[call.status])}>
          {call.status === 'running' && <Loader2 size={10} className="spin" />}
          {call.status === 'awaiting_approval' && <ShieldAlert size={10} />}
          {call.status === 'done' && <CircleCheck size={10} />}
          {call.status === 'error' && <XCircle size={10} />}
          {call.status === 'pending' && <CircleDashed size={10} />}
          {t(statusKeys[call.status])}
        </span>
        {call.stdout && (
          <button className="flex-none text-[var(--muted-2)] hover:text-[var(--text)]" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
      </div>

      {call.command && (
        <pre className="mono mt-2 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--code-bg)] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-[var(--text)]">
          <span className="select-none text-[var(--muted-2)]">$ </span>
          {call.command}
        </pre>
      )}

      {waiting && (
        <div className="mt-2">
          <div className="text-[12px] leading-relaxed text-[var(--warning)]">
            {t('tool.impact', { text: call.impact ?? '' })}
          </div>
          {call.rollback && (
            <div className="mt-0.5 text-[12px] text-[var(--muted-2)]">
              {t('tool.rollback', { text: call.rollback })}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="btn btn-primary h-7 px-3 text-[12px]"
              onClick={() => void decide(serverId, call.id, true, always)}
            >
              <Play size={11} />
              {t('tool.allow')}
            </button>
            <button className="btn btn-danger h-7 px-3 text-[12px]" onClick={() => void decide(serverId, call.id, false)}>
              <Square size={11} />
              {t('tool.deny')}
            </button>
            <label className="ml-1 flex cursor-pointer select-none items-center gap-1.5 text-[11.5px] text-[var(--muted-2)]">
              <input
                type="checkbox"
                className="h-3 w-3 accent-blue-500"
                checked={always}
                onChange={(event) => setAlways(event.target.checked)}
              />
              {t('tool.always')}
            </label>
          </div>
        </div>
      )}

      {call.status === 'rejected' && (
        <div className="mt-1.5 text-[12px] text-[var(--muted-2)]">
          {call.error ?? t('tool.rejectedByUser')}
        </div>
      )}
      {call.status === 'error' && call.error && !expanded && (
        <div className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--danger)]">{call.error}</div>
      )}

      {expanded && call.stdout && (
        <pre className="mono mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--code-bg)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--text)]">
          {call.stdout}
        </pre>
      )}
      {call.durationMs !== undefined && call.durationMs > 0 && (
        <div className="mt-1 text-right text-[10.5px] text-[var(--muted-2)]">
          {t('tool.duration', { ms: call.durationMs })}
        </div>
      )}
    </div>
  );
}
