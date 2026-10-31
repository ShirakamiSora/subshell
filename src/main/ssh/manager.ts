import { EventEmitter } from 'node:events';
import type {
  ConnectionInfo,
  ConnectionState,
  ExecOptions,
  ExecResult,
} from '../../shared/types';
import { SshConnection, type ShellHandle } from './connection';
import type { ServerStore } from '../store/servers';
import type { SecretStore } from '../store/secrets';
import type { KnownHostStore } from '../store/known-hosts';
import { shortId } from '../util/id';
import { createLogger } from '../util/logger';

const log = createLogger('ssh-manager');

interface TerminalSession {
  id: string;
  serverId: string;
  connection: SshConnection;
  handle: ShellHandle;
}

export interface SshManagerEvents {
  status: (info: ConnectionInfo) => void;
  terminalData: (sessionId: string, data: string) => void;
  terminalExit: (sessionId: string) => void;
}

/**
 * 连接池与终端会话管理。对上层提供「按服务器 ID 操作」的稳定接口，
 * 断线后可由监控或 AI 主动重连。
 */
export class SshManager extends EventEmitter {
  private connections = new Map<string, SshConnection>();
  private states = new Map<string, ConnectionInfo>();
  private terminals = new Map<string, TerminalSession>();
  private connecting = new Map<string, Promise<ConnectionInfo>>();

  constructor(
    private readonly servers: ServerStore,
    private readonly secrets: SecretStore,
    private readonly knownHosts: KnownHostStore,
  ) {
    super();
  }

  getState(serverId: string): ConnectionInfo {
    return (
      this.states.get(serverId) ?? {
        serverId,
        state: 'idle',
      }
    );
  }

  listStates(): ConnectionInfo[] {
    return this.servers.list().map((server) => this.getState(server.id));
  }

  private setState(serverId: string, patch: Partial<ConnectionInfo>): ConnectionInfo {
    const previous = this.getState(serverId);
    const next: ConnectionInfo = { ...previous, ...patch, serverId };
    this.states.set(serverId, next);
    this.emit('status', next);
    return next;
  }

  getConnection(serverId: string): SshConnection | null {
    const connection = this.connections.get(serverId);
    return connection?.isConnected ? connection : null;
  }

  isConnected(serverId: string): boolean {
    return Boolean(this.getConnection(serverId));
  }

  async connect(serverId: string): Promise<ConnectionInfo> {
    const existing = this.getConnection(serverId);
    if (existing) return this.getState(serverId);

    const inflight = this.connecting.get(serverId);
    if (inflight) return inflight;

    const task = this.doConnect(serverId).finally(() => this.connecting.delete(serverId));
    this.connecting.set(serverId, task);
    return task;
  }

  private async doConnect(serverId: string): Promise<ConnectionInfo> {
    const server = this.servers.get(serverId);
    if (!server) throw new Error('服务器不存在');
    this.setState(serverId, { state: 'connecting', error: undefined });
    const secret = this.secrets.get(serverId);
    const connection = new SshConnection({
      server,
      secret,
      // 内置演示服务器每次启动都会生成新的临时主机密钥，且只监听 127.0.0.1，
      // 因此跳过指纹记录；真实服务器仍然严格校验。
      verifyHostKey: (fingerprint) =>
        server.demo || this.knownHosts.verify(`${server.host}:${server.port}`, fingerprint),
    });
    connection.on('close', () => {
      this.connections.delete(serverId);
      this.setState(serverId, { state: 'disconnected', since: new Date().toISOString() });
    });
    connection.on('error', (error: Error) => {
      log.warn(`连接错误 ${server.name}: ${error.message}`);
    });

    try {
      await connection.connect();
      this.connections.set(serverId, connection);
      this.setState(serverId, {
        state: 'connected',
        since: new Date().toISOString(),
        latencyMs: connection.latencyMs,
        hostKeyFingerprint: connection.fingerprint,
        error: undefined,
      });
      log.info(`已连接 ${server.name} (${server.username}@${server.host}:${server.port})`);
      return this.getState(serverId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState(serverId, { state: 'error', error: message });
      connection.disconnect();
      throw error;
    }
  }

  /** 若未连接则尝试连接；用于监控与 Agent 的容错。 */
  async ensureConnected(serverId: string): Promise<SshConnection> {
    const existing = this.getConnection(serverId);
    if (existing) return existing;
    await this.connect(serverId);
    const connection = this.getConnection(serverId);
    if (!connection) throw new Error('连接未建立');
    return connection;
  }

  disconnect(serverId: string): void {
    for (const [sessionId, session] of this.terminals) {
      if (session.serverId === serverId) {
        session.handle.close();
        this.terminals.delete(sessionId);
      }
    }
    const connection = this.connections.get(serverId);
    connection?.disconnect();
    this.connections.delete(serverId);
    this.setState(serverId, { state: 'disconnected', since: new Date().toISOString() });
  }

  async exec(serverId: string, command: string, options?: ExecOptions): Promise<ExecResult> {
    const connection = this.getConnection(serverId);
    if (!connection) {
      return {
        stdout: '',
        stderr: 'SSH 连接未建立',
        exitCode: null,
        timedOut: false,
        durationMs: 0,
      };
    }
    return connection.exec(command, options);
  }

  async openTerminal(serverId: string, cols: number, rows: number): Promise<string> {
    const connection = await this.ensureConnected(serverId);
    const handle = await connection.openShell(cols, rows);
    const id = shortId('term');
    const session: TerminalSession = { id, serverId, connection, handle };
    this.terminals.set(id, session);
    handle.stream.on('data', (chunk: Buffer) => {
      this.emit('terminalData', id, chunk.toString('utf8'));
    });
    handle.stream.on('close', () => {
      this.terminals.delete(id);
      this.emit('terminalExit', id);
    });
    return id;
  }

  writeTerminal(sessionId: string, data: string): void {
    this.terminals.get(sessionId)?.handle.write(data);
  }

  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    this.terminals.get(sessionId)?.handle.resize(cols, rows);
  }

  closeTerminal(sessionId: string): void {
    const session = this.terminals.get(sessionId);
    if (!session) return;
    session.handle.close();
    this.terminals.delete(sessionId);
  }

  closeAll(): void {
    for (const session of this.terminals.values()) session.handle.close();
    this.terminals.clear();
    for (const connection of this.connections.values()) connection.disconnect();
    this.connections.clear();
  }
}

export type { ConnectionState };
