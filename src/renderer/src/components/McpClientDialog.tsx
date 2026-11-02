import { useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import type { McpClient, McpScope, ServerConfig } from '@shared/types';
import { Modal } from './Modal';
import { useApp } from '../store/app';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';

const scopeKeys: McpScope[] = ['read', 'exec', 'admin'];

/** 新建/编辑 MCP 客户端：作用域与服务器白名单。Token 只在创建或轮换后显示一次。 */
export function McpClientDialog({
  client,
  servers,
  endpoint,
  onClose,
  onSaved,
}: {
  client: McpClient | null;
  servers: ServerConfig[];
  endpoint: string;
  onClose: () => void;
  onSaved: (clients: McpClient[]) => void;
}) {
  const { t } = useI18n();
  const notify = useApp((state) => state.notify);
  const [name, setName] = useState(client?.name ?? '');
  const [scopes, setScopes] = useState<McpScope[]>(client?.scopes ?? ['read']);
  const [allowed, setAllowed] = useState<string[]>(client?.servers ?? []);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const toggleScope = (scope: McpScope) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  const submit = async () => {
    if (!name.trim()) {
      notify('warning', t('mcp.needName'));
      return;
    }
    setSaving(true);
    try {
      const result = await api.mcp.saveClient({
        id: client?.id,
        name: name.trim(),
        scopes,
        servers: allowed,
        enabled: client?.enabled,
      });
      onSaved(result.clients);
      if (result.token) {
        // 新建客户端：先展示一次性 Token，用户确认后再关闭。
        setToken(result.token);
      } else {
        notify('success', t('mcp.clientSaved'));
        onClose();
      }
    } catch (error) {
      notify('error', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={client ? t('mcp.editClient') : t('mcp.addClient')}
      description={t('mcp.clientDesc')}
      onClose={onClose}
      width="max-w-xl"
      footer={
        token ? (
          <button className="btn btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
              {saving ? <Loader2 size={12} className="spin" /> : null}
              {t('common.save')}
            </button>
          </>
        )
      }
    >
      {token ? (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">{t('mcp.tokenOnce')}</p>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
            <code className="mono min-w-0 flex-1 break-all text-[12px] text-[var(--text)]">{token}</code>
            <button
              className="btn h-7 px-2 text-[11.5px]"
              onClick={() => {
                void navigator.clipboard.writeText(token);
                notify('success', t('settings.mcp.copied'));
              }}
            >
              <Copy size={11} />
              {t('settings.mcp.copy')}
            </button>
          </div>
          <pre className="mono overflow-auto rounded-lg border border-[var(--border)] bg-[var(--code-bg)] px-3 py-2 text-[11px] text-[var(--muted)]">
{`{
  "mcpServers": {
    "subshell": {
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer ${token}" }
    }
  }
}`}
          </pre>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label">{t('mcp.clientName')}</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <label className="label">{t('mcp.scopes')}</label>
            <div className="space-y-1">
              {scopeKeys.map((scope) => (
                <label key={scope} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-teal-400"
                    checked={scopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  <span>
                    <span className="block text-[12px] text-[var(--text)]">{t(`mcp.scope.${scope}`)}</span>
                    <span className="block text-[11px] text-[var(--muted-2)]">{t(`mcp.scope.${scope}Desc`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">{t('mcp.allowedServers')}</label>
            <p className="mb-1 text-[11px] text-[var(--muted-2)]">{t('mcp.allowedServersHint')}</p>
            <div className="scroll-area max-h-40 space-y-0.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-1.5">
              {servers.map((server) => (
                <label key={server.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--panel-3)]">
                  <input
                    type="checkbox"
                    className="accent-teal-400"
                    checked={allowed.includes(server.id)}
                    onChange={() =>
                      setAllowed((current) =>
                        current.includes(server.id)
                          ? current.filter((item) => item !== server.id)
                          : [...current, server.id],
                      )
                    }
                  />
                  <span className="text-[12px] text-[var(--text)]">{server.name}</span>
                  <span className="mono text-[10.5px] text-[var(--muted-2)]">{server.host}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
