import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerProfile } from '../../shared/types';
import { createLogger } from '../util/logger';

const log = createLogger('profile-store');

/** 每个服务器一份档案，独立文件，便于备份与导出。 */
export class ProfileStore {
  private cache = new Map<string, ServerProfile | null>();

  constructor(private readonly dataDir: string) {}

  private file(serverId: string): string {
    return join(this.dataDir, 'servers', serverId, 'profile.json');
  }

  get(serverId: string): ServerProfile | null {
    if (this.cache.has(serverId)) return this.cache.get(serverId) ?? null;
    const file = this.file(serverId);
    let profile: ServerProfile | null = null;
    if (existsSync(file)) {
      try {
        profile = JSON.parse(readFileSync(file, 'utf8')) as ServerProfile;
      } catch (error) {
        log.error(`档案解析失败: ${serverId}`, error);
      }
    }
    this.cache.set(serverId, profile);
    return profile;
  }

  save(serverId: string, profile: ServerProfile): ServerProfile {
    const file = this.file(serverId);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
    this.cache.set(serverId, profile);
    return profile;
  }

  patch(serverId: string, patch: Partial<ServerProfile>): ServerProfile {
    const current = this.get(serverId);
    if (!current) throw new Error('服务器档案不存在，请先执行侦察');
    const next: ServerProfile = { ...current, ...patch, lastUpdated: new Date().toISOString() };
    return this.save(serverId, next);
  }

  remove(serverId: string): void {
    this.cache.delete(serverId);
    try {
      rmSync(join(this.dataDir, 'servers', serverId), { recursive: true, force: true });
    } catch (error) {
      log.warn(`删除档案失败: ${serverId}`, error);
    }
  }
}
