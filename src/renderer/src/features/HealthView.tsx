import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  EyeOff,
  HeartPulse,
  Info,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { HealthIssue, IssueSeverity, IssueStatus, TicketRecord } from '@shared/types';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/cn';
import { formatRelative } from '../lib/format';

const severityStyle: Record<IssueSeverity, { text: string; bg: string; border: string; icon: typeof AlertTriangle }> = {
  critical: { text: 'text-[var(--danger)]', bg: 'bg-rose-400/10', border: 'border-rose-400/25', icon: AlertTriangle },
  warning: { text: 'text-[var(--warning)]', bg: 'bg-amber-400/10', border: 'border-amber-400/25', icon: AlertTriangle },
  info: { text: 'text-[var(--blue)]', bg: 'bg-sky-400/10', border: 'border-sky-400/25', icon: Info },
};

/** 0-100 分的环形仪表，纯 SVG，不依赖图表库。 */
function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color =
    grade === 'excellent'
      ? '#34d399'
      : grade === 'good'
        ? '#2dd4bf'
        : grade === 'fair'
          ? '#fbbf24'
          : '#f87171';

  return (
    <div className="relative h-[124px] w-[124px] flex-none">
      <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
        <circle cx="56" cy="56" r={radius} fill="none" stroke="var(--panel-3)" strokeWidth="9" />
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-semibold leading-none tracking-tight" style={{ color }}>
          {score}
        </span>
        <span className="mt-1 text-[11px] text-[var(--muted-2)]">/ 100</span>
      </div>
    </div>
  );
}

function IssueCard({
  serverId,
  issue,
}: {
  serverId: string;
  issue: HealthIssue;
}) {
  const { t } = useI18n();
  const resolveIssue = useApp((state) => state.resolveIssue);
  const sendMessage = useApp((state) => state.sendMessage);
  const setView = useApp((state) => state.setView);
  const style = severityStyle[issue.severity];
  const Icon = style.icon;
  const resolved = issue.status !== 'open';

  const fix = () => {
    setView('assistant');
    void sendMessage(
      serverId,
      `请处理体检发现的问题：${issue.title}\n\n已知信息：${issue.detail}\n\n建议方向：${issue.suggestion}\n\n请先只读诊断定位原因，需要变更操作时再请求我确认。`,
      issue.id,
    );
  };

  const setStatus = (status: IssueStatus) => {
    void resolveIssue(serverId, issue.id, status);
  };

  return (
    <div
      className={cn(
        'rounded-xl border px-3.5 py-3 transition-colors',
        resolved ? 'border-[var(--border)] bg-[var(--panel)] opacity-70' : `${style.border} ${style.bg}`,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon size={14} className={cn('mt-0.5 flex-none', resolved ? 'text-[var(--muted-2)]' : style.text)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[13px] font-medium', resolved ? 'text-[var(--muted)] line-through' : 'text-[var(--text)]')}>
              {issue.title}
            </span>
            <span className="rounded-full border border-[var(--border)] px-1.5 py-px text-[10.5px] text-[var(--muted-2)]">
              {t(`health.source.${issue.source}`)}
            </span>
            {issue.status === 'resolved' && (
              <span className="rounded-full bg-emerald-400/10 px-1.5 py-px text-[10.5px] text-[var(--success)]">
                {t('health.status.resolved')}
              </span>
            )}
            {issue.status === 'ignored' && (
              <span className="rounded-full bg-slate-400/10 px-1.5 py-px text-[10.5px] text-[var(--muted-2)]">
                {t('health.status.ignored')}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{issue.detail}</p>
          <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed text-[var(--muted-2)]">
            <Wrench size={11} className="mt-1 flex-none" />
            {issue.suggestion}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!resolved && (
              <>
                <button className="btn btn-primary h-7 px-2.5 text-[11.5px]" onClick={fix}>
                  <Sparkles size={11} />
                  {t('health.action.fix')}
                </button>
                <button className="btn h-7 px-2.5 text-[11.5px]" onClick={() => setStatus('resolved')}>
                  <CheckCircle2 size={11} />
                  {t('health.action.resolve')}
                </button>
                <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={() => setStatus('ignored')}>
                  <EyeOff size={11} />
                  {t('health.action.ignore')}
                </button>
              </>
            )}
            {resolved && (
              <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={() => setStatus('open')}>
                <RotateCcw size={11} />
                {t('health.action.reopen')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketTimeline({ tickets }: { tickets: TicketRecord[] }) {
  const { t } = useI18n();
  if (!tickets.length) {
    return <p className="text-[12px] leading-relaxed text-[var(--muted-2)]">{t('health.tickets.empty')}</p>;
  }
  return (
    <ol className="relative space-y-3 border-l border-[var(--border)] pl-4">
      {tickets.slice(0, 12).map((ticket) => (
        <li key={ticket.id} className="relative">
          <span
            className={cn(
              'absolute -left-[21px] top-1 h-2 w-2 rounded-full ring-2 ring-[var(--panel)]',
              ticket.ok ? 'bg-[var(--success)]' : 'bg-[var(--danger)]',
            )}
          />
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[12.5px] font-medium text-[var(--text)]">{ticket.title}</span>
            <span className="text-[11px] text-[var(--muted-2)]">{formatRelative(ticket.ts)}</span>
          </div>
          {ticket.command && (
            <pre className="mono mt-1 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--code-bg)] px-2 py-1 text-[11px] text-[var(--muted)]">
              $ {ticket.command}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}

export function HealthView({ serverId }: { serverId: string }) {
  const { t } = useI18n();
  const report = useApp((state) => state.reports[serverId]);
  const tickets = useApp((state) => state.tickets[serverId]) ?? [];
  const refreshHealth = useApp((state) => state.refreshHealth);
  const connection = useApp((state) => state.connections[serverId]);

  const open = useMemo(() => report?.issues.filter((issue) => issue.status === 'open') ?? [], [report]);
  const done = useMemo(() => report?.issues.filter((issue) => issue.status !== 'open') ?? [], [report]);

  const gradeLabel = report ? t(`health.grade.${report.score.grade}`) : '';

  return (
    <div className="scroll-area h-full px-4 py-4">
      <section className="panel-2 flex flex-wrap items-center gap-5 p-4">
        <ScoreRing score={report?.score.score ?? 100} grade={report?.score.grade ?? 'excellent'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <HeartPulse size={15} className="text-[var(--accent)]" />
            <h2 className="text-[14px] font-semibold text-[var(--text)]">{t('health.title')}</h2>
            {report && <span className="text-[12px] text-[var(--muted)]">· {gradeLabel}</span>}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted-2)]">
            {report
              ? t('health.summary', {
                  critical: report.score.critical,
                  warning: report.score.warning,
                  info: report.score.info,
                })
              : t('health.noData')}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 rounded-full border border-rose-400/25 bg-rose-400/10 px-2 py-0.5 text-[11.5px] text-[var(--danger)]">
              <AlertTriangle size={10} /> {t('health.stat.critical')} {report?.score.critical ?? 0}
            </span>
            <span className="flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[11.5px] text-[var(--warning)]">
              <CircleDot size={10} /> {t('health.stat.warning')} {report?.score.warning ?? 0}
            </span>
            <span className="flex items-center gap-1 rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[11.5px] text-[var(--blue)]">
              <Info size={10} /> {t('health.stat.info')} {report?.score.info ?? 0}
            </span>
            <button className="btn btn-ghost ml-1 h-7 px-2 text-[11.5px]" onClick={() => void refreshHealth(serverId)}>
              <RefreshCw size={11} />
              {t('health.action.recheck')}
            </button>
          </div>
        </div>
        <div className="hidden text-right text-[11.5px] text-[var(--muted-2)] xl:block">
          <div>
            {connection?.state === 'connected' ? t('health.live') : t('health.offline')}
          </div>
          {report && <div className="mt-1">{formatRelative(report.generatedAt)}</div>}
        </div>
      </section>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="space-y-2 xl:col-span-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[12.5px] font-semibold text-[var(--text)]">{t('health.section.open')}</h3>
            <span className="text-[11px] text-[var(--muted-2)]">{open.length}</span>
          </div>
          {open.length === 0 ? (
            <div className="panel-2 flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 size={22} className="text-[var(--success)]" />
              <div className="text-[13px] text-[var(--text)]">{t('health.empty')}</div>
              <div className="text-[12px] text-[var(--muted-2)]">{t('health.emptyHint')}</div>
            </div>
          ) : (
            open.map((issue) => <IssueCard key={issue.id} serverId={serverId} issue={issue} />)
          )}

          {done.length > 0 && (
            <>
              <div className="flex items-center justify-between px-1 pt-3">
                <h3 className="text-[12.5px] font-semibold text-[var(--text)]">{t('health.section.done')}</h3>
                <span className="text-[11px] text-[var(--muted-2)]">{done.length}</span>
              </div>
              {done.map((issue) => (
                <IssueCard key={issue.id} serverId={serverId} issue={issue} />
              ))}
            </>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Clock3 size={12} className="text-[var(--muted-2)]" />
            <h3 className="text-[12.5px] font-semibold text-[var(--text)]">{t('health.tickets.title')}</h3>
          </div>
          <div className="panel-2 p-3.5">
            <TicketTimeline tickets={tickets} />
          </div>
        </div>
      </div>
    </div>
  );
}
