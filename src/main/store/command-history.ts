import type {
  CommandHistoryAnalysis,
  CommandHistoryEntry,
  CommandHistoryQuery,
  CommandSource,
  RiskLevel,
  RollbackPlan,
} from '../../shared/types';
import type { SubshellDb } from './db';
import { shortId } from '../util/id';

interface HistoryRow {
  id: string;
  server_id: string;
  command: string;
  source: string;
  risk: string;
  exit_code: number | null;
  ok: number;
  duration_ms: number | null;
  stdout: string | null;
  stderr: string | null;
  ts: number;
  analysis_json: string | null;
  rollback_json: string | null;
  reverted: number;
  purpose: string | null;
  cwd: string | null;
}

export interface RecordCommandInput {
  command: string;
  source: CommandSource;
  risk: RiskLevel;
  ok: boolean;
  exitCode?: number | null;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  purpose?: string;
  cwd?: string;
  ts?: number;
}

const MAX_STDOUT = 4000;
const MAX_STDERR = 1200;

function clip(text: string | undefined, max: number): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function toEntry(row: HistoryRow): CommandHistoryEntry {
  return {
    id: row.id,
    serverId: row.server_id,
    command: row.command,
    source: row.source as CommandSource,
    risk: row.risk as RiskLevel,
    ok: row.ok === 1,
    exitCode: row.exit_code ?? null,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
    ts: Number(row.ts),
    purpose: row.purpose ?? undefined,
    analysis: parseJson<CommandHistoryAnalysis>(row.analysis_json),
    rollback: parseJson<RollbackPlan>(row.rollback_json),
    reverted: row.reverted === 1,
  };
}

/**
 * 命令历史。数据量随使用时间增长，因此使用独立表并支持按服务器分页与搜索；
 * 保留条数由设置控制，超出后自动裁剪最旧记录。
 */
export class CommandHistoryStore {
  constructor(private readonly db: SubshellDb) {}

  append(serverId: string, input: RecordCommandInput, retention = 2000): CommandHistoryEntry {
    const entry: CommandHistoryEntry = {
      id: shortId('cmd'),
      serverId,
      command: input.command,
      source: input.source,
      risk: input.risk,
      ok: input.ok,
      exitCode: input.exitCode ?? null,
      durationMs: input.durationMs,
      stdout: input.stdout,
      stderr: input.stderr,
      ts: input.ts ?? Date.now(),
      purpose: input.purpose,
      reverted: false,
    };
    this.db.run(
      `INSERT INTO command_history
        (id, server_id, command, source, risk, exit_code, ok, duration_ms, stdout, stderr, ts, purpose, cwd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      serverId,
      entry.command,
      entry.source,
      entry.risk,
      entry.exitCode ?? null,
      entry.ok ? 1 : 0,
      entry.durationMs ?? null,
      clip(entry.stdout, MAX_STDOUT),
      clip(entry.stderr, MAX_STDERR),
      entry.ts,
      entry.purpose ?? null,
      input.cwd ?? null,
    );
    this.prune(serverId, retention);
    return entry;
  }

  list(serverId: string, options: CommandHistoryQuery = {}): CommandHistoryEntry[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const clauses = ['server_id = ?'];
    const params: (string | number)[] = [serverId];
    if (options.source) {
      clauses.push('source = ?');
      params.push(options.source);
    }
    if (options.query?.trim()) {
      clauses.push('command LIKE ?');
      params.push(`%${options.query.trim()}%`);
    }
    params.push(limit);
    const rows = this.db.all<HistoryRow>(
      `SELECT * FROM command_history WHERE ${clauses.join(' AND ')} ORDER BY ts DESC LIMIT ?`,
      ...params,
    );
    return rows.map(toEntry);
  }

  get(serverId: string, id: string): CommandHistoryEntry | null {
    const row = this.db.get<HistoryRow>(
      'SELECT * FROM command_history WHERE id = ? AND server_id = ?',
      id,
      serverId,
    );
    return row ? toEntry(row) : null;
  }

  setAnalysis(serverId: string, id: string, analysis: CommandHistoryAnalysis): void {
    this.db.run(
      'UPDATE command_history SET analysis_json = ? WHERE id = ? AND server_id = ?',
      JSON.stringify(analysis),
      id,
      serverId,
    );
  }

  setRollback(serverId: string, id: string, plan: RollbackPlan): void {
    this.db.run(
      'UPDATE command_history SET rollback_json = ? WHERE id = ? AND server_id = ?',
      JSON.stringify(plan),
      id,
      serverId,
    );
  }

  markReverted(serverId: string, id: string): void {
    this.db.run('UPDATE command_history SET reverted = 1 WHERE id = ? AND server_id = ?', id, serverId);
  }

  remove(serverId: string, id: string): void {
    this.db.run('DELETE FROM command_history WHERE id = ? AND server_id = ?', id, serverId);
  }

  clear(serverId: string): void {
    this.db.run('DELETE FROM command_history WHERE server_id = ?', serverId);
  }

  removeServer(serverId: string): void {
    this.clear(serverId);
  }

  count(serverId: string): number {
    return this.db.get<{ count: number }>(
      'SELECT count(*) AS count FROM command_history WHERE server_id = ?',
      serverId,
    )?.count ?? 0;
  }

  /** 保留最近的 N 条记录，删除更早的。 */
  private prune(serverId: string, retention: number): void {
    const keep = Math.max(50, Math.min(retention, 20_000));
    this.db.run(
      `DELETE FROM command_history
       WHERE server_id = ?
         AND id NOT IN (
           SELECT id FROM command_history WHERE server_id = ? ORDER BY ts DESC LIMIT ?
         )`,
      serverId,
      serverId,
      keep,
    );
  }
}
