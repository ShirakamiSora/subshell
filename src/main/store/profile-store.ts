import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerProfile } from '../../shared/types';
import { createLogger } from '../util/logger';

const log = createLogger('profile-store');

/** profile.json 的结构版本，与 ServerProfile.schemaVersion 对应。 */
const SCHEMA_VERSION = 2;

/** 把旧版本档案补齐成当前结构，缺字段用安全默认值。 */
function normalizeProfile(raw: unknown, serverId: string): ServerProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const profile = raw as Partial<ServerProfile>;
  return {
    ...profile,
    serverId: profile.serverId ?? serverId,
    scannedAt: profile.scannedAt ?? new Date().toISOString(),
    hostname: profile.hostname ?? '未知主机',
    os: profile.os ?? { name: 'Linux', version: '', kernel: '', arch: '' },
    hardware: profile.hardware ?? {
      cpuModel: '',
      cpuCores: 0,
      memTotalKb: 0,
      swapTotalKb: 0,
      diskTotalKb: 0,
      diskUsedKb: 0,
    },
    network: profile.network ?? { interfaces: [] },
    role: profile.role ?? '通用 Linux 服务器',
    summary: profile.summary ?? '',
    services: Array.isArray(profile.services) ? profile.services : [],
    runtimes: Array.isArray(profile.runtimes) ? profile.runtimes : [],
    webSites: Array.isArray(profile.webSites) ? profile.webSites : [],
    risks: Array.isArray(profile.risks) ? profile.risks : [],
    checklist: Array.isArray(profile.checklist) ? profile.checklist : [],
    notes: typeof profile.notes === 'string' ? profile.notes : '',
    lastUpdated: profile.lastUpdated ?? new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  } as ServerProfile;
}

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
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        profile = normalizeProfile(parsed, serverId);
        // 旧版本档案读入后立即迁移写回，避免每次启动重复处理。
        if (profile && (parsed as ServerProfile | null)?.schemaVersion !== SCHEMA_VERSION) {
          this.save(serverId, profile);
        }
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
    const next: ServerProfile = { ...profile, schemaVersion: SCHEMA_VERSION };
    writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    this.cache.set(serverId, next);
    return next;
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
