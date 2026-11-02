import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  Play,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { ClusterPrecheckResult, ClusterRun, ClusterTargetResult } from '@shared/types';
import { Modal, ConfirmDialog } from './Modal';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { formatRelative } from '../lib/format';

const statusStyle: Record<ClusterTargetResult['status'], { text: string; icon: typeof CheckCircle2 }> = {
  pending: { text: 'text-[var(--muted-2)]', icon: Loader2 },
  prechecking: { text: 'text-[var(--blue)]', icon: Loader2 },
  ready: { text: 'text-[var(--success)]', icon: CheckCircle2 },
  blocked: { text: 'text-[var(--danger)]', icon: XCircle },
  running: { text: 'text-[var(--blue)]', icon: Loader2 },
  ok: { text: 'text-[var(--success)]', icon: CheckCircle2 },
  failed: { text: 'text-[var(--danger)]', icon: XCircle },
  skipped: { text: 'text-[var(--muted-2)]', icon: AlertTriangle },
};

/** 集群运维：选择多台服务器，先做前置预检，再并行执行同一命令/目标。 */
export function ClusterDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const servers = useApp((state) => state.servers);
  const connections = useApp((state) => state.connections);
  const clusterRun = useApp((state) => state.clusterRun);
  const notify = useApp((state) => state.notify);
  const [selected, setSelected] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [purpose, setPurpose] = useState('');
  const [prechecks, setPrechecks] = useState<ClusterPrecheckResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<ClusterRun[]>([]);

  useEffect(() => {
    void api.cluster.history(10).then(setHistory).catch(() => undefined);
  }, [clusterRun?.finishedAt]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof servers>();
    for (const server of servers) {
      const key = server.group || t('sidebar.defaultGroup');
      map.set(key, [...(map.get(key) ?? []), server]);
    }
    return [...map.entries()];
  }, [servers, t]);

  const connectedSelected = selected.filter((id) => connections[id]?.state === 'connected').length;

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setPrechecks([]);
  };

  const runPrecheck = async () => {
    if (!selected.length) {
      notify('warning', t('cluster.needServers'));
      return;
    }
    setChecking(true);
    try {
      const result = await api.cluster.precheck(selected, command.trim() || undefined);
      setPrechecks(result);
      notify(result.every((item) => item.ok) ? 'success' : 'warning', t('cluster.precheckDone'));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };

  const execute = async () => {
    if (!command.trim()) {
      notify('warning', t('cluster.needCommand'));
      return;
    }
    setRunning(true);
    try {
      const run = await api.cluster.run({
        serverIds: selected,
        command: command.trim(),
        purpose: purpose.trim() || undefined,
      });
      useApp.setState({ clusterRun: run });
      setHistory(await api.cluster.history(10));
      const ok = run.targets.filter((item) => item.status === 'ok').length;
      notify(ok === run.targets.length ? 'success' : 'warning', t('cluster.done', { ok, total: run.targets.length }));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const blockedCount = prechecks.filter((item) => !item.ok).length;

  return (
    <>
      <Modal
        title={t('cluster.title')}
        description={t('cluster.desc')}
        onClose={onClose}
        width="max-w-6xl"
        footer={
          <>
            <span className="mr-auto text-[11.5px] text-[var(--muted-2)]">
              {t('cluster.selected', { count: selected.length, connected: connectedSelected })}
            </span>
            <button className="btn h-8 px-3 text-[12.5px]" onClick={() => void runPrecheck()} disabled={checking || running}>
              {checking ? <Loader2 size={12} className="spin" /> : <ShieldCheck size={12} />}
              {t('cluster.precheck')}
            </button>
            <button
              className="btn btn-primary h-8 px-3 text-[12.5px]"
              onClick={() => setConfirmRun(true)}
              disabled={running || !selected.length || !command.trim()}
            >
              {running ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
              {t('cluster.execute')}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--text)]">{t('cluster.servers')}</span>
              <button
                className="text-[11px] text-[var(--accent)] hover:underline"
                onClick={() =>
                  setSelected(
                    selected.length === servers.length ? [] : servers.map((server) => server.id),
                  )
                }
              >
                {selected.length === servers.length ? t('cluster.clearSelection') : t('cluster.selectAll')}
              </button>
            </div>
            <div className="scroll-area max-h-[320px] space-y-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-1.5">
              {groups.length === 0 && (
                <p className="px-2 py-4 text-[11.5px] text-[var(--muted-2)]">{t('sidebar.noServers')}</p>
              )}
              {groups.map(([group, list]) => (
                <div key={group}>
                  <div className="px-1.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">
                    {group}
                  </div>
                  {list.map((server) => (
                    <label
                      key={server.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--panel-3)]"
                    >
                      <input
                        type="checkbox"
                        className="accent-teal-400"
                        checked={selected.includes(server.id)}
                        onChange={() => toggle(server.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-[var(--text)]">{server.name}</span>
                        <span className="block truncate text-[10.5px] text-[var(--muted-2)]">
                          {server.username}@{server.host}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'dot flex-none',
                          connections[server.id]?.state === 'connected' ? 'bg-[var(--success)]' : 'bg-slate-600',
                        )}
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
            {history.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[12px] font-medium text-[var(--text)]">{t('cluster.history')}</div>
                <div className="space-y-1">
                  {history.map((run) => (
                    <button
                      key={run.id}
                      className="w-full rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-left hover:border-[var(--border-strong)]"
                      onClick={() => useApp.setState({ clusterRun: run })}
                    >
                      <div className="mono truncate text-[11px] text-[var(--muted)]">{run.command}</div>
                      <div className="mt-0.5 text-[10px] text-[var(--muted-2)]">
                        {formatRelative(run.startedAt)} ·{' '}
                        {run.targets.filter((item) => item.status === 'ok').length}/{run.targets.length}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0">
            <label className="label">{t('cluster.command')}</label>
            <textarea
              className="input mono min-h-[74px] resize-y text-[12.5px]"
              value={command}
              onChange={(event) => {
                setCommand(event.target.value);
                setPrechecks([]);
              }}
              placeholder={t('cluster.commandPlaceholder')}
            />
            <label className="label mt-2">{t('cluster.purpose')}</label>
            <input
              className="input h-8 text-[12.5px]"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder={t('cluster.purposePlaceholder')}
            />

            {prechecks.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text)]">
                  <ShieldCheck size={12} className="text-[var(--accent)]" />
                  {t('cluster.precheckResult')}
                  {blockedCount > 0 && (
                    <span className="text-[11px] text-[var(--danger)]">
                      {t('cluster.blockedCount', { count: blockedCount })}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {prechecks.map((precheck) => (
                    <div key={precheck.serverId} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
                      <div className="flex items-center gap-2 text-[12px]">
                        {precheck.ok ? (
                          <CheckCircle2 size={12} className="text-[var(--success)]" />
                        ) : (
                          <XCircle size={12} className="text-[var(--danger)]" />
                        )}
                        <span className="font-medium text-[var(--text)]">{precheck.serverName}</span>
                        {precheck.latencyMs !== undefined && (
                          <span className="text-[10.5px] text-[var(--muted-2)]">{precheck.latencyMs}ms</span>
                        )}
                        {precheck.error && (
                          <span className="ml-auto max-w-[50%] truncate text-[10.5px] text-[var(--danger)]">
                            {precheck.error}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {precheck.checks.map((check) => (
                          <span
                            key={check.name}
                            title={check.detail}
                            className={cn(
                              'rounded-full border px-1.5 py-px text-[10px]',
                              check.ok
                                ? 'border-emerald-400/20 bg-emerald-400/10 text-[var(--success)]'
                                : 'border-rose-400/25 bg-rose-400/10 text-[var(--danger)]',
                            )}
                          >
                            {check.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {clusterRun && (
              <div className="mt-3">
                <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text)]">
                  <Layers size={12} className="text-[var(--accent)]" />
                  {t('cluster.result')}
                  <span className="text-[10.5px] text-[var(--muted-2)]">
                    {t(`cluster.phase.${clusterRun.phase}`)}
                  </span>
                  {clusterRun.phase === 'running' && (
                    <button
                      className="ml-auto text-[11px] text-[var(--danger)] hover:underline"
                      onClick={() => void api.cluster.cancel(clusterRun.id)}
                    >
                      {t('cluster.cancel')}
                    </button>
                  )}
                </div>
                <div className="mt-1.5 space-y-1">
                  {clusterRun.targets.map((target) => {
                    const style = statusStyle[target.status];
                    const Icon = style.icon;
                    const open = expanded === target.serverId;
                    return (
                      <div key={target.serverId} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]">
                        <button
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                          onClick={() => setExpanded(open ? null : target.serverId)}
                        >
                          <Icon
                            size={12}
                            className={cn(style.text, target.status === 'running' ? 'spin' : undefined)}
                          />
                          <span className="text-[12px] text-[var(--text)]">{target.serverName}</span>
                          <span className={cn('text-[10.5px]', style.text)}>
                            {t(`cluster.status.${target.status}`)}
                          </span>
                          {target.exitCode !== undefined && (
                            <span className="text-[10px] text-[var(--muted-2)]">exit {target.exitCode}</span>
                          )}
                          {target.durationMs !== undefined && (
                            <span className="text-[10px] text-[var(--muted-2)]">{target.durationMs}ms</span>
                          )}
                          <span className="ml-auto text-[var(--muted-2)]">
                            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </span>
                        </button>
                        {open && (
                          <div className="border-t border-[var(--border)] px-2.5 py-2">
                            {target.precheck.checks.length > 0 && (
                              <div className="mb-1.5 text-[10.5px] text-[var(--muted-2)]">
                                {target.precheck.checks
                                  .map((check) => `${check.name}: ${check.ok ? '✓' : '✗'} ${check.detail}`)
                                  .join(' · ')}
                              </div>
                            )}
                            <pre className="mono max-h-52 overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--code-bg)] px-2 py-1 text-[10.5px] text-[var(--muted)]">
                              {target.stdout || target.stderr || t('history.noOutput')}
                              {target.stdout && target.stderr ? `\n\n[stderr]\n${target.stderr}` : ''}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {confirmRun && (
        <ConfirmDialog
          title={t('cluster.confirmTitle')}
          message={t('cluster.confirmMessage', {
            count: selected.length,
            command: command.trim().slice(0, 120),
          })}
          confirmText={t('cluster.execute')}
          danger
          onCancel={() => setConfirmRun(false)}
          onConfirm={() => {
            setConfirmRun(false);
            void execute();
          }}
        />
      )}
    </>
  );
}
