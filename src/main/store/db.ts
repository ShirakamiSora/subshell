import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import { createLogger } from '../util/logger';

const log = createLogger('db');

/**
 * 本地数据库。v0.3.7 起全部结构化数据写入 SQLite（`subshell.db`），
 * 不再为每个对象维护独立 JSON 文件。
 *
 * 设计取舍：
 * - 使用 Electron 内置 Node 的 `node:sqlite`，不引入需要原生编译的依赖；
 * - 同一数据目录只保留一个连接（主进程串行访问，避免锁竞争）；
 * - 旧 JSON 文件在首次读取时由 `SqliteStore` 导入并改名备份，升级不丢数据；
 * - 凭据仍单独放在系统凭据库加密文件里（安全红线：密钥不进入数据库/日志）。
 */

const databases = new Map<string, SubshellDb>();

/** 打开（或复用）某个数据目录的数据库连接。 */
export function openDatabase(dataDir: string): SubshellDb {
  const cached = databases.get(dataDir);
  if (cached) return cached;
  const db = new SubshellDb(dataDir);
  databases.set(dataDir, db);
  return db;
}

export function closeDatabase(dataDir: string): void {
  const db = databases.get(dataDir);
  if (!db) return;
  databases.delete(dataDir);
  db.close();
}

/** 供测试与退出流程统一释放文件句柄（Windows 下不关闭会锁住临时目录）。 */
export function closeAllDatabases(): void {
  for (const [dataDir, db] of [...databases.entries()]) {
    databases.delete(dataDir);
    db.close();
  }
}

export type DocValue = string;

/** 一个 SQLite 语句返回的原始行。 */
export type DbRow = Record<string, SQLOutputValue>;
export type DbParam = SQLInputValue;

export class SubshellDb {
  readonly file: string;
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'subshell.db');
    this.db = new DatabaseSync(this.file);
    // WAL 让读写互不阻塞；NORMAL 在本地单进程场景下足够安全且明显更快。
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        risk TEXT,
        ok INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_server_ts ON audit (server_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (ts DESC);
      CREATE TABLE IF NOT EXISTS command_history (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        command TEXT NOT NULL,
        source TEXT NOT NULL,
        risk TEXT NOT NULL,
        exit_code INTEGER,
        ok INTEGER NOT NULL,
        duration_ms INTEGER,
        stdout TEXT,
        stderr TEXT,
        ts INTEGER NOT NULL,
        analysis_json TEXT,
        rollback_json TEXT,
        reverted INTEGER NOT NULL DEFAULT 0,
        purpose TEXT,
        cwd TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_history_server_ts ON command_history (server_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_history_ts ON command_history (ts DESC);
      CREATE TABLE IF NOT EXISTS approval_log (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        command TEXT NOT NULL,
        decision TEXT NOT NULL,
        source TEXT NOT NULL,
        risk TEXT NOT NULL,
        reason TEXT NOT NULL,
        rule_id TEXT,
        auto INTEGER NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approval_server_ts ON approval_log (server_id, ts DESC);
      CREATE TABLE IF NOT EXISTS mcp_calls (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        server_id TEXT,
        ok INTEGER NOT NULL,
        detail TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_calls_ts ON mcp_calls (ts DESC);
    `);
    const version = this.get<{ user_version: number }>('PRAGMA user_version')?.user_version;
    if (typeof version !== 'number' || version < 1) this.db.exec('PRAGMA user_version = 1');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, ...params: DbParam[]): void {
    this.db.prepare(sql).run(...params);
  }

  get<T = DbRow>(sql: string, ...params: DbParam[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = DbRow>(sql: string, ...params: DbParam[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** 包裹一次多语句写入；异常时回滚并继续抛出。 */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // 回滚失败不掩盖原始异常
      }
      throw error;
    }
  }

  // ---- documents：小体量文档（服务器列表、设置、档案、对话等） ----

  doc(key: string): string | undefined {
    const row = this.get<{ value: string }>('SELECT value FROM documents WHERE key = ?', key);
    return row?.value;
  }

  setDoc(key: string, value: string): void {
    this.run(
      'INSERT INTO documents (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      key,
      value,
      Date.now(),
    );
  }

  deleteDoc(key: string): void {
    this.run('DELETE FROM documents WHERE key = ?', key);
  }

  docKeys(prefix: string): string[] {
    return this.all<{ key: string }>('SELECT key FROM documents WHERE key LIKE ?', `${prefix}%`).map(
      (row) => row.key,
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch (error) {
      log.warn('关闭数据库失败', error);
    }
  }
}

export interface LegacyMigration<T> {
  /** 旧 JSON 文件绝对路径。 */
  file: string;
  /** 把旧文件内容转换为当前结构。 */
  convert: (parsed: unknown) => T;
}

/**
 * 旧 JSON → SQLite 的一次性迁移。
 * 只读取、不删除原文件：导入成功后改名成 `.migrated`，方便用户回退排查。
 */
export function migrateLegacyFile<T>(
  file: string,
  convert: (parsed: unknown) => T,
): { value: T; migrated: boolean } | null {
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return null;
    const parsed = JSON.parse(text) as unknown;
    const value = convert(parsed);
    try {
      renameSync(file, `${file}.migrated`);
    } catch {
      // 改名失败不影响导入结果
    }
    log.info(`已迁移旧数据到 SQLite: ${file}`);
    return { value, migrated: true };
  } catch (error) {
    log.warn(`旧数据迁移失败，保留原文件: ${file}`, error);
    return null;
  }
}
