import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Cpu,
  Database,
  HardDrive,
  HeartPulse,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
  Sparkles,
  SquareTerminal,
  Wifi,
} from 'lucide-react';
import type { ServerProfile, ServiceState } from '@shared/types';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { Sparkline } from '../components/Sparkline';
import { Markdown } from '../components/Markdown';
import { cn } from '../lib/cn';
import {
  formatKb,
  formatPercent,
  formatRate,
  formatRelative,
  serviceStateColor,
  serviceStateKey,
  severityColor,
} from '../lib/format';

export function Overview({ serverId }: { serverId: string }) {
  const runtime = useApp((state) => state.runtimes[serverId]);
  const profile = useApp((state) => state.profiles[serverId]);
  const connection = useApp((state) => state.connections[serverId]);
  const connect = useApp((state) => state.connect);
  const { t } = useI18n();

  if (!runtime || !runtime.samples.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--muted)]">
        <Server size={26} className="text-[var(--muted-2)]" />
        <div className="text-[13.5px]">
          {connection?.state === 'connecting'
            ? t('overview.connecting')
            : connection?.state === 'error'
              ? t('overview.connectFailed', { error: connection.error ?? '—' })
              : t('overview.notConnected')}
        </div>
        {connection?.state !== 'connecting' && (
          <button className="btn btn-primary" onClick={() => void connect(serverId)}>
            {t('overview.connect')}
          </button>
        )}
      </div>
    );
  }

  const latest = runtime.samples.at(-1)!;
  const window = runtime.samples.slice(-60);
  const services = runtime.services.length ? runtime.services : (profile?.services ?? []);

  return (
    <div className="scroll-area h-full px-4 py-4">
      <HealthStrip serverId={serverId} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          icon={Cpu}
          label={t('overview.metric.cpu')}
          value={formatPercent(latest.cpuPercent, 1)}
          sub={t('overview.load1', { value: latest.load1.toFixed(2) })}
          percent={latest.cpuPercent}
          color="#2dd4bf"
          spark={window.map((sample) => sample.cpuPercent)}
        />
        <MetricCard
          icon={MemoryStick}
          label={t('overview.metric.memory')}
          value={formatPercent(latest.memUsedPercent, 1)}
          sub={`${formatKb(latest.memUsedKb)} / ${formatKb(latest.memTotalKb)}`}
          percent={latest.memUsedPercent}
          color="#60a5fa"
          spark={window.map((sample) => sample.memUsedPercent)}
        />
        <MetricCard
          icon={HardDrive}
          label={t('overview.metric.disk')}
          value={formatPercent(latest.diskUsedPercent, 1)}
          sub={t('overview.diskFree', { value: formatKb(latest.diskTotalKb - latest.diskUsedKb) })}
          percent={latest.diskUsedPercent}
          color="#a78bfa"
          spark={window.map((sample) => sample.diskUsedPercent)}
          max={100}
        />
        <MetricCard
          icon={Activity}
          label={t('overview.metric.load')}
          value={latest.load1.toFixed(2)}
          sub={t('overview.cores', { cores: profile?.hardware.cpuCores ?? '?', load: latest.load5.toFixed(2) })}
          percent={Math.min(100, (latest.load1 / Math.max(1, profile?.hardware.cpuCores ?? 1)) * 100)}
          color="#fbbf24"
          spark={window.map((sample) => sample.load1)}
          valueIsPercent={false}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ServicePanel serverId={serverId} services={services} />
        </div>
        <div className="flex flex-col gap-3">
          <SummaryCard serverId={serverId} />
          <EventPanel serverId={serverId} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <InfoPanel profile={profile ?? null} running={latest} />
        </div>
        <PortPanel serverId={serverId} />
      </div>
    </div>
  );
}

/** 概览页顶部的体检条：一眼看到健康分与问题数量，点击进入体检页。 */
function HealthStrip({ serverId }: { serverId: string }) {
  const { t } = useI18n();
  const report = useApp((state) => state.reports[serverId]);
  const setView = useApp((state) => state.setView);
  if (!report) return null;

  const { score, grade, critical, warning, info } = report.score;
  const color =
    grade === 'excellent' ? '#34d399' : grade === 'good' ? '#2dd4bf' : grade === 'fair' ? '#fbbf24' : '#f87171';

  return (
    <button
      onClick={() => setView('health')}
      className="panel-2 mb-3 flex w-full flex-wrap items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:border-[var(--border-strong)]"
    >
      <HeartPulse size={14} className="text-[var(--accent)]" />
      <span className="text-[12px] text-[var(--muted)]">{t('health.title')}</span>
      <span className="text-[18px] font-semibold leading-none" style={{ color }}>
        {score}
      </span>
      <span className="text-[12px] text-[var(--muted-2)]">{t(`health.grade.${grade}`)}</span>
      <span className="flex items-center gap-2.5 text-[11.5px]">
        <span className="text-[var(--danger)]">
          {t('health.stat.critical')} {critical}
        </span>
        <span className="text-[var(--warning)]">
          {t('health.stat.warning')} {warning}
        </span>
        <span className="text-[var(--blue)]">
          {t('health.stat.info')} {info}
        </span>
      </span>
      <span className="ml-auto text-[11.5px] text-[var(--accent)]">{t('health.action.recheck')} →</span>
    </button>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  percent,
  color,
  spark,
  max,
  valueIsPercent = true,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub: string;
  percent: number;
  color: string;
  spark: number[];
  max?: number;
  valueIsPercent?: boolean;
}) {
  const abnormal = valueIsPercent && percent >= 90;
  const { t } = useI18n();
  return (
    <div className="panel-2 relative overflow-hidden p-3.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)]">
          <Icon size={12} />
          {label}
        </span>
        {abnormal && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--warning)]">
            <AlertTriangle size={10} />
            {t('overview.high')}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn('text-[23px] font-semibold tracking-tight', abnormal ? 'text-amber-200' : 'text-[var(--text)]')}>
          {value}
        </span>
      </div>
      <div className="truncate text-[11.5px] text-[var(--muted-2)]">{sub}</div>
      <Sparkline className="mt-2 w-full" width={260} height={36} data={spark} color={color} max={max} />
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--panel-3)]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color, opacity: 0.75 }}
        />
      </div>
    </div>
  );
}

function SummaryCard({ serverId }: { serverId: string }) {
  const runtime = useApp((state) => state.runtimes[serverId]);
  const profile = useApp((state) => state.profiles[serverId]);
  const summarize = useApp((state) => state.summarize);
  const agents = useApp((state) => state.agents[serverId]);
  const [loading, setLoading] = useState(false);
  const { t, language } = useI18n();
  const summary = runtime?.summary?.text ?? profile?.summary ?? '';
  const ts = runtime?.summary?.ts;

  const refresh = async () => {
    setLoading(true);
    try {
      await summarize(serverId);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel-2 flex min-h-[160px] flex-col p-4">
      <header className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text)]">
          <Sparkles size={13} className="text-[var(--accent)]" />
          {t('overview.summary.title')}
        </h3>
        <button
          className="btn btn-ghost h-6 w-6 !p-0"
          onClick={() => void refresh()}
          disabled={loading || agents?.state === 'thinking'}
          title={t('overview.summary.regenerate')}
        >
          <RefreshCw size={12} className={cn(loading && 'spin')} />
        </button>
      </header>
      <div className="mt-2 flex-1 overflow-hidden">
        {summary ? (
          <div className="line-clamp-[10] text-[12.5px] leading-relaxed text-[var(--muted)]">
            <Markdown content={summary} />
          </div>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-[var(--muted-2)]">{t('overview.summary.empty')}</p>
        )}
      </div>
      {ts && (
        <div className="mt-2 text-[11px] text-[var(--muted-2)]">
          {t('overview.summary.updated', { time: formatRelative(ts, language) })}
        </div>
      )}
    </section>
  );
}

function EventPanel({ serverId }: { serverId: string }) {
  const runtime = useApp((state) => state.runtimes[serverId]);
  const { t, language } = useI18n();
  const events = runtime?.events.slice(0, 8) ?? [];

  return (
    <section className="panel-2 flex min-h-[160px] flex-col p-4">
      <header className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text)]">
          <AlertTriangle size={13} className="text-[var(--warning)]" />
          {t('overview.events.title')}
        </h3>
        <span className="text-[11px] text-[var(--muted-2)]">
          {t('overview.events.total', { count: runtime?.events.length ?? 0 })}
        </span>
      </header>
      <div className="mt-2 flex-1 space-y-2">
        {events.length === 0 && <p className="text-[12.5px] text-[var(--muted-2)]">{t('overview.events.empty')}</p>}
        {events.map((event) => (
          <div key={event.id} className="flex items-start gap-2">
            <span className={cn('mt-1.5 dot flex-none', severityColor(event.severity))} />
            <div className="min-w-0">
              <div className="truncate text-[12.5px] text-[var(--text)]">{event.title}</div>
              <div className="text-[11px] text-[var(--muted-2)]">{formatRelative(event.ts, language)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const serviceFilters: { key: ServiceState | 'all'; labelKey: string }[] = [
  { key: 'all', labelKey: 'overview.services.all' },
  { key: 'running', labelKey: 'overview.services.running' },
  { key: 'failed', labelKey: 'overview.services.failed' },
  { key: 'stopped', labelKey: 'overview.services.stopped' },
];

function ServicePanel({
  serverId,
  services,
}: {
  serverId: string;
  services: { name: string; kind: string; state: ServiceState; description?: string; ports?: string[]; enabled?: boolean }[];
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ServiceState | 'all'>('all');
  const sendMessage = useApp((state) => state.sendMessage);
  const setView = useApp((state) => state.setView);

  const filtered = useMemo(() => {
    const list = filter === 'all' ? services : services.filter((service) => service.state === filter);
    return [...list].sort((a, b) => {
      const rank = (state: ServiceState) => (state === 'failed' ? 0 : state === 'running' ? 1 : 2);
      return rank(a.state) - rank(b.state) || a.name.localeCompare(b.name);
    });
  }, [services, filter]);

  const ask = (text: string) => {
    setView('assistant');
    void sendMessage(serverId, text);
  };

  return (
    <section className="panel-2 flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Database size={13} className="text-[var(--muted)]" />
          <h3 className="text-[12.5px] font-semibold text-[var(--text)]">{t('overview.services.title')}</h3>
          <span className="rounded-full bg-[var(--panel-3)] px-1.5 py-0.5 text-[11px] text-[var(--muted-2)]">
            {services.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {serviceFilters.map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={cn(
                'rounded-md px-2 py-1 text-[11.5px] transition-colors',
                filter === item.key
                  ? 'bg-[var(--panel-3)] text-[var(--text)]'
                  : 'text-[var(--muted-2)] hover:text-[var(--text)]',
              )}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
      </header>

      <div className="scroll-area max-h-[420px] flex-1">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-[var(--panel-2)] text-[11px] uppercase tracking-wider text-[var(--muted-2)]">
            <tr>
              <th className="px-4 py-2 text-left font-medium">{t('overview.services.col.service')}</th>
              <th className="px-2 py-2 text-left font-medium">{t('overview.services.col.state')}</th>
              <th className="px-2 py-2 text-left font-medium">{t('overview.services.col.port')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('overview.services.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[12.5px] text-[var(--muted-2)]">
                  {t('overview.services.empty')}
                </td>
              </tr>
            )}
            {filtered.map((service) => (
              <tr key={`${service.kind}-${service.name}`} className="group border-t border-[var(--border)]/60 hover:bg-[var(--panel-3)]/50">
                <td className="max-w-[280px] px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-[var(--text)]">{service.name}</span>
                    {service.kind === 'docker' && (
                      <span className="rounded bg-sky-400/10 px-1 text-[9px] text-[var(--blue)]">
                        {t('overview.services.container')}
                      </span>
                    )}
                  </div>
                  {service.description && (
                    <div className="truncate text-[11.5px] text-[var(--muted-2)]">{service.description}</div>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  <span className={cn('flex items-center gap-1.5 text-[12px]', serviceStateColor(service.state))}>
                    <span className={cn('dot h-1.5 w-1.5', {
                      'bg-[var(--success)]': service.state === 'running',
                      'bg-[var(--danger)]': service.state === 'failed',
                      'bg-slate-500': service.state === 'stopped',
                      'bg-[var(--warning)]': service.state === 'unknown',
                    })} />
                    {t(serviceStateKey(service.state))}
                  </span>
                </td>
                <td className="px-2 py-2 text-[12px] text-[var(--muted-2)]">
                  {service.ports?.slice(0, 3).join(', ') || '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {service.state === 'running' ? (
                      <>
                        <button
                          className="rounded px-1.5 py-0.5 text-[11.5px] text-[var(--muted)] hover:bg-[var(--panel-3)] hover:text-[var(--text)]"
                          onClick={() => ask(t('overview.services.ask.restart', { name: service.name }))}
                        >
                          {t('overview.services.action.restart')}
                        </button>
                        <button
                          className="rounded px-1.5 py-0.5 text-[11.5px] text-[var(--muted)] hover:bg-[var(--panel-3)] hover:text-[var(--text)]"
                          onClick={() => ask(t('overview.services.ask.stop', { name: service.name }))}
                        >
                          {t('overview.services.action.stop')}
                        </button>
                      </>
                    ) : (
                      <button
                        className="rounded px-1.5 py-0.5 text-[11.5px] text-emerald-300/90 hover:bg-[var(--panel-3)] hover:text-[var(--success)]"
                        onClick={() => ask(t('overview.services.ask.start', { name: service.name }))}
                      >
                        {t('overview.services.action.start')}
                      </button>
                    )}
                    <button
                      className="rounded px-1.5 py-0.5 text-[11.5px] text-[var(--muted)] hover:bg-[var(--panel-3)] hover:text-[var(--text)]"
                      onClick={() => ask(t('overview.services.ask.logs', { name: service.name }))}
                    >
                      {t('overview.services.action.logs')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InfoPanel({
  profile,
  running,
}: {
  profile: ServerProfile | null;
  running: { uptimeSeconds: number; processCount: number; netRxBytesPerSec: number; netTxBytesPerSec: number };
}) {
  const { t, language } = useI18n();
  const setDialog = useApp((state) => state.setDialog);
  const rows = [
    {
      icon: Server,
      label: t('overview.info.system'),
      value: profile ? `${profile.os.name} ${profile.os.version}` : '—',
    },
    {
      icon: Cpu,
      label: t('overview.info.cpu'),
      value: profile ? `${profile.hardware.cpuModel || 'Unknown'} × ${profile.hardware.cpuCores}` : '—',
    },
    {
      icon: MemoryStick,
      label: t('overview.info.memory'),
      value: profile ? formatKb(profile.hardware.memTotalKb) : '—',
    },
    {
      icon: HardDrive,
      label: t('overview.info.disk'),
      value: profile ? `${formatKb(profile.hardware.diskUsedKb)} / ${formatKb(profile.hardware.diskTotalKb)}` : '—',
    },
    {
      icon: Wifi,
      label: t('overview.info.network'),
      value:
        profile?.network.interfaces
          .filter((item) => item.name !== 'lo')
          .map((item) => `${item.name} ${item.addresses[0] ?? ''}`)
          .join(' · ') || '—',
    },
    {
      icon: Network,
      label: t('overview.info.traffic'),
      value: `↓ ${formatRate(running.netRxBytesPerSec)} · ↑ ${formatRate(running.netTxBytesPerSec)}`,
    },
  ];

  return (
    <section className="panel-2 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[12.5px] font-semibold text-[var(--text)]">{t('overview.info.title')}</h3>
        <div className="flex items-center gap-2">
          {profile && (
            <span className="text-[11px] text-[var(--muted-2)]">
              {t('overview.info.scanned', { time: formatRelative(new Date(profile.scannedAt).getTime(), language) })}
            </span>
          )}
          <button
            className="text-[11.5px] text-[var(--accent)] hover:underline"
            onClick={() => setDialog('profile')}
          >
            {t('overview.info.viewProfile')}
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start gap-2">
            <row.icon size={13} className="mt-0.5 flex-none text-[var(--muted-2)]" />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted-2)]">{row.label}</div>
              <div className="truncate text-[12.5px] text-[var(--text)]">{row.value}</div>
            </div>
          </div>
        ))}
      </div>
      {profile && profile.notes.trim() && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-2)]">{t('overview.info.notes')}</div>
          <div className="mt-1 line-clamp-4 text-[12.5px] leading-relaxed text-[var(--muted)]">
            <Markdown content={profile.notes} />
          </div>
        </div>
      )}
      {profile && profile.risks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--border)] pt-3">
          {profile.risks.slice(0, 5).map((risk) => (
            <span
              key={risk.id}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px]',
                risk.level === 'critical'
                  ? 'border-rose-400/25 bg-rose-400/10 text-[var(--danger)]'
                  : risk.level === 'warning'
                    ? 'border-amber-400/25 bg-amber-400/10 text-[var(--warning)]'
                    : 'border-[var(--border)] bg-[var(--panel-3)] text-[var(--muted)]',
              )}
              title={risk.detail}
            >
              {risk.title}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function PortPanel({ serverId }: { serverId: string }) {
  const { t } = useI18n();
  const ports = useApp((state) => state.runtimes[serverId]?.ports ?? []);
  const processes = useApp((state) => state.runtimes[serverId]?.processes ?? []);
  const [tab, setTab] = useState<'ports' | 'processes'>('ports');
  const sorted = [...processes].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 12);

  return (
    <section className="panel-2 flex flex-col p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab('ports')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12.5px] font-semibold transition-colors',
              tab === 'ports' ? 'text-[var(--text)]' : 'text-[var(--muted-2)] hover:text-[var(--text)]',
            )}
          >
            <ArrowUpRight size={13} />
            {t('overview.ports.title')}
          </button>
          <span className="text-[var(--muted-2)]">/</span>
          <button
            onClick={() => setTab('processes')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12.5px] font-semibold transition-colors',
              tab === 'processes' ? 'text-[var(--text)]' : 'text-[var(--muted-2)] hover:text-[var(--text)]',
            )}
          >
            <Activity size={13} />
            {t('overview.ports.processes')}
          </button>
        </div>
        <span className="text-[11px] text-[var(--muted-2)]">
          {t('overview.ports.count', { count: tab === 'ports' ? ports.length : processes.length })}
        </span>
      </div>

      <div className="scroll-area mt-2 max-h-[230px] space-y-1">
        {tab === 'ports' && ports.length === 0 && <p className="text-[12.5px] text-[var(--muted-2)]">{t('overview.ports.empty')}</p>}
        {tab === 'ports' &&
          ports.map((port) => (
            <div
              key={`${port.protocol}-${port.address}-${port.port}`}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-[var(--panel-3)]/60"
            >
              <span className="w-10 rounded bg-[var(--panel-3)] px-1 text-center text-[10.5px] uppercase text-[var(--muted-2)]">
                {port.protocol}
              </span>
              <span className="mono text-[var(--text)]">:{port.port}</span>
              <span className="truncate text-[11.5px] text-[var(--muted-2)]">{port.address}</span>
              <span className="ml-auto truncate text-[11.5px] text-[var(--muted)]">{port.process ?? '—'}</span>
            </div>
          ))}

        {tab === 'processes' && sorted.length === 0 && (
          <p className="text-[12.5px] text-[var(--muted-2)]">{t('overview.ports.emptyProcesses')}</p>
        )}
        {tab === 'processes' &&
          sorted.map((process) => (
            <div
              key={process.pid}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-[var(--panel-3)]/60"
            >
              <span className="mono w-12 flex-none text-[11px] text-[var(--muted-2)]">{process.pid}</span>
              <span className="min-w-0 flex-1 truncate" title={process.command}>
                {process.command}
              </span>
              <span className="flex-none text-[11px] text-[var(--muted-2)]">{process.user}</span>
              <span className="w-14 flex-none text-right text-[11.5px] text-amber-300/90">
                {process.cpuPercent.toFixed(1)}%
              </span>
              <span className="w-14 flex-none text-right text-[11.5px] text-sky-300/90">
                {process.memPercent.toFixed(1)}%
              </span>
            </div>
          ))}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
        <SquareTerminal size={12} className="text-[var(--muted-2)]" />
        <span className="text-[11.5px] text-[var(--muted-2)]">{t('overview.ports.hint')}</span>
      </div>
    </section>
  );
}
