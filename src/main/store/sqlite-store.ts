import { migrateLegacyFile, type SubshellDb } from './db';

export interface SqliteStoreOptions<T> {
  /** 当前数据结构版本。设置后以 `{ __version, data }` 保存并在读取时迁移。 */
  version?: number;
  /** 把旧版本数据迁移到当前版本。 */
  migrate?: (data: unknown, fromVersion: number) => T;
  /** 旧版 JSON 文件绝对路径：首次读取时自动导入 SQLite。 */
  legacyFile?: string;
}

interface Envelope {
  __version: number;
  data: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { __version?: unknown }).__version === 'number' &&
    'data' in value
  );
}

/**
 * SQLite 文档存储。API 与原 `JsonStore` 保持一致，业务层无需感知底层变化。
 * 每个 key 对应一行 `documents` 记录，适合服务器列表、设置、档案、对话等小体量数据。
 */
export class SqliteStore<T> {
  private cache: T | null = null;

  constructor(
    private readonly db: SubshellDb,
    private readonly key: string,
    private readonly fallback: () => T,
    private readonly options: SqliteStoreOptions<T> = {},
  ) {}

  read(): T {
    if (this.cache !== null) return this.cache;

    let raw: string | undefined;
    try {
      raw = this.db.doc(this.key);
    } catch (error) {
      // 数据库已关闭（应用退出中）时退回默认值，避免异步回调抛错。
      console.error(`[store] 读取 SQLite 失败: ${this.key}`, error);
      return this.fallback();
    }
    if (raw === undefined) {
      const legacy = this.importLegacy();
      if (legacy !== null) {
        this.write(legacy);
        return legacy;
      }
      this.cache = this.fallback();
      return this.cache;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const { value, migrated } = this.decode(parsed);
      this.cache = value;
      // 迁移后立即写回，下次启动不再重复处理。
      if (migrated) this.write(value);
      return value;
    } catch {
      this.cache = this.fallback();
      return this.cache;
    }
  }

  write(value: T): void {
    this.cache = value;
    const payload =
      typeof this.options.version === 'number' ? { __version: this.options.version, data: value } : value;
    try {
      this.db.setDoc(this.key, JSON.stringify(payload));
    } catch (error) {
      console.error(`[store] 写入 SQLite 失败: ${this.key}`, error);
    }
  }

  update(mutator: (current: T) => T): T {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }

  remove(): void {
    this.cache = null;
    this.db.deleteDoc(this.key);
  }

  /** 同步写入后无需等待，保留该方法用于调用方兼容。 */
  async flush(): Promise<void> {
    return Promise.resolve();
  }

  private importLegacy(): T | null {
    const file = this.options.legacyFile;
    if (!file) return null;
    const migrated = migrateLegacyFile(file, (parsed) => this.decode(parsed).value);
    return migrated?.value ?? null;
  }

  private decode(parsed: unknown): { value: T; migrated: boolean } {
    const expected = this.options.version;
    if (typeof expected !== 'number') return { value: parsed as T, migrated: false };

    const fromVersion = isEnvelope(parsed) ? parsed.__version : 0;
    const raw = isEnvelope(parsed) ? parsed.data : parsed;
    if (fromVersion === expected) return { value: raw as T, migrated: false };

    const value = this.options.migrate ? this.options.migrate(raw, fromVersion) : (raw as T);
    return { value, migrated: true };
  }
}
