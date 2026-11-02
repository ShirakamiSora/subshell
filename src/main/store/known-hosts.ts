import { join } from 'node:path';
import type { SubshellDb } from './db';
import { SqliteStore } from './sqlite-store';
import { createLogger } from '../util/logger';

const log = createLogger('known-hosts');

/**
 * 首次连接自动信任并记录主机指纹；指纹变化时拒绝连接，防止中间人攻击。
 * 用户可在「服务器设置」中清除记录后重新信任。
 */
export class KnownHostStore {
  private readonly store: SqliteStore<Record<string, string>>;

  constructor(db: SubshellDb) {
    this.store = new SqliteStore<Record<string, string>>(db, 'known-hosts', () => ({}), {
      legacyFile: join(db.dataDir, 'known-hosts.json'),
    });
  }

  verify(hostKey: string, fingerprint: string): boolean {
    const known = this.store.read()[hostKey];
    if (!known) {
      this.store.update((current) => ({ ...current, [hostKey]: fingerprint }));
      log.info(`已记录主机指纹 ${hostKey} ${fingerprint}`);
      return true;
    }
    if (known === fingerprint) return true;
    log.warn(`主机指纹变化 ${hostKey}: ${known} -> ${fingerprint}`);
    return false;
  }

  fingerprint(hostKey: string): string | undefined {
    return this.store.read()[hostKey];
  }

  forget(hostKey: string): void {
    this.store.update((current) => {
      const next = { ...current };
      delete next[hostKey];
      return next;
    });
  }

  clear(): void {
    this.store.write({});
  }
}
