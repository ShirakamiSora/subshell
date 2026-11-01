import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUp,
  Download,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { RemoteEntry } from '@shared/types';
import { api } from '../lib/api';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { ConfirmDialog } from '../components/Modal';
import { cn } from '../lib/cn';

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function parentPath(path: string): string {
  const clean = path.replace(/\/+$/, '');
  const index = clean.lastIndexOf('/');
  return index <= 0 ? '/' : clean.slice(0, index);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, '0');
}

function formatTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, { hour12: false });
}

const typeIcon: Record<RemoteEntry['type'], typeof FileIcon> = {
  directory: Folder,
  file: FileIcon,
  symlink: Link2,
  other: FileIcon,
};

export function FileBrowser({ serverId, active }: { serverId: string; active: boolean }) {
  const { t } = useI18n();
  const notify = useApp((state) => state.notify);
  const connection = useApp((state) => state.connections[serverId]);

  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const [preview, setPreview] = useState<{ path: string; content?: string; binary?: boolean; error?: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ entry: RemoteEntry; name: string } | null>(null);
  const [deleting, setDeleting] = useState<RemoteEntry | null>(null);

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setError('');
      try {
        const list = await api.sftp.list(serverId, target);
        setEntries(list);
        setPath(target);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setLoading(false);
      }
    },
    [serverId],
  );

  useEffect(() => {
    if (!active || started || connection?.state !== 'connected') return;
    setStarted(true);
    void (async () => {
      try {
        const home = await api.sftp.home(serverId);
        await load(home);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
  }, [active, started, connection?.state, serverId, load]);

  const openEntry = async (entry: RemoteEntry) => {
    if (entry.type === 'directory') {
      await load(entry.path);
      return;
    }
    setPreview({ path: entry.path, content: undefined });
    const result = await api.sftp.preview(serverId, entry.path);
    setPreview({ path: entry.path, content: result.content, binary: result.binary, error: result.error });
  };

  const upload = async () => {
    const result = await api.sftp.upload(serverId, path);
    if (result.canceled) return;
    if (!result.ok) {
      notify('error', result.error ?? t('files.uploadFailed'));
      return;
    }
    notify('success', t('files.uploaded', { count: result.files?.length ?? 0 }));
    await load(path);
  };

  const download = async (entry: RemoteEntry) => {
    const result = await api.sftp.download(serverId, entry.path);
    if (result.canceled) return;
    if (!result.ok) notify('error', result.error ?? t('files.downloadFailed'));
    else notify('success', t('files.saved', { path: result.path ?? '' }));
  };

  const createFolder = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.sftp.mkdir(serverId, joinPath(path, name));
      setCreating(false);
      setNewName('');
      await load(path);
    } catch (caught) {
      notify('error', caught instanceof Error ? caught.message : String(caught));
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name || name === renaming.entry.name) {
      setRenaming(null);
      return;
    }
    try {
      await api.sftp.rename(serverId, renaming.entry.path, joinPath(path, name));
      setRenaming(null);
      await load(path);
    } catch (caught) {
      notify('error', caught instanceof Error ? caught.message : String(caught));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.sftp.remove(serverId, deleting.path, deleting.type === 'directory');
      setDeleting(null);
      await load(path);
    } catch (caught) {
      notify('error', caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (connection?.state !== 'connected') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--muted)]">
        <Folder size={24} className="text-[var(--muted-2)]" />
        <span className="text-[13px]">{t('files.offline')}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <div className="flex h-11 flex-none items-center gap-1.5 border-b border-[var(--border)] bg-[var(--panel)] px-3">
        <button className="btn btn-ghost h-7 w-7 !p-0" onClick={() => void load(parentPath(path))} title={t('files.up')}>
          <ArrowUp size={14} />
        </button>
        <button className="btn btn-ghost h-7 w-7 !p-0" onClick={() => void load(path)} title={t('common.refresh')}>
          <RefreshCw size={13} className={cn(loading && 'spin')} />
        </button>
        <div className="mono ml-1 min-w-0 flex-1 truncate rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[12px] text-[var(--muted)]">
          {path || '—'}
        </div>
        <button className="btn h-7 px-2 text-[12px]" onClick={() => void upload()}>
          <Upload size={12} />
          {t('files.upload')}
        </button>
        <button className="btn h-7 px-2 text-[12px]" onClick={() => setCreating(true)}>
          <FolderPlus size={12} />
          {t('files.newFolder')}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="scroll-area min-w-0 flex-1">
          {error && (
            <div className="m-3 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-[12px] text-[var(--danger)]">
              {error}
            </div>
          )}
          {loading && entries.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-6 text-[12.5px] text-[var(--muted-2)]">
              <Loader2 size={13} className="spin" />
              {t('files.loading')}
            </div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="px-4 py-6 text-[12.5px] text-[var(--muted-2)]">{t('files.empty')}</div>
          )}
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              {entries.map((entry) => {
                const Icon = typeIcon[entry.type];
                return (
                  <tr
                    key={entry.path}
                    className="group border-b border-[var(--border)]/50 hover:bg-[var(--panel-2)]"
                  >
                    <td className="max-w-0 px-3 py-1.5">
                      <button className="flex w-full items-center gap-2 text-left" onClick={() => void openEntry(entry)}>
                        <Icon
                          size={13}
                          className={cn('flex-none', entry.type === 'directory' ? 'text-[var(--accent)]' : 'text-[var(--muted-2)]')}
                        />
                        <span className="truncate text-[var(--text)]">{entry.name}</span>
                        {entry.linkTarget && (
                          <span className="truncate text-[11px] text-[var(--muted-2)]">→ {entry.linkTarget}</span>
                        )}
                      </button>
                    </td>
                    <td className="w-20 px-2 py-1.5 text-right text-[11.5px] text-[var(--muted-2)]">
                      {entry.type === 'directory' ? '—' : formatSize(entry.size)}
                    </td>
                    <td className="mono w-14 px-2 py-1.5 text-right text-[11px] text-[var(--muted-2)]">
                      {formatMode(entry.mode)}
                    </td>
                    <td className="w-40 px-2 py-1.5 text-right text-[11px] text-[var(--muted-2)]">
                      {formatTime(entry.mtime)}
                    </td>
                    <td className="w-24 px-2 py-1.5">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        {entry.type !== 'directory' && (
                          <button
                            className="rounded p-1 text-[var(--muted-2)] hover:bg-[var(--panel-3)] hover:text-[var(--text)]"
                            title={t('files.download')}
                            onClick={() => void download(entry)}
                          >
                            <Download size={12} />
                          </button>
                        )}
                        <button
                          className="rounded p-1 text-[var(--muted-2)] hover:bg-[var(--panel-3)] hover:text-[var(--text)]"
                          title={t('files.rename')}
                          onClick={() => setRenaming({ entry, name: entry.name })}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="rounded p-1 text-[var(--muted-2)] hover:bg-rose-500/10 hover:text-[var(--danger)]"
                          title={t('common.delete')}
                          onClick={() => setDeleting(entry)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {preview && (
          <div className="flex w-[42%] min-w-[320px] flex-none flex-col border-l border-[var(--border)] bg-[var(--panel)]">
            <div className="flex h-9 flex-none items-center gap-2 border-b border-[var(--border)] px-3">
              <FileText size={12} className="text-[var(--muted-2)]" />
              <span className="mono min-w-0 flex-1 truncate text-[11.5px] text-[var(--muted)]">{preview.path}</span>
              <button className="btn btn-ghost h-6 w-6 !p-0" onClick={() => setPreview(null)}>
                <X size={12} />
              </button>
            </div>
            <div className="scroll-area min-h-0 flex-1 p-3">
              {preview.binary ? (
                <p className="text-[12px] text-[var(--muted-2)]">{t('files.binary')}</p>
              ) : preview.error ? (
                <p className="text-[12px] text-[var(--danger)]">{preview.error}</p>
              ) : preview.content === undefined ? (
                <div className="flex items-center gap-2 text-[12px] text-[var(--muted-2)]">
                  <Loader2 size={12} className="spin" />
                  {t('files.loading')}
                </div>
              ) : (
                <pre className="mono whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-[var(--text)]">
                  {preview.content}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {creating && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="panel w-[360px] p-4">
            <div className="text-[13px] font-semibold text-[var(--text)]">{t('files.newFolder')}</div>
            <input
              className="input mt-3"
              autoFocus
              placeholder={t('files.folderName')}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createFolder();
                if (event.key === 'Escape') setCreating(false);
              }}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => void createFolder()} disabled={!newName.trim()}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {renaming && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="panel w-[360px] p-4">
            <div className="text-[13px] font-semibold text-[var(--text)]">{t('files.rename')}</div>
            <input
              className="input mt-3"
              autoFocus
              value={renaming.name}
              onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void rename();
                if (event.key === 'Escape') setRenaming(null);
              }}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn" onClick={() => setRenaming(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={() => void rename()}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={t('files.delete.title')}
          message={t('files.delete.message', { name: deleting.name })}
          confirmText={t('common.delete')}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}
