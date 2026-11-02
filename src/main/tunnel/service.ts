import { EventEmitter } from 'node:events';
import { createServer, type Server as NetServer, type Socket } from 'node:net';
import { join } from 'node:path';
import type { TunnelConfig, TunnelStatus } from '../../shared/types';
import type { SshManager } from '../ssh/manager';
import type { SubshellDb } from '../store/db';
import { SqliteStore } from '../store/sqlite-store';
import { createLogger } from '../util/logger';

const log = createLogger('tunnel');

interface ActiveTunnel {
  config: TunnelConfig;
  server: NetServer;
  sockets: Set<Socket>;
  since: number;
}

export interface TunnelInput {
  id?: string;
  label?: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

/**
 * 本地端口转发：在 127.0.0.1 上监听一个端口，把连接通过 SSH 通道转发到
 * 「服务器视角」的地址。只绑定回环地址，不对外暴露。
 */
export class TunnelService extends EventEmitter {
  private active = new Map<string, ActiveTunnel>();
  private stores = new Map<string, SqliteStore<TunnelConfig[]>>();

  constructor(
    private readonly db: SubshellDb,
    private readonly ssh: SshManager,
  ) {
    super();
  }

  private store(serverId: string): SqliteStore<TunnelConfig[]> {
    const cached = this.stores.get(serverId);
    if (cached) return cached;
    const store = new SqliteStore<TunnelConfig[]>(this.db, `tunnels:${serverId}`, () => [], {
      version: 2,
      legacyFile: join(this.db.dataDir, 'servers', serverId, 'tunnels.json'),
      migrate: (data) => (Array.isArray(data) ? (data as TunnelConfig[]) : []),
    });
    this.stores.set(serverId, store);
    return store;
  }

  private findConfig(id: string): TunnelConfig | null {
    for (const store of this.stores.values()) {
      const found = store.read().find((item) => item.id === id);
      if (found) return found;
    }
    return null;
  }

  private statusOf(config: TunnelConfig, error?: string): TunnelStatus {
    const running = this.active.get(config.id);
    return {
      ...config,
      running: Boolean(running),
      connections: running?.sockets.size ?? 0,
      since: running?.since,
      error,
    };
  }

  list(serverId: string): TunnelStatus[] {
    return this.store(serverId).read().map((config) => this.statusOf(config));
  }

  /** 新增或修改一条转发规则。已运行的规则修改后会先停止。 */
  async save(serverId: string, input: TunnelInput): Promise<TunnelStatus[]> {
    const localPort = Math.round(input.localPort);
    const remotePort = Math.round(input.remotePort);
    if (localPort < 1 || localPort > 65535 || remotePort < 1 || remotePort > 65535) {
      throw new Error('端口必须在 1-65535 之间');
    }
    const remoteHost = input.remoteHost.trim() || '127.0.0.1';
    if (!/^[a-zA-Z0-9.:_-]{1,200}$/.test(remoteHost)) throw new Error('目标地址不合法');

    const list = this.store(serverId).read();
    const id = input.id ?? `tun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const next: TunnelConfig = {
      id,
      serverId,
      label: input.label?.trim() || `${localPort} → ${remoteHost}:${remotePort}`,
      localPort,
      remoteHost,
      remotePort,
    };
    const index = list.findIndex((item) => item.id === id);
    const updated = index >= 0 ? list.map((item) => (item.id === id ? next : item)) : [...list, next];
    this.store(serverId).write(updated);

    if (this.active.has(id)) {
      this.stop(id);
      await this.start(id);
    }
    this.emit('update', serverId);
    return this.list(serverId);
  }

  async start(id: string): Promise<void> {
    if (this.active.has(id)) return;
    const config = this.findConfig(id);
    if (!config) throw new Error('转发规则不存在');
    const connection = await this.ssh.ensureConnected(config.serverId);

    const sockets = new Set<Socket>();
    const server = createServer((socket: Socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => sockets.delete(socket));

      void connection
        .forwardOut('127.0.0.1', socket.remotePort ?? 0, config.remoteHost, config.remotePort)
        .then((channel) => {
          socket.pipe(channel).pipe(socket);
          channel.on('error', () => socket.destroy());
          socket.on('close', () => {
            try {
              channel.close();
            } catch {
              // 通道可能已关闭
            }
          });
        })
        .catch((error: unknown) => {
          log.warn(`转发失败 ${config.localPort} -> ${config.remoteHost}:${config.remotePort}`, error);
          socket.destroy();
        });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(config.localPort, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    }).catch((error: unknown) => {
      const message =
        (error as { code?: string }).code === 'EADDRINUSE'
          ? `本地端口 ${config.localPort} 已被占用`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new Error(message);
    });

    server.on('error', (error) => log.warn(`转发服务错误 ${config.localPort}`, error));
    this.active.set(id, { config, server, sockets, since: Date.now() });
    log.info(`端口转发已启动 127.0.0.1:${config.localPort} -> ${config.remoteHost}:${config.remotePort}`);
    this.emit('update', config.serverId);
  }

  stop(id: string): void {
    const tunnel = this.active.get(id);
    if (!tunnel) return;
    for (const socket of tunnel.sockets) socket.destroy();
    tunnel.sockets.clear();
    tunnel.server.close();
    this.active.delete(id);
    log.info(`端口转发已停止 127.0.0.1:${tunnel.config.localPort}`);
    this.emit('update', tunnel.config.serverId);
  }

  remove(serverId: string, id: string): TunnelStatus[] {
    this.stop(id);
    this.store(serverId).write(this.store(serverId).read().filter((item) => item.id !== id));
    this.emit('update', serverId);
    return this.list(serverId);
  }

  stopAll(): void {
    for (const id of [...this.active.keys()]) this.stop(id);
  }

  removeServer(serverId: string): void {
    for (const [id, tunnel] of this.active) {
      if (tunnel.config.serverId === serverId) this.stop(id);
    }
    this.stores.delete(serverId);
    this.db.deleteDoc(`tunnels:${serverId}`);
  }
}
