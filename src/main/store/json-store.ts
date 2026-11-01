import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface JsonStoreOptions<T> {
  pretty?: boolean;
  /** 当前数据结构版本。一旦设置，文件会以 `{ __version, data }` 保存。 */
  version?: number;
  /** 把旧版本数据迁移到当前版本。 */
  migrate?: (data: unknown, fromVersion: number) => T;
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
 * 简单的 JSON 文件存储。
 * 数据量很小（服务器列表、设置、档案），写入采用同步原子替换，
 * 确保用户保存后立即关闭应用也不会丢数据。
 *
 * 设置 `version` 后文件带版本号：升级应用时可以用 `migrate` 把旧数据补成新结构，
 * 避免字段调整导致老用户的档案、对话或设置读不出来。
 */
export class JsonStore<T> {
  private cache: T | null = null;

  constructor(
    private readonly file: string,
    private readonly fallback: () => T,
    private readonly options: JsonStoreOptions<T> = {},
  ) {}

  read(): T {
    if (this.cache !== null) return this.cache;
    const { value, migrated } = this.load();
    this.cache = value;
    // 迁移或旧格式转换后立即写回，下次启动不再重复迁移。
    if (migrated) this.write(value);
    return this.cache;
  }

  write(value: T): void {
    this.cache = value;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = join(dirname(this.file), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
      const payload =
        typeof this.options.version === 'number'
          ? { __version: this.options.version, data: value }
          : value;
      const text = this.options.pretty === false ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, this.file);
    } catch (error) {
      console.error(`[store] 写盘失败: ${this.file}`, error);
    }
  }

  update(mutator: (current: T) => T): T {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }

  /** 同步写入后无需额外等待，保留该方法用于调用方兼容。 */
  async flush(): Promise<void> {
    return Promise.resolve();
  }

  private load(): { value: T; migrated: boolean } {
    try {
      if (!existsSync(this.file)) return { value: this.fallback(), migrated: false };
      const text = readFileSync(this.file, 'utf8');
      if (!text.trim()) return { value: this.fallback(), migrated: false };
      const parsed = JSON.parse(text) as unknown;

      const expected = this.options.version;
      if (typeof expected !== 'number') {
        // 未启用版本化：保持原来的裸数据格式。
        return { value: parsed as T, migrated: false };
      }

      const fromVersion = isEnvelope(parsed) ? parsed.__version : 0;
      const raw = isEnvelope(parsed) ? parsed.data : parsed;
      if (fromVersion === expected) return { value: raw as T, migrated: false };

      const migrated = this.options.migrate ? this.options.migrate(raw, fromVersion) : (raw as T);
      return { value: migrated, migrated: true };
    } catch (error) {
      // 文件损坏时备份一份，避免静默丢数据。
      try {
        copyFileSync(this.file, `${this.file}.broken-${Date.now()}`);
      } catch {
        // 忽略备份失败
      }
      console.warn(`[store] 读取失败，使用默认值: ${this.file}`, error);
      return { value: this.fallback(), migrated: false };
    }
  }
}
