import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry, RiskLevel } from '../../shared/types';
import type { SubshellDb } from './db';
import { shortId } from '../util/id';

/**
 * 审计日志（SQLite 表 `audit`），记录用户与 AI 发起的每一次变更操作。
 * 旧版 `audit.jsonl` 在首次打开时自动导入。
 */
export class AuditStore {
  constructor(private readonly db: SubshellDb) {
    this.importLegacy();
  }

  private importLegacy(): void {
    const file = join(this.db.dataDir, 'audit.jsonl');
    if (!existsSync(file)) return;
    const existing = this.db.get<{ count: number }>('SELECT count(*) AS count FROM audit')?.count ?? 0;
    if (existing > 0) return;
    try {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      this.db.transaction(() => {
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as AuditEntry;
            if (!entry.id || !entry.serverId) continue;
            this.insert(entry);
          } catch {
            // 跳过坏行
          }
        }
      });
      renameSync(file, `${file}.migrated`);
    } catch {
      // 导入失败保留原文件，不影响启动
    }
  }

  private insert(entry: AuditEntry): void {
    this.db.run(
      'INSERT OR REPLACE INTO audit (id, server_id, ts, actor, action, detail, risk, ok) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      entry.id,
      entry.serverId,
      entry.ts,
      entry.actor,
      entry.action,
      entry.detail,
      entry.risk ?? null,
      entry.ok ? 1 : 0,
    );
  }

  append(entry: Omit<AuditEntry, 'id' | 'ts'>): AuditEntry {
    const full: AuditEntry = { ...entry, id: shortId('aud'), ts: Date.now() };
    try {
      this.insert(full);
    } catch {
      // 审计失败不应阻断操作
    }
    return full;
  }

  list(serverId?: string, limit = 200): AuditEntry[] {
    const rows = serverId
      ? this.db.all('SELECT * FROM audit WHERE server_id = ? ORDER BY ts DESC LIMIT ?', serverId, limit)
      : this.db.all('SELECT * FROM audit ORDER BY ts DESC LIMIT ?', limit);
    return rows.map((row) => ({
      id: String(row.id),
      serverId: String(row.server_id),
      ts: Number(row.ts),
      actor: String(row.actor) === 'user' ? 'user' : 'ai',
      action: String(row.action),
      detail: String(row.detail),
      risk: (row.risk as RiskLevel | null) ?? undefined,
      ok: Number(row.ok) === 1,
    }));
  }
}
