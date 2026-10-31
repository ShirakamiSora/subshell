import { useState } from 'react';
import { Coins, Terminal } from 'lucide-react';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { UsageDialog } from './UsageDialog';

/** 自绘标题栏，与 Windows 原生窗口按钮共存。 */
export function TitleBar() {
  const activeServerId = useApp((state) => state.activeServerId);
  const servers = useApp((state) => state.servers);
  const version = useApp((state) => state.info?.version);
  const active = servers.find((server) => server.id === activeServerId);
  const { t } = useI18n();
  const [showUsage, setShowUsage] = useState(false);

  return (
    <header className="titlebar-drag flex h-11 flex-none items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-4">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
        <Terminal size={14} strokeWidth={2.2} />
      </div>
      <span className="text-[13.5px] font-semibold tracking-wide text-[var(--text)]">subshell</span>
      {version && <span className="text-[11px] font-medium text-[var(--muted-2)]">v{version}</span>}
      {active && (
        <div className="ml-4 flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
          <span className="text-[var(--muted-2)]">/</span>
          <span className="max-w-[320px] truncate text-[var(--text)]">{active.name}</span>
        </div>
      )}
      <button
        className="titlebar-no-drag ml-auto mr-3 flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[11.5px] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        onClick={() => setShowUsage(true)}
        title={t('usage.title')}
      >
        <Coins size={12} />
        {t('usage.nav')}
      </button>
      <div className="mr-[150px] text-[12px] text-[var(--muted-2)]">{t('title.slogan')}</div>

      {showUsage && <UsageDialog onClose={() => setShowUsage(false)} />}
    </header>
  );
}
