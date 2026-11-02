import { randomBytes } from 'node:crypto';
import type { McpCallRecord, McpClient, McpClientInput } from '../../shared/types';
import type { SubshellDb } from './db';
import type { SecretStore } from './secrets';
import { shortId } from '../util/id';

const TOKEN_KEY = (id: string) => `mcp:client:${id}`;

interface McpCallRow {
  id: string;
  client_id: string;
  tool: string;
  server_id: string | null;
  ok: number;
  detail: string;
  ts: number;
}

/**
 * MCP 客户端与权限。
 * Token 只保存在系统凭据库加密文件中，本地库只保存前缀与权限；
 * 客户端可限制作用域（read / exec / admin）与可访问的服务器。
 */
export class McpClientStore {
  constructor(
    private readonly db: SubshellDb,
    private readonly secrets: SecretStore,
  ) {}

  list(): McpClient[] {
    const raw = this.db.doc('mcp-clients');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as McpClient[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  get(id: string): McpClient | null {
    return this.list().find((client) => client.id === id) ?? null;
  }

  private write(clients: McpClient[]): McpClient[] {
    this.db.setDoc('mcp-clients', JSON.stringify(clients));
    return clients;
  }

  private newToken(): string {
    return randomBytes(24).toString('base64url');
  }

  private persistToken(id: string, token: string): void {
    this.secrets.set(TOKEN_KEY(id), { password: token });
  }

  token(id: string): string {
    return this.secrets.get(TOKEN_KEY(id))?.password ?? '';
  }

  create(input: McpClientInput): { clients: McpClient[]; client: McpClient; token: string } {
    const token = this.newToken();
    const client: McpClient = {
      id: shortId('mcp'),
      name: input.name.trim() || '未命名客户端',
      scopes: input.scopes.length ? [...new Set(input.scopes)] : ['read'],
      servers: [...new Set(input.servers.filter(Boolean))],
      enabled: input.enabled ?? true,
      createdAt: Date.now(),
      calls: 0,
      tokenPrefix: token.slice(0, 8),
    };
    this.persistToken(client.id, token);
    this.write([...this.list(), client]);
    return { clients: this.list(), client, token };
  }

  update(input: McpClientInput & { id: string }): McpClient[] {
    const list = this.list();
    const existing = list.find((client) => client.id === input.id);
    if (!existing) throw new Error('MCP 客户端不存在');
    const next: McpClient = {
      ...existing,
      name: input.name.trim() || existing.name,
      scopes: input.scopes.length ? [...new Set(input.scopes)] : existing.scopes,
      servers: [...new Set(input.servers.filter(Boolean))],
      enabled: input.enabled ?? existing.enabled,
    };
    return this.write(list.map((client) => (client.id === input.id ? next : client)));
  }

  setEnabled(id: string, enabled: boolean): McpClient[] {
    return this.write(this.list().map((client) => (client.id === id ? { ...client, enabled } : client)));
  }

  rotate(id: string): { clients: McpClient[]; token: string } {
    const list = this.list();
    const client = list.find((item) => item.id === id);
    if (!client) throw new Error('MCP 客户端不存在');
    const token = this.newToken();
    this.persistToken(id, token);
    const next = { ...client, tokenPrefix: token.slice(0, 8) };
    return { clients: this.write(list.map((item) => (item.id === id ? next : item))), token };
  }

  remove(id: string): McpClient[] {
    this.secrets.delete(TOKEN_KEY(id));
    return this.write(this.list().filter((client) => client.id !== id));
  }

  /** 用 Bearer Token 找到对应客户端；逐个比较，客户端数量很少。 */
  identify(token: string): McpClient | null {
    if (!token) return null;
    for (const client of this.list()) {
      if (!client.enabled) continue;
      if (this.token(client.id) === token) return client;
    }
    return null;
  }

  recordCall(input: {
    clientId: string;
    tool: string;
    serverId?: string;
    ok: boolean;
    detail: string;
  }): void {
    this.db.run(
      'INSERT INTO mcp_calls (id, client_id, tool, server_id, ok, detail, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
      shortId('mcpcall'),
      input.clientId,
      input.tool,
      input.serverId ?? null,
      input.ok ? 1 : 0,
      input.detail.slice(0, 500),
      Date.now(),
    );
    // 调用日志只保留最近 2000 条，避免长期运行后无限增长。
    this.db.run(
      `DELETE FROM mcp_calls WHERE id NOT IN (SELECT id FROM mcp_calls ORDER BY ts DESC LIMIT 2000)`,
    );
    const clients = this.list();
    if (clients.some((client) => client.id === input.clientId)) {
      this.write(
        clients.map((client) =>
          client.id === input.clientId
            ? { ...client, calls: client.calls + 1, lastUsedAt: Date.now() }
            : client,
        ),
      );
    }
  }

  calls(limit = 100): McpCallRecord[] {
    return this.db
      .all<McpCallRow>('SELECT * FROM mcp_calls ORDER BY ts DESC LIMIT ?', limit)
      .map((row) => ({
        id: row.id,
        clientId: row.client_id,
        tool: row.tool,
        serverId: row.server_id ?? undefined,
        ok: row.ok === 1,
        detail: row.detail,
        ts: Number(row.ts),
      }));
  }
}
