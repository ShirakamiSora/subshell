import { useEffect } from 'react';
import { useApp } from './store/app';
import { api } from './lib/api';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './features/Workspace';
import { Toast } from './components/Toast';
import { ServerDialog } from './components/ServerDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { AuditDialog } from './components/AuditDialog';
import { ProfileDialog } from './components/ProfileDialog';
import { TunnelDialog } from './components/TunnelDialog';

export default function App() {
  const ready = useApp((state) => state.ready);
  const dialog = useApp((state) => state.dialog);
  const editingServer = useApp((state) => state.editingServer);
  const activeServerId = useApp((state) => state.activeServerId);
  const theme = useApp((state) => state.settings?.theme ?? 'dark');
  const bootstrap = useApp((state) => state.bootstrap);
  const setDialog = useApp((state) => state.setDialog);
  const handleConnection = useApp((state) => state.handleConnection);
  const handleProfile = useApp((state) => state.handleProfile);
  const handleSample = useApp((state) => state.handleSample);
  const handleEvents = useApp((state) => state.handleEvents);
  const handleStatus = useApp((state) => state.handleStatus);
  const handleAgentEvent = useApp((state) => state.handleAgentEvent);
  const handleHealth = useApp((state) => state.handleHealth);
  const handleNotice = useApp((state) => state.handleNotice);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    document.documentElement.dataset.theme = resolved;
  }, [theme]);

  useEffect(() => {
    const unsubscribe = [
      api.events.on('connection:update', handleConnection),
      api.events.on('profile:update', handleProfile),
      api.events.on('monitor:sample', ({ serverId, sample }) => handleSample(serverId, sample)),
      api.events.on('monitor:events', ({ serverId, events }) => handleEvents(serverId, events)),
      api.events.on('monitor:status', ({ serverId, ...payload }) => handleStatus(serverId, payload)),
      api.events.on('agent:event', handleAgentEvent),
      api.events.on('health:update', handleHealth),
      api.events.on('app:notice', handleNotice),
    ];
    return () => unsubscribe.forEach((off) => off());
  }, [handleConnection, handleProfile, handleSample, handleEvents, handleStatus, handleAgentEvent, handleHealth, handleNotice]);

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)]">
          <span className="h-4 w-4 animate-pulse rounded bg-[var(--accent)]" />
        </div>
        <span className="text-[12.5px] text-[var(--muted-2)]">正在启动 subshell…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <Workspace />
      </div>
      <Toast />
      {dialog === 'server' && <ServerDialog editing={editingServer} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'audit' && <AuditDialog onClose={() => setDialog(null)} />}
      {dialog === 'profile' && activeServerId && (
        <ProfileDialog serverId={activeServerId} onClose={() => setDialog(null)} />
      )}
      {dialog === 'tunnel' && activeServerId && (
        <TunnelDialog serverId={activeServerId} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
