import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 简单的 JSON 文件存储。
 * 数据量很小（服务器列表、设置、档案），写入采用同步原子替换，
 * 确保用户保存后立即关闭应用也不会丢数据。
 */
export class JsonStore<T> {
  private cache: T | null = null;

  constructor(
    private readonly file: string,
    private readonly fallback: () => T,
    private readonly options: { pretty?: boolean } = {},
  ) {}

  read(): T {
    if (this.cache !== null) return this.cache;
    this.cache = this.load();
    return this.cache;
  }

  write(value: T): void {
    this.cache = value;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = join(dirname(this.file), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
      const text = this.options.pretty === false ? JSON.stringify(value) : JSON.stringify(value, null, 2);
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

  private load(): T {
    try {
      if (!existsSync(this.file)) return this.fallback();
      const text = readFileSync(this.file, 'utf8');
      if (!text.trim()) return this.fallback();
      return JSON.parse(text) as T;
    } catch (error) {
      // 文件损坏时备份一份，避免静默丢数据。
      try {
        copyFileSync(this.file, `${this.file}.broken-${Date.now()}`);
      } catch {
        // 忽略备份失败
      }
      console.warn(`[store] 读取失败，使用默认值: ${this.file}`, error);
      return this.fallback();
    }
  }
}
