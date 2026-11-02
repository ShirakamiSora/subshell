import { join } from 'node:path';
import type { ServerConfig } from '../../shared/types';
import type { SubshellDb } from './db';
import { SqliteStore } from './sqlite-store';

export interface ServerInput {
  id?: string;
  name?: string;
  host: string;
  port?: number;
  username: string;
  authType: 'password' | 'key';
  privateKeyPath?: string;
  description?: string;
  group?: string;
  color?: string;
  tags?: string[];
  demo?: boolean;
  jump?: ServerConfig['jump'];
}

const COLORS = ['#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#f87171'];

/** 服务器列表存储。只保存非秘密配置，凭据由 SecretStore 单独管理。 */
export class ServerStore {
  private readonly store: SqliteStore<ServerConfig[]>;

  constructor(db: SubshellDb) {
    this.store = new SqliteStore<ServerConfig[]>(db, 'servers', () => [], {
      version: 2,
      legacyFile: join(db.dataDir, 'servers.json'),
      migrate: (data) => {
        const list = Array.isArray(data) ? data : [];
        return list.map((item) => {
          const server = (item ?? {}) as Partial<ServerConfig>;
          return {
            ...server,
            tags: Array.isArray(server.tags) ? server.tags : [],
            group: server.group ?? '默认分组',
            jump: server.jump ?? null,
            demo: server.demo ?? false,
            createdAt: server.createdAt ?? new Date().toISOString(),
            updatedAt: server.updatedAt ?? new Date().toISOString(),
          } as ServerConfig;
        });
      },
    });
  }

  list(): ServerConfig[] {
    return this.store.read();
  }

  get(id: string): ServerConfig | null {
    return this.list().find((item) => item.id === id) ?? null;
  }

  create(input: ServerInput): ServerConfig {
    const now = new Date().toISOString();
    const list = this.list();
    const id = input.id ?? `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const server: ServerConfig = {
      id,
      name: input.name?.trim() || input.host,
      host: input.host.trim(),
      port: input.port ?? 22,
      username: input.username.trim(),
      authType: input.authType,
      privateKeyPath: input.privateKeyPath,
      description: input.description,
      group: input.group?.trim() || '默认分组',
      color: input.color || COLORS[list.length % COLORS.length]!,
      tags: input.tags ?? [],
      demo: input.demo ?? false,
      jump: input.jump ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.write([...list, server]);
    return server;
  }

  update(id: string, patch: ServerInput): ServerConfig {
    const list = this.list();
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('服务器不存在');
    const current = list[index]!;
    const next: ServerConfig = {
      ...current,
      name: patch.name?.trim() || patch.host || current.name,
      host: patch.host?.trim() ?? current.host,
      port: patch.port ?? current.port,
      username: patch.username?.trim() ?? current.username,
      authType: patch.authType ?? current.authType,
      privateKeyPath: patch.privateKeyPath ?? current.privateKeyPath,
      description: patch.description ?? current.description,
      group: patch.group?.trim() || current.group,
      tags: patch.tags ?? current.tags,
      jump: patch.jump === undefined ? current.jump : patch.jump,
      updatedAt: new Date().toISOString(),
    };
    const copy = [...list];
    copy[index] = next;
    this.store.write(copy);
    return next;
  }

  remove(id: string): void {
    this.store.write(this.list().filter((item) => item.id !== id));
  }
}
