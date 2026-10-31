import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type { ExecOptions, ExecResult, ServerConfig } from '../../shared/types';
import type { ServerSecretInput } from '../../shared/types';
import { createLogger } from '../util/logger';

const log = createLogger('ssh');

const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ResolvedSshOptions {
  server: ServerConfig;
  secret: ServerSecretInput | null;
  /** 返回 true 表示接受该主机指纹 */
  verifyHostKey: (fingerprint: string) => boolean;
}

export interface ShellHandle {
  stream: ClientChannel;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/** 把命令安全地包进 `sh -c`，避免远端默认 shell（fish/csh）解析差异。 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}

/** 把主机公钥转换为可展示的 SHA256 指纹。 */
export function fingerprintHostKey(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/**
 * 单条 SSH 连接。负责认证、命令执行队列、交互 shell 与 SFTP。
 * 所有命令串行执行，避免远端 MaxSessions 限制与并发输出交错。
 */
export class SshConnection extends EventEmitter {
  readonly serverId: string;
  private client = new Client();
  private execQueue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private shellStream: ClientChannel | null = null;
  latencyMs = 0;
  fingerprint = '';

  constructor(private readonly options: ResolvedSshOptions) {
    super();
    this.serverId = options.server.id;
    this.client.on('close', () => {
      this.closed = true;
      this.shellStream?.close();
      this.emit('close');
    });
    this.client.on('error', (error) => {
      this.emit('error', error);
    });
  }

  get isConnected(): boolean {
    return !this.closed;
  }

  async connect(): Promise<void> {
    const started = Date.now();
    const config = await this.buildConfig(this.options.server, this.options.secret);
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        this.latencyMs = Date.now() - started;
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        this.client.removeListener('ready', onReady);
        this.client.removeListener('error', onError);
      };
      this.client.once('ready', onReady);
      this.client.once('error', onError);
      try {
        this.client.connect(config);
      } catch (error) {
        cleanup();
        reject(error as Error);
      }
    });
  }

  private async buildConfig(server: ServerConfig, secret: ServerSecretInput | null): Promise<ConnectConfig> {
    const base: ConnectConfig = {
      host: server.host,
      port: server.port,
      username: server.username,
      readyTimeout: 25_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 4,
      hostVerifier: (key: Buffer) => {
        const fingerprint = fingerprintHostKey(key);
        this.fingerprint = fingerprint;
        return this.options.verifyHostKey(fingerprint);
      },
    };

    if (secret?.password) base.password = secret.password;
    if (server.authType === 'key' || secret?.privateKey) {
      const keyText = secret?.privateKey?.trim()
        ? secret.privateKey
        : server.privateKeyPath
          ? readFileSync(expandHome(server.privateKeyPath), 'utf8')
          : '';
      if (keyText) {
        base.privateKey = keyText;
        if (secret?.passphrase) base.passphrase = secret.passphrase;
      }
    }

    if (server.jump) {
      const jumpClient = new Client();
      const jump = server.jump;
      await new Promise<void>((resolve, reject) => {
        jumpClient.once('ready', () => resolve());
        jumpClient.once('error', reject);
        jumpClient.connect({
          host: jump.host,
          port: jump.port,
          username: jump.username,
          password: secret?.password,
          privateKey: secret?.privateKey,
          passphrase: secret?.passphrase,
          readyTimeout: 25_000,
          keepaliveInterval: 15_000,
        });
      });
      const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
        jumpClient.forwardOut('127.0.0.1', 0, server.host, server.port, (error, channel) => {
          if (error) reject(error);
          else resolve(channel as unknown as NodeJS.ReadableStream);
        });
      });
      this.jumpClient = jumpClient;
      base.sock = stream as ConnectConfig['sock'];
    }

    return base;
  }

  private jumpClient: Client | null = null;

  exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return this.enqueue(() => this.execInner(command, options));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.execQueue.then(task, task);
    this.execQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private wrapCommand(command: string, sudo: boolean, hasPassword: boolean): string {
    const inner = `sh -c ${shellQuote(command)}`;
    if (!sudo) return inner;
    return hasPassword
      ? `sudo -S -p '' -- ${inner}`
      : `sudo -n -- ${inner}`;
  }

  private execInner(command: string, options: ExecOptions): Promise<ExecResult> {
    const started = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const password = this.options.secret?.password ?? '';
    const wrapped = this.wrapCommand(command, Boolean(options.sudo), Boolean(password));

    return new Promise<ExecResult>((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let exitCode: number | null = null;
      let timedOut = false;

      const finish = (uncertain = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode,
          timedOut,
          uncertain: uncertain || timedOut,
          durationMs: Date.now() - started,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          stream?.close();
        } catch {
          // ignore
        }
        finish(true);
      }, timeoutMs);

      let stream: ClientChannel | null = null;
      this.client.exec(wrapped, (error, channel) => {
        if (error) {
          stderr = error.message;
          finish(false);
          return;
        }
        stream = channel;
        if (options.sudo && password) {
          channel.write(`${password}\n`);
        }
        channel.on('data', (chunk: Buffer) => {
          if (stdout.length + chunk.length > MAX_OUTPUT_BYTES) {
            if (stdout.length < MAX_OUTPUT_BYTES) {
              stdout += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stdout.length);
              stdout += '\n…[输出过长已截断]';
            }
            return;
          }
          stdout += chunk.toString('utf8');
        });
        channel.stderr.on('data', (chunk: Buffer) => {
          if (stderr.length < 64_000) stderr += chunk.toString('utf8');
        });
        channel.on('exit', (code: number | null) => {
          exitCode = code;
        });
        channel.on('close', () => finish(false));
        channel.on('error', (err: Error) => {
          stderr += err.message;
          finish(false);
        });
      });
    });
  }

  openShell(cols: number, rows: number): Promise<ShellHandle> {
    return new Promise((resolve, reject) => {
      this.client.shell({ term: 'xterm-256color', cols, rows }, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        this.shellStream = stream;
        stream.on('close', () => {
          this.shellStream = null;
        });
        resolve({
          stream,
          write: (data: string) => stream.write(data),
          resize: (nextCols: number, nextRows: number) => {
            try {
              stream.setWindow(nextRows, nextCols, 0, 0);
            } catch {
              // 断线后忽略
            }
          },
          close: () => {
            try {
              stream.close();
            } catch {
              // ignore
            }
          },
        });
      });
    });
  }

  async sftp(): Promise<import('ssh2').SFTPWrapper> {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) reject(error);
        else resolve(sftp);
      });
    });
  }

  /** 上传文本文件（用于把服务器档案写入远端 ~/.subshell）。 */
  async writeRemoteFile(remotePath: string, content: string): Promise<void> {
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath, { encoding: 'utf8' });
      stream.on('close', () => resolve());
      stream.on('error', reject);
      stream.end(content);
    });
  }

  disconnect(): void {
    this.closed = true;
    try {
      this.shellStream?.close();
    } catch {
      // ignore
    }
    try {
      this.client.end();
    } catch {
      // ignore
    }
    try {
      this.jumpClient?.end();
    } catch {
      // ignore
    }
    log.info(`连接已断开: ${this.options.server.name}`);
  }
}
