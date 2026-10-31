import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry } from '../../shared/types';
import { shortId } from '../util/id';

/** 追加式审计日志（JSONL），记录用户与 AI 发起的每一次变更操作。 */
export class AuditStore {
  constructor(private readonly dataDir: string) {}

  private file(): string {
    return join(this.dataDir, 'audit.jsonl');
  }

  append(entry: Omit<AuditEntry, 'id' | 'ts'>): AuditEntry {
    const full: AuditEntry = { ...entry, id: shortId('aud'), ts: Date.now() };
    try {
      mkdirSync(this.dataDir, { recursive: true });
      appendFileSync(this.file(), `${JSON.stringify(full)}\n`, 'utf8');
    } catch {
      // 审计失败不应阻断操作
    }
    return full;
  }

  list(serverId?: string, limit = 200): AuditEntry[] {
    const file = this.file();
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const entries: AuditEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i]!) as AuditEntry;
        if (!serverId || parsed.serverId === serverId) entries.push(parsed);
      } catch {
        // 跳过坏行
      }
    }
    return entries;
  }
}
