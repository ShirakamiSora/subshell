import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import type { ExecOptions, ExecResult, RemoteEntry, ServerConfig } from '../../shared/types';
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

  /** 打开一条到远端地址的直连通道，用于本地端口转发。 */
  async forwardOut(srcHost: string, srcPort: number, dstHost: string, dstPort: number): Promise<ClientChannel> {
    return new Promise<ClientChannel>((resolve, reject) => {
      this.client.forwardOut(srcHost, srcPort, dstHost, dstPort, (error, channel) => {
        if (error) reject(error);
        else resolve(channel);
      });
    });
  }

  async sftp(): Promise<SFTPWrapper> {
    if (this.sftpCache) return this.sftpCache;
    const wrapper = await new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) reject(error);
        else resolve(sftp);
      });
    });
    this.sftpCache = wrapper;
    wrapper.on('close', () => {
      if (this.sftpCache === wrapper) this.sftpCache = null;
    });
    return wrapper;
  }

  private sftpCache: SFTPWrapper | null = null;

  /** 远端 home 目录，作为文件管理器的默认起点。 */
  async homeDir(): Promise<string> {
    const sftp = await this.sftp();
    return new Promise<string>((resolve) => {
      sftp.realpath('.', (error, resolved) => resolve(error ? '/' : resolved || '/'));
    });
  }

  async listDir(remotePath: string): Promise<RemoteEntry[]> {
    const sftp = await this.sftp();
    const entries = await new Promise<import('ssh2').FileEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (error, list) => {
        if (error) reject(error);
        else resolve(list);
      });
    });

    return entries
      .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
      .map((entry) => {
        const mode = entry.attrs.mode ?? 0;
        const kind = mode & 0o170000;
        const type: RemoteEntry['type'] =
          kind === 0o040000 ? 'directory' : kind === 0o120000 ? 'symlink' : kind === 0o100000 ? 'file' : 'other';
        const base = remotePath.endsWith('/') ? remotePath.slice(0, -1) : remotePath;
        return {
          name: entry.filename,
          path: `${base}/${entry.filename}`,
          type,
          size: entry.attrs.size ?? 0,
          mode,
          mtime: (entry.attrs.mtime ?? 0) * 1000,
          linkTarget: entry.longname?.includes(' -> ') ? entry.longname.split(' -> ')[1] : undefined,
        } satisfies RemoteEntry;
      })
      .sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (b.type === 'directory' && a.type !== 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
  }

  /** 读取小文件用于预览；超过上限直接拒绝，避免把大文件读进主进程内存。 */
  async readTextFile(remotePath: string, maxBytes = 512 * 1024): Promise<string> {
    const sftp = await this.sftp();
    return new Promise<string>((resolve, reject) => {
      sftp.open(remotePath, 'r', (openError, handle) => {
        if (openError) {
          reject(openError);
          return;
        }
        const close = () => sftp.close(handle, () => undefined);
        sftp.fstat(handle, (statError, stats) => {
          if (statError) {
            close();
            reject(statError);
            return;
          }
          const size = stats.size ?? 0;
          if (size > maxBytes) {
            close();
            reject(new Error(`文件大小 ${(size / 1024 / 1024).toFixed(1)} MB，超过预览上限，请下载后查看`));
            return;
          }
          const buffer = Buffer.alloc(size);
          sftp.read(handle, buffer, 0, size, 0, (readError) => {
            close();
            if (readError) reject(readError);
            else resolve(buffer.toString('utf8'));
          });
        });
      });
    });
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (error) => (error ? reject(error) : resolve()));
    });
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (error) => (error ? reject(error) : resolve()));
    });
  }

  async makeDir(remotePath: string): Promise<void> {
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(remotePath, (error) => (error ? reject(error) : resolve()));
    });
  }

  async renamePath(from: string, to: string): Promise<void> {
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      sftp.rename(from, to, (error) => (error ? reject(error) : resolve()));
    });
  }

  async removePath(remotePath: string, isDir: boolean): Promise<void> {
    const sftp = await this.sftp();
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error | null) => (error ? reject(error) : resolve());
      if (isDir) sftp.rmdir(remotePath, done);
      else sftp.unlink(remotePath, done);
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
