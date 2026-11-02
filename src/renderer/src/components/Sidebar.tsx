import { useMemo, useState } from 'react';
import { Layers, Plus, Search, Settings, Server } from 'lucide-react';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { ConnectionDot } from './ConnectionDot';
import { cn } from '../lib/cn';
import { firstNameLetter } from '../lib/format';
import type { ServerConfig } from '@shared/types';

export function Sidebar() {
  const servers = useApp((state) => state.servers);
  const connections = useApp((state) => state.connections);
  const activeServerId = useApp((state) => state.activeServerId);
  const activate = useApp((state) => state.activate);
  const setDialog = useApp((state) => state.setDialog);
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return servers;
    return servers.filter((server) =>
      [server.name, server.host, server.group, ...(server.tags ?? [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [servers, query]);

  const groups = useMemo(() => {
    const map = new Map<string, ServerConfig[]>();
    for (const server of filtered) {
      const key = server.group || t('sidebar.defaultGroup');
      const list = map.get(key) ?? [];
      list.push(server);
      map.set(key, list);
    }
    return [...map.entries()];
    // t 只在分组默认名时使用；语言切换会重建组件，无需作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  return (
    <aside className="flex w-[250px] flex-none flex-col border-r border-[var(--border)] bg-[var(--panel)]">
      <div className="px-3 pt-3">
        <button className="btn w-full justify-center" onClick={() => setDialog('server')}>
          <Plus size={14} />
          {t('sidebar.addServer')}
        </button>
        <div className="relative mt-2">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-2)]" />
          <input
            className="input h-8 !pl-8 text-[12.5px]"
            placeholder={t('sidebar.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="scroll-area flex-1 px-2 py-2">
        {groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[12.5px] text-[var(--muted-2)]">
            <Server size={20} />
            <span>{query ? t('sidebar.noMatch') : t('sidebar.noServers')}</span>
          </div>
        )}
        {groups.map(([group, list]) => (
          <div key={group} className="mb-1">
            <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">
              {group}
            </div>
            {list.map((server) => {
              const connection = connections[server.id];
              const active = activeServerId === server.id;
              return (
                <button
                  key={server.id}
                  onClick={() => activate(server.id)}
                  className={cn(
                    'group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                    active ? 'bg-[var(--panel-3)]' : 'hover:bg-[var(--panel-2)]',
                  )}
                >
                  <div
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-[7px] text-[12px] font-bold"
                    style={{
                      backgroundColor: `${server.color ?? '#2dd4bf'}1f`,
                      color: server.color ?? '#2dd4bf',
                    }}
                  >
                    {firstNameLetter(server.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[var(--text)]">{server.name}</div>
                    <div className="truncate text-[11.5px] text-[var(--muted-2)]">
                      {server.username}@{server.host}
                    </div>
                  </div>
                  <ConnectionDot state={connection?.state ?? 'idle'} />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex-none border-t border-[var(--border)] p-2">
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12.5px] text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
          onClick={() => setDialog('cluster')}
        >
          <Layers size={14} />
          <span className="flex-1">{t('cluster.nav')}</span>
        </button>
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12.5px] text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
          onClick={() => setDialog('settings')}
        >
          <Settings size={14} />
          <span className="flex-1">{t('sidebar.settings')}</span>
        </button>
      </div>
    </aside>
  );
}
