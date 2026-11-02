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
  /** 尚未提交的输入行，用于记录交互式命令历史。 */
  buffer: string;
  /** 正在解析方向键等转义序列。 */
  escape: boolean;
  /** 上一次输出疑似密码提示，下一条输入不记录。 */
  maskNext: boolean;
}

export interface SshManagerEvents {
  status: (info: ConnectionInfo) => void;
  terminalData: (sessionId: string, data: string) => void;
  terminalExit: (sessionId: string) => void;
  /** 用户在交互式终端里提交了一条命令（密码等敏感输入会被忽略）。 */
  terminalCommand: (serverId: string, command: string) => void;
}

const PASSWORD_PROMPT = /(password|passphrase|密码|口令)/i;

/**
 * 把终端输入累积成命令。只处理可打印字符与回车，
 * 方向键、Tab 补全等控制序列直接忽略；检测到密码提示后跳过下一条输入。
 */
function consumeTerminalInput(session: TerminalSession, data: string): string[] {
  const commands: string[] = [];
  for (const char of data) {
    if (char === '\x1b') {
      session.escape = true;
      continue;
    }
    if (session.escape) {
      // CSI / SS3 序列以字母或 ~ 结束
      if (/[A-Za-z~]/.test(char)) session.escape = false;
      continue;
    }
    if (char === '\r' || char === '\n') {
      const command = session.buffer.trim();
      session.buffer = '';
      if (command) commands.push(command);
      continue;
    }
    if (char === '\x7f' || char === '\b') {
      session.buffer = session.buffer.slice(0, -1);
      continue;
    }
    if (char === '\x03' || char === '\x1a') {
      session.buffer = '';
      session.maskNext = false;
      continue;
    }
    if (char === '\t' || char < ' ') continue;
    session.buffer += char;
    // 防止异常输入撑爆内存
    if (session.buffer.length > 8192) session.buffer = session.buffer.slice(-8192);
  }
  return commands;
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
    const session: TerminalSession = {
      id,
      serverId,
      connection,
      handle,
      buffer: '',
      escape: false,
      maskNext: false,
    };
    this.terminals.set(id, session);
    handle.stream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      // 终端一旦出现密码提示，下一条输入不进入命令历史。
      if (PASSWORD_PROMPT.test(text)) session.maskNext = true;
      this.emit('terminalData', id, text);
    });
    handle.stream.on('close', () => {
      this.terminals.delete(id);
      this.emit('terminalExit', id);
    });
    return id;
  }

  writeTerminal(sessionId: string, data: string): void {
    const session = this.terminals.get(sessionId);
    if (!session) return;
    session.handle.write(data);
    for (const command of consumeTerminalInput(session, data)) {
      if (session.maskNext) {
        session.maskNext = false;
        continue;
      }
      this.emit('terminalCommand', session.serverId, command);
    }
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
