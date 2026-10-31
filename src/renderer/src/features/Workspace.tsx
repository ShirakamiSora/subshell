import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Ellipsis,
  LayoutDashboard,
  MessageSquare,
  Plug,
  PlugZap,
  RefreshCw,
  ScrollText,
  TerminalSquare,
  Trash2,
  Unplug,
  Pencil,
  CloudUpload,
  Download,
  KeyRound,
} from 'lucide-react';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/cn';
import { ConnectionDot } from '../components/ConnectionDot';
import { ConfirmDialog } from '../components/Modal';
import { Welcome } from './Welcome';
import { Overview } from './Overview';
import { TerminalView } from './TerminalView';
import { Assistant } from './Assistant';
import { formatDateTime, formatDuration } from '../lib/format';
import type { WorkspaceView } from '../store/app';

const views: { key: WorkspaceView; labelKey: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', labelKey: 'workspace.view.overview', icon: LayoutDashboard },
  { key: 'terminal', labelKey: 'workspace.view.terminal', icon: TerminalSquare },
  { key: 'assistant', labelKey: 'workspace.view.assistant', icon: MessageSquare },
];

export function Workspace() {
  const activeServerId = useApp((state) => state.activeServerId);
  const servers = useApp((state) => state.servers);
  const openTabs = useApp((state) => state.openTabs);
  const view = useApp((state) => state.view);
  const activate = useApp((state) => state.activate);
  const closeTab = useApp((state) => state.closeTab);
  const connections = useApp((state) => state.connections);

  if (!activeServerId) return <Welcome />;
  const server = servers.find((item) => item.id === activeServerId);
  if (!server) return <Welcome />;

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--bg)]">
      <div className="flex h-9 flex-none items-end gap-0.5 border-b border-[var(--border)] bg-[var(--panel)] px-2">
        {openTabs.map((id) => {
          const tabServer = servers.find((item) => item.id === id);
          if (!tabServer) return null;
          const active = id === activeServerId;
          const state = connections[id]?.state ?? 'idle';
          return (
            <div
              key={id}
              className={cn(
                'group flex h-8 max-w-[220px] items-center gap-2 rounded-t-lg border-x border-t px-3 text-[12.5px] transition-colors',
                active
                  ? 'border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]'
                  : 'border-transparent text-[var(--muted)] hover:bg-[var(--panel-2)]/60 hover:text-[var(--text)]',
              )}
            >
              <button className="flex min-w-0 items-center gap-2" onClick={() => activate(id)}>
                <ConnectionDot state={state} />
                <span className="truncate">{tabServer.name}</span>
              </button>
              <button
                className="ml-1 hidden rounded p-0.5 text-[var(--muted-2)] hover:bg-[var(--panel-3)] hover:text-[var(--text)] group-hover:block"
                onClick={() => closeTab(id)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>

      <ServerHeader serverId={server.id} />
      <div className="relative min-h-0 flex-1">
        <div className={cn('absolute inset-0', view === 'overview' ? 'visible' : 'invisible pointer-events-none')}>
          <Overview serverId={server.id} />
        </div>
        <div className={cn('absolute inset-0', view === 'terminal' ? 'visible' : 'invisible pointer-events-none')}>
          <TerminalView serverId={server.id} active={view === 'terminal'} />
        </div>
        <div className={cn('absolute inset-0', view === 'assistant' ? 'visible' : 'invisible pointer-events-none')}>
          <Assistant serverId={server.id} />
        </div>
      </div>
    </div>
  );
}

function ServerHeader({ serverId }: { serverId: string }) {
  const servers = useApp((state) => state.servers);
  const connections = useApp((state) => state.connections);
  const profiles = useApp((state) => state.profiles);
  const runtimes = useApp((state) => state.runtimes);
  const view = useApp((state) => state.view);
  const setView = useApp((state) => state.setView);
  const connect = useApp((state) => state.connect);
  const disconnect = useApp((state) => state.disconnect);
  const rescan = useApp((state) => state.rescan);
  const syncProfile = useApp((state) => state.syncProfile);
  const exportProfile = useApp((state) => state.exportProfile);
  const resetHostKey = useApp((state) => state.resetHostKey);
  const setDialog = useApp((state) => state.setDialog);
  const deleteServer = useApp((state) => state.deleteServer);
  const summarize = useApp((state) => state.summarize);
  const { t } = useI18n();

  const server = servers.find((item) => item.id === serverId);
  const connection = connections[serverId];
  const profile = profiles[serverId];
  const runtime = runtimes[serverId];
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  if (!server) return null;
  const connected = connection?.state === 'connected';
  const latest = runtime?.samples.at(-1);
  const uptime = latest ? formatDuration(latest.uptimeSeconds) : null;

  return (
    <div className="flex h-[58px] flex-none items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-4">
      <div
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] text-[13.5px] font-bold"
        style={{ backgroundColor: `${server.color ?? '#2dd4bf'}1f`, color: server.color ?? '#2dd4bf' }}
      >
        {server.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-[var(--text)]">{server.name}</span>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[11px] font-medium',
              connected
                ? 'bg-emerald-400/10 text-[var(--success)]'
                : connection?.state === 'connecting'
                  ? 'bg-amber-400/10 text-[var(--warning)]'
                  : connection?.state === 'error'
                    ? 'bg-rose-400/10 text-[var(--danger)]'
                    : 'bg-slate-500/10 text-slate-400',
            )}
          >
            {connected
              ? t('workspace.connected')
              : connection?.state === 'connecting'
                ? t('workspace.connecting')
                : connection?.state === 'error'
                  ? t('workspace.connectionFailed')
                  : t('workspace.disconnected')}
          </span>
          {profile?.role && (
            <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
              {profile.role}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[var(--muted-2)]">
          <span className="mono">
            {server.username}@{server.host}:{server.port}
          </span>
          {profile && <span>· {profile.os.name}</span>}
          {uptime && <span>· {t('workspace.uptime', { time: uptime })}</span>}
          {connection?.latencyMs ? <span>· {connection.latencyMs}ms</span> : null}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-0.5">
          {views.map((item) => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors',
                view === item.key
                  ? 'bg-[var(--panel-3)] text-[var(--text)] shadow-sm'
                  : 'text-[var(--muted)] hover:text-[var(--text)]',
              )}
            >
              <item.icon size={13} />
              {t(item.labelKey)}
            </button>
          ))}
        </div>

        {connected ? (
          <button className="btn h-8 px-2.5" onClick={() => void disconnect(serverId)} title={t('workspace.disconnect')}>
            <Unplug size={13} />
            {t('workspace.disconnect')}
          </button>
        ) : (
          <button
            className="btn btn-primary h-8 px-2.5"
            onClick={() => void connect(serverId)}
            disabled={connection?.state === 'connecting'}
          >
            <PlugZap size={13} />
            {connection?.state === 'connecting' ? t('workspace.connecting') : t('workspace.connect')}
          </button>
        )}

        <div className="relative" ref={menuRef}>
          <button className="btn btn-ghost h-8 w-8 !p-0" onClick={() => setMenuOpen((open) => !open)}>
            <Ellipsis size={15} />
          </button>
          {menuOpen && (
            <div className="panel fade-in absolute right-0 top-9 z-30 w-52 overflow-hidden py-1 shadow-2xl">
              <MenuItem
                icon={RefreshCw}
                label={busy === 'rescan' ? t('workspace.menu.scanning') : t('workspace.menu.rescan')}
                onClick={() => {
                  setBusy('rescan');
                  setMenuOpen(false);
                  void rescan(serverId).finally(() => setBusy(null));
                }}
              />
              <MenuItem
                icon={Activity}
                label={t('workspace.menu.summary')}
                onClick={() => {
                  setMenuOpen(false);
                  void summarize(serverId);
                }}
              />
              <MenuItem
                icon={CloudUpload}
                label={t('workspace.menu.sync')}
                onClick={() => {
                  setMenuOpen(false);
                  void syncProfile(serverId);
                }}
              />
              <MenuItem
                icon={Download}
                label={t('workspace.menu.export')}
                onClick={() => {
                  setMenuOpen(false);
                  void exportProfile(serverId);
                }}
              />
              <MenuItem
                icon={Pencil}
                label={t('workspace.menu.edit')}
                onClick={() => {
                  setMenuOpen(false);
                  setDialog('server', server);
                }}
              />
              <MenuItem
                icon={KeyRound}
                label={t('workspace.menu.resetKey')}
                onClick={() => {
                  setMenuOpen(false);
                  void resetHostKey(serverId);
                }}
              />
              <MenuItem
                icon={ScrollText}
                label={t('workspace.menu.audit')}
                onClick={() => {
                  setMenuOpen(false);
                  setDialog('audit');
                }}
              />
              <div className="my-1 border-t border-[var(--border)]" />
              <MenuItem
                icon={Trash2}
                label={t('workspace.menu.delete')}
                danger
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('workspace.delete.title')}
          message={t('workspace.delete.message', { name: server.name })}
          confirmText={t('common.delete')}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void deleteServer(serverId);
          }}
        />
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Plug;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors',
        danger ? 'text-[var(--danger)] hover:bg-rose-500/10' : 'text-[var(--muted)] hover:bg-[var(--panel-3)] hover:text-[var(--text)]',
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
