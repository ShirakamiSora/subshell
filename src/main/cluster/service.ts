import { EventEmitter } from 'node:events';
import type {
  ClusterCheck,
  ClusterPrecheckResult,
  ClusterRun,
  ClusterRunInput,
  ServerConfig,
} from '../../shared/types';
import type { SshManager } from '../ssh/manager';
import type { ServerStore } from '../store/servers';
import type { SettingsStore } from '../store/settings';
import type { AuditStore } from '../store/audit';
import type { ClusterStore } from '../store/cluster-store';
import type { RecordCommandInput } from '../store/command-history';
import { classifyCommand } from '../ai/risk';
import { createLogger } from '../util/logger';

const log = createLogger('cluster');
const MAX_OUTPUT = 6000;

export interface ClusterServiceDeps {
  ssh: SshManager;
  servers: ServerStore;
  settings: SettingsStore;
  audit: AuditStore;
  store: ClusterStore;
  recordCommand?: (serverId: string, input: RecordCommandInput) => void;
}

/** 提取命令的首个可执行词，用于预检命令是否存在。 */
function commandHead(command: string): string | null {
  const words = command
    .trim()
    .split(/\s*(?:;|&&|\|\||\||>|<)\s*/)[0]
    ?.trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words?.length) return null;
  // `sudo apt install` 应该检查 apt，而不是 sudo。
  const first = words[0] === 'sudo' ? words[1] : words[0];
  if (!first) return null;
  if (!/^[a-zA-Z0-9_./-]+$/.test(first)) return null;
  return first;
}

function precheckScript(command?: string): string {
  const head = command ? commandHead(command) : null;
  const lines = [
    'set +e',
    "printf 'USER=%s\\n' \"$(id -un 2>/dev/null)\"",
    "printf 'UID=%s\\n' \"$(id -u 2>/dev/null)\"",
    "printf 'SHELL_OK=%s\\n' \"$(printf ok 2>/dev/null)\"",
    "printf 'DISK_FREE_KB=%s\\n' \"$(df -Pk / 2>/dev/null | tail -1 | awk '{print $4}')\"",
    "printf 'SUDO_NOPASS=%s\\n' \"$(sudo -n true >/dev/null 2>&1 && echo yes || echo no)\"",
  ];
  if (head) {
    lines.push(`printf 'CMD=%s\\n' "$(command -v ${head} 2>/dev/null || echo missing)"`);
  }
  lines.push("printf 'KERNEL=%s\\n' \"$(uname -sr 2>/dev/null)\"");
  return lines.join('\n');
}

function parseKeyValue(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 集群运维：
 * 1. 下发前先对每台服务器做前置环境预检（连接、Shell、磁盘、命令是否存在、sudo 可用性）；
 * 2. 只有预检通过的机器才并行执行同一命令/目标；
 * 3. 结果逐台回显，危险命令在本地直接拒绝。
 */
export class ClusterService extends EventEmitter {
  private cancelled = new Set<string>();

  constructor(private readonly deps: ClusterServiceDeps) {
    super();
  }

  history(limit = 20): ClusterRun[] {
    return this.deps.store.list(limit);
  }

  private targets(serverIds: string[]): ServerConfig[] {
    const servers = this.deps.servers.list();
    return serverIds
      .map((id) => servers.find((server) => server.id === id))
      .filter((server): server is ServerConfig => Boolean(server));
  }

  /** 只做前置检查，不执行目标命令。 */
  async precheck(serverIds: string[], command?: string): Promise<ClusterPrecheckResult[]> {
    const servers = this.targets(serverIds);
    const concurrency = Math.max(1, Math.min(this.deps.settings.get().clusterParallelism, 16));
    return mapLimit(servers, concurrency, (server) => this.checkServer(server, command));
  }

  private async checkServer(server: ServerConfig, command?: string): Promise<ClusterPrecheckResult> {
    const started = Date.now();
    const checks: ClusterCheck[] = [];
    try {
      await this.deps.ssh.ensureConnected(server.id);
      const latencyMs = Date.now() - started;
      checks.push({
        name: 'ssh',
        ok: true,
        detail: `SSH 连接正常${latencyMs ? `（${latencyMs}ms）` : ''}`,
      });

      const result = await this.deps.ssh.exec(server.id, precheckScript(command), { timeoutMs: 20_000 });
      const values = parseKeyValue(result.stdout);
      checks.push({
        name: 'shell',
        ok: values.SHELL_OK === 'ok',
        detail: values.SHELL_OK === 'ok' ? 'Shell 可执行命令' : 'Shell 无法执行命令',
      });
      if (values.USER) {
        checks.push({
          name: 'user',
          ok: true,
          detail: `执行用户 ${values.USER}（UID ${values.UID ?? '?'}）`,
        });
      }
      const freeKb = Number.parseInt(values.DISK_FREE_KB ?? '', 10);
      if (Number.isFinite(freeKb)) {
        checks.push({
          name: 'disk',
          ok: freeKb >= 102_400,
          detail: `根分区可用 ${(freeKb / 1024 / 1024).toFixed(2)} GB${freeKb < 102_400 ? '（不足 100 MB）' : ''}`,
        });
      }
      if (command) {
        const head = commandHead(command);
        if (head) {
          const missing = values.CMD === 'missing' || !values.CMD;
          checks.push({
            name: 'command',
            ok: !missing,
            detail: missing ? `未找到命令 ${head}` : `命令 ${head} 可用`,
          });
        }
        if (/^\s*sudo\b/.test(command)) {
          const sudoOk = values.SUDO_NOPASS === 'yes';
          checks.push({
            name: 'sudo',
            ok: sudoOk,
            detail: sudoOk ? '免密 sudo 可用' : '需要密码的 sudo 在批量执行中不可用，请改用免密 sudo 或以 root 连接',
          });
        }
      }
      const failed = checks.filter((check) => !check.ok);
      return {
        serverId: server.id,
        serverName: server.name,
        ok: failed.length === 0,
        latencyMs,
        checks,
      };
    } catch (error) {
      return {
        serverId: server.id,
        serverName: server.name,
        ok: false,
        latencyMs: Date.now() - started,
        checks,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async run(input: ClusterRunInput): Promise<ClusterRun> {
    const servers = this.targets(input.serverIds);
    if (!servers.length) throw new Error('请至少选择一台服务器');
    const command = input.command.trim();
    if (!command) throw new Error('命令不能为空');

    const assessment = classifyCommand(command);
    if (assessment.level === 'blocked') {
      throw new Error(`本地安全策略拒绝该命令：${assessment.reasons.join('；')}`);
    }

    const run: ClusterRun = {
      id: `cluster_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      command,
      purpose: input.purpose,
      startedAt: Date.now(),
      phase: 'prechecking',
      targets: servers.map((server) => ({
        serverId: server.id,
        serverName: server.name,
        status: 'prechecking',
        precheck: { ok: false, checks: [] },
      })),
    };
    this.emit('update', { ...run, targets: run.targets.map((target) => ({ ...target })) });
    const concurrency = Math.max(
      1,
      Math.min(input.concurrency ?? this.deps.settings.get().clusterParallelism, 16, servers.length),
    );

    try {
      // ---- 前置预检 ----
      const prechecks = await mapLimit(servers, concurrency, (server) => this.checkServer(server, command));
      for (const precheck of prechecks) {
        const target = run.targets.find((item) => item.serverId === precheck.serverId);
        if (!target) continue;
        target.precheck = {
          ok: precheck.ok,
          checks: precheck.checks,
          latencyMs: precheck.latencyMs,
          error: precheck.error,
        };
        target.status = precheck.ok ? 'ready' : 'blocked';
      }
      this.emit('update', { ...run, targets: run.targets.map((target) => ({ ...target })) });

      if (this.cancelled.has(run.id)) {
        run.phase = 'cancelled';
        run.finishedAt = Date.now();
        this.deps.store.save(run);
        return run;
      }

      // ---- 并行执行 ----
      run.phase = 'running';
      this.emit('update', { ...run, targets: run.targets.map((target) => ({ ...target })) });

      const ready = run.targets.filter((target) => target.status === 'ready');
      await mapLimit(ready, concurrency, async (target) => {
        if (this.cancelled.has(run.id)) {
          target.status = 'skipped';
          return;
        }
        target.status = 'running';
        this.emit('update', { ...run, targets: run.targets.map((item) => ({ ...item })) });
        const server = servers.find((item) => item.id === target.serverId);
        if (!server) {
          target.status = 'failed';
          target.stderr = '服务器不存在';
          return;
        }
        const started = Date.now();
        try {
          const sudo = /^\s*sudo\b/.test(command);
          const actual = sudo ? command.replace(/^\s*sudo\s+/, '') : command;
          const result = await this.deps.ssh.exec(target.serverId, actual, {
            timeoutMs: 180_000,
            sudo,
          });
          target.status = result.exitCode === 0 ? 'ok' : 'failed';
          target.exitCode = result.exitCode;
          target.stdout = result.stdout.slice(0, MAX_OUTPUT);
          target.stderr = result.stderr.slice(0, MAX_OUTPUT);
          target.durationMs = Date.now() - started;
          this.deps.audit.append({
            serverId: target.serverId,
            actor: 'user',
            action: 'cluster_run',
            detail: command,
            risk: assessment.level,
            ok: result.exitCode === 0,
          });
          this.deps.recordCommand?.(target.serverId, {
            command,
            source: 'cluster',
            risk: assessment.level,
            ok: result.exitCode === 0,
            exitCode: result.exitCode,
            durationMs: target.durationMs,
            stdout: result.stdout,
            stderr: result.stderr,
            purpose: input.purpose || '集群批量执行',
          });
        } catch (error) {
          target.status = 'failed';
          target.stderr = error instanceof Error ? error.message : String(error);
          target.durationMs = Date.now() - started;
        } finally {
          this.emit('update', { ...run, targets: run.targets.map((item) => ({ ...item })) });
        }
      });

      for (const target of run.targets) {
        if (target.status === 'ready') target.status = 'skipped';
      }
      run.phase = this.cancelled.has(run.id) ? 'cancelled' : 'done';
      run.finishedAt = Date.now();
      this.deps.store.save(run);
      this.emit('update', { ...run, targets: run.targets.map((target) => ({ ...target })) });
      log.info(`集群任务完成：${run.targets.filter((item) => item.status === 'ok').length}/${servers.length} 成功`);
      return run;
    } catch (error) {
      run.phase = 'failed';
      run.finishedAt = Date.now();
      this.deps.store.save(run);
      this.emit('update', { ...run, targets: run.targets.map((target) => ({ ...target })) });
      throw error;
    } finally {
      this.cancelled.delete(run.id);
    }
  }

  cancel(runId: string): void {
    this.cancelled.add(runId);
  }
}
