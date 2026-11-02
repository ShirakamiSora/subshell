import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type {
  SecurityFinding,
  SecurityFindingStatus,
  SecurityRemediation,
  SecuritySeverity,
} from '@shared/types';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/cn';
import { formatRelative, riskColor, riskLabelKey } from '../lib/format';
import { ConfirmDialog } from '../components/Modal';

const severityStyle: Record<SecuritySeverity, { text: string; bg: string; border: string }> = {
  critical: { text: 'text-[var(--danger)]', bg: 'bg-rose-400/10', border: 'border-rose-400/25' },
  warning: { text: 'text-[var(--warning)]', bg: 'bg-amber-400/10', border: 'border-amber-400/25' },
  info: { text: 'text-[var(--blue)]', bg: 'bg-sky-400/10', border: 'border-sky-400/25' },
};

function ScoreRing({ score }: { score: number }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color = score >= 90 ? '#34d399' : score >= 70 ? '#2dd4bf' : score >= 50 ? '#fbbf24' : '#f87171';
  return (
    <div className="relative h-[104px] w-[104px] flex-none">
      <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="var(--panel-3)" strokeWidth="8" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[26px] font-semibold leading-none" style={{ color }}>
          {score}
        </span>
        <span className="mt-1 text-[10.5px] text-[var(--muted-2)]">/ 100</span>
      </div>
    </div>
  );
}

export function SecurityView({ serverId, active = true }: { serverId: string; active?: boolean }) {
  const { t } = useI18n();
  const report = useApp((state) => state.security[serverId]);
  const refreshSecurity = useApp((state) => state.refreshSecurity);
  const scanSecurity = useApp((state) => state.scanSecurity);
  const resolveFinding = useApp((state) => state.resolveFinding);
  const remediateFinding = useApp((state) => state.remediateFinding);
  const applyRemediation = useApp((state) => state.applyRemediation);
  const [scanning, setScanning] = useState(false);
  const [busyFinding, setBusyFinding] = useState<string | null>(null);
  const [confirmFinding, setConfirmFinding] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    void refreshSecurity(serverId);
  }, [active, serverId, refreshSecurity]);

  const scan = report?.scan ?? null;
  const findings = useMemo(() => report?.scan?.findings ?? [], [report]);
  const open = useMemo(() => findings.filter((finding) => finding.status === 'open'), [findings]);
  const done = useMemo(() => findings.filter((finding) => finding.status !== 'open'), [findings]);
  const remediations = report?.remediations ?? [];

  const remediationOf = (findingId: string): SecurityRemediation | undefined =>
    remediations.find((item) => item.findingId === findingId);

  return (
    <div className="scroll-area h-full px-4 py-4">
      <section className="panel-2 flex flex-wrap items-center gap-5 p-4">
        <ScoreRing score={scan?.score ?? 100} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="text-[var(--accent)]" />
            <h2 className="text-[14px] font-semibold text-[var(--text)]">{t('security.title')}</h2>
            {scan && (
              <span className="text-[11.5px] text-[var(--muted-2)]">
                · {t(`security.trigger.${scan.trigger}`)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted-2)]">
            {scan ? scan.summary : t('security.noData')}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 rounded-full border border-rose-400/25 bg-rose-400/10 px-2 py-0.5 text-[11.5px] text-[var(--danger)]">
              <AlertTriangle size={10} /> {t('security.critical')}{' '}
              {open.filter((finding) => finding.severity === 'critical').length}
            </span>
            <span className="flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[11.5px] text-[var(--warning)]">
              {t('security.warning')} {open.filter((finding) => finding.severity === 'warning').length}
            </span>
            <span className="flex items-center gap-1 rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[11.5px] text-[var(--blue)]">
              {t('security.info')} {open.filter((finding) => finding.severity === 'info').length}
            </span>
            <button
              className="btn btn-primary ml-1 h-7 px-2.5 text-[11.5px]"
              disabled={scanning}
              onClick={() => {
                setScanning(true);
                void scanSecurity(serverId).finally(() => setScanning(false));
              }}
            >
              {scanning ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}
              {scan ? t('security.rescan') : t('security.scan')}
            </button>
          </div>
        </div>
        <div className="hidden text-right text-[11.5px] text-[var(--muted-2)] xl:block">
          {scan ? (
            <>
              <div>{formatRelative(scan.finishedAt)}</div>
              <div className="mt-1">{t('security.autoHint')}</div>
            </>
          ) : (
            <div>{t('security.scanHint')}</div>
          )}
        </div>
      </section>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[12.5px] font-semibold text-[var(--text)]">{t('security.open')}</h3>
          <span className="text-[11px] text-[var(--muted-2)]">{open.length}</span>
        </div>

        {open.length === 0 ? (
          <div className="panel-2 flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 size={22} className="text-[var(--success)]" />
            <div className="text-[13px] text-[var(--text)]">{t('security.empty')}</div>
            <div className="max-w-lg text-[12px] text-[var(--muted-2)]">{t('security.emptyHint')}</div>
          </div>
        ) : (
          open.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              remediation={remediationOf(finding.id)}
              busy={busyFinding === finding.id}
              onRemediate={() => {
                setBusyFinding(finding.id);
                void remediateFinding(serverId, finding.id).finally(() => setBusyFinding(null));
              }}
              onApply={() => setConfirmFinding(finding.id)}
              onStatus={(status) => void resolveFinding(serverId, finding.id, status)}
            />
          ))
        )}

        {done.length > 0 && (
          <>
            <div className="flex items-center justify-between px-1 pt-3">
              <h3 className="text-[12.5px] font-semibold text-[var(--text)]">{t('security.done')}</h3>
              <span className="text-[11px] text-[var(--muted-2)]">{done.length}</span>
            </div>
            {done.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                remediation={remediationOf(finding.id)}
                busy={false}
                onRemediate={() => undefined}
                onApply={() => undefined}
                onStatus={(status) => void resolveFinding(serverId, finding.id, status)}
              />
            ))}
          </>
        )}
      </div>

      {confirmFinding && (
        <ConfirmDialog
          title={t('security.applyTitle')}
          message={t('security.applyMessage', {
            count: remediationOf(confirmFinding)?.steps.length ?? 0,
          })}
          confirmText={t('security.apply')}
          danger
          onCancel={() => setConfirmFinding(null)}
          onConfirm={() => {
            const findingId = confirmFinding;
            setConfirmFinding(null);
            void applyRemediation(serverId, findingId);
          }}
        />
      )}
    </div>
  );
}

function FindingCard({
  finding,
  remediation,
  busy,
  onRemediate,
  onApply,
  onStatus,
}: {
  finding: SecurityFinding;
  remediation?: SecurityRemediation;
  busy: boolean;
  onRemediate: () => void;
  onApply: () => void;
  onStatus: (status: SecurityFindingStatus) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const style = severityStyle[finding.severity];
  const resolved = finding.status !== 'open';

  return (
    <div
      className={cn(
        'rounded-xl border px-3.5 py-3',
        resolved ? 'border-[var(--border)] bg-[var(--panel)] opacity-75' : `${style.border} ${style.bg}`,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={14} className={cn('mt-0.5 flex-none', resolved ? 'text-[var(--muted-2)]' : style.text)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[13px] font-medium', resolved ? 'text-[var(--muted)]' : 'text-[var(--text)]')}>
              {finding.title}
            </span>
            <span className="rounded-full border border-[var(--border)] px-1.5 py-px text-[10.5px] text-[var(--muted-2)]">
              {t(`security.kind.${finding.kind}`)}
            </span>
            {finding.status === 'fixed' && (
              <span className="rounded-full bg-emerald-400/10 px-1.5 py-px text-[10.5px] text-[var(--success)]">
                {t('security.status.fixed')}
              </span>
            )}
            {finding.status === 'ignored' && (
              <span className="rounded-full bg-slate-400/10 px-1.5 py-px text-[10.5px] text-[var(--muted-2)]">
                {t('security.status.ignored')}
              </span>
            )}
            {finding.status === 'accepted' && (
              <span className="rounded-full bg-sky-400/10 px-1.5 py-px text-[10.5px] text-[var(--blue)]">
                {t('security.status.accepted')}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{finding.detail}</p>
          {finding.suggestion && (
            <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--muted-2)]">
              <Wrench size={11} className="mt-1 flex-none" />
              {finding.suggestion}
            </p>
          )}
          {finding.evidence && (
            <button
              className="mt-1 text-[10.5px] text-[var(--muted-2)] hover:text-[var(--text)]"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t('security.hideEvidence') : t('security.showEvidence')}
            </button>
          )}
          {expanded && finding.evidence && (
            <pre className="mono mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--code-bg)] px-2 py-1 text-[10.5px] text-[var(--muted)]">
              {finding.evidence}
            </pre>
          )}

          {!resolved && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button className="btn btn-primary h-7 px-2.5 text-[11.5px]" disabled={busy} onClick={onRemediate}>
                {busy ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
                {remediation ? t('security.regenerate') : t('security.remediate')}
              </button>
              {remediation && remediation.steps.length > 0 && (
                <button className="btn h-7 px-2.5 text-[11.5px]" onClick={onApply}>
                  {t('security.apply')}
                </button>
              )}
              <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={() => onStatus('fixed')}>
                <CheckCircle2 size={11} />
                {t('security.markFixed')}
              </button>
              <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={() => onStatus('ignored')}>
                <EyeOff size={11} />
                {t('security.ignore')}
              </button>
            </div>
          )}
          {resolved && (
            <button className="btn btn-ghost mt-2 h-7 px-2 text-[11.5px]" onClick={() => onStatus('open')}>
              <RotateCcw size={11} />
              {t('security.reopen')}
            </button>
          )}

          {remediation && (
            <RemediationPanel remediation={remediation} />
          )}
        </div>
      </div>
    </div>
  );
}

function RemediationPanel({ remediation }: { remediation: SecurityRemediation }) {
  const { t } = useI18n();
  return (
    <div className="mt-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2.5">
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--accent)]">
        <Wrench size={11} />
        {t('security.plan')}
        <span className="ml-auto text-[10px] text-[var(--muted-2)]">
          {t(`security.planStatus.${remediation.status}`)}
        </span>
      </div>
      {remediation.summary && (
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text)]">{remediation.summary}</p>
      )}
      {remediation.impact && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">
          <span className="text-[var(--muted-2)]">{t('security.impact')}：</span>
          {remediation.impact}
        </p>
      )}
      {remediation.steps.length > 0 && (
        <ol className="mt-1.5 space-y-1.5">
          {remediation.steps.map((step, index) => (
            <li key={`${step.title}-${index}`} className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="font-medium text-[var(--muted)]">
                  {index + 1}. {step.title}
                </span>
                <span
                  className={cn(
                    'ml-auto rounded-full border px-1.5 py-px text-[10px]',
                    riskColor(step.risk).text,
                    riskColor(step.risk).bg,
                    riskColor(step.risk).border,
                  )}
                >
                  {t(riskLabelKey(step.risk))}
                </span>
              </div>
              {step.commands.map((command) => (
                <pre
                  key={command}
                  className="mono mt-1 whitespace-pre-wrap break-all text-[11px] text-[var(--text)]"
                >
                  $ {command}
                </pre>
              ))}
              {step.note && <p className="mt-1 text-[10.5px] text-[var(--muted-2)]">{step.note}</p>}
            </li>
          ))}
        </ol>
      )}
      {remediation.conflicts.length > 0 && (
        <div className="mt-1.5 rounded border border-amber-400/25 bg-amber-400/[0.05] px-2 py-1.5">
          <div className="flex items-center gap-1 text-[10.5px] font-medium text-[var(--warning)]">
            <AlertTriangle size={10} />
            {t('security.conflicts')}
          </div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-[var(--muted)]">
            {remediation.conflicts.map((conflict) => (
              <li key={`${conflict.target}-${conflict.reason}`}>
                <span className="text-[var(--text)]">{conflict.target}</span>：{conflict.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {remediation.verification.length > 0 && (
        <div className="mt-1.5">
          <div className="text-[10.5px] font-medium text-[var(--muted-2)]">{t('security.verification')}</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-[var(--muted)]">
            {remediation.verification.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {remediation.error && <p className="mt-1 text-[11px] text-[var(--danger)]">{remediation.error}</p>}
    </div>
  );
}
