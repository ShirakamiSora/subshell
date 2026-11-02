import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerProfile } from '../../shared/types';
import type { SubshellDb } from './db';
import { createLogger } from '../util/logger';

const log = createLogger('profile-store');

/** profile 的结构版本，与 ServerProfile.schemaVersion 对应。 */
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

/** 每个服务器一份档案，存放在 SQLite 的 `profile:<serverId>` 文档中。 */
export class ProfileStore {
  private cache = new Map<string, ServerProfile | null>();

  constructor(private readonly db: SubshellDb) {}

  get(serverId: string): ServerProfile | null {
    if (this.cache.has(serverId)) return this.cache.get(serverId) ?? null;
    let profile: ServerProfile | null = null;
    const raw = this.db.doc(`profile:${serverId}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        profile = normalizeProfile(parsed, serverId);
        // 旧版本档案读入后立即迁移写回，避免每次启动重复处理。
        if (profile && (parsed as ServerProfile | null)?.schemaVersion !== SCHEMA_VERSION) {
          this.save(serverId, profile);
        }
      } catch (error) {
        log.error(`档案解析失败: ${serverId}`, error);
      }
    } else {
      profile = this.importLegacy(serverId);
    }
    this.cache.set(serverId, profile);
    return profile;
  }

  /** 从 v0.3.6 及更早版本的独立 profile.json 导入一次。 */
  private importLegacy(serverId: string): ServerProfile | null {
    const file = join(this.db.dataDir, 'servers', serverId, 'profile.json');
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      const profile = normalizeProfile(parsed, serverId);
      if (profile) {
        this.save(serverId, profile);
        log.info(`已迁移服务器档案到 SQLite: ${serverId}`);
      }
      return profile;
    } catch (error) {
      log.warn(`旧档案迁移失败: ${serverId}`, error);
      return null;
    }
  }

  save(serverId: string, profile: ServerProfile): ServerProfile {
    const next: ServerProfile = { ...profile, schemaVersion: SCHEMA_VERSION };
    this.db.setDoc(`profile:${serverId}`, JSON.stringify(next));
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
    this.db.deleteDoc(`profile:${serverId}`);
  }
}
