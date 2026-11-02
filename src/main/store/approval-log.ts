import type { ApprovalAction, ApprovalRecord, ApprovalSource, RiskLevel } from '../../shared/types';
import type { SubshellDb } from './db';
import { shortId } from '../util/id';

interface ApprovalRow {
  id: string;
  server_id: string;
  command: string;
  decision: string;
  source: string;
  risk: string;
  reason: string;
  rule_id: string | null;
  auto: number;
  ts: number;
}

/** 审批判定记录：谁（规则/模型）在什么时候对哪条命令做了什么决定。 */
export class ApprovalLogStore {
  constructor(private readonly db: SubshellDb) {}

  append(input: {
    serverId: string;
    command: string;
    decision: ApprovalAction;
    source: ApprovalSource;
    risk: RiskLevel;
    reason: string;
    ruleId?: string;
    auto: boolean;
  }): ApprovalRecord {
    const record: ApprovalRecord = {
      id: shortId('appr'),
      ts: Date.now(),
      serverId: input.serverId,
      command: input.command,
      decision: input.decision,
      source: input.source,
      risk: input.risk,
      reason: input.reason,
      ruleId: input.ruleId,
      auto: input.auto,
    };
    this.db.run(
      `INSERT INTO approval_log
        (id, server_id, command, decision, source, risk, reason, rule_id, auto, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.serverId,
      record.command,
      record.decision,
      record.source,
      record.risk,
      record.reason,
      record.ruleId ?? null,
      record.auto ? 1 : 0,
      record.ts,
    );
    // 审批日志保留最近 5000 条，足够复盘且不会无限膨胀。
    this.db.run(
      `DELETE FROM approval_log WHERE id NOT IN (SELECT id FROM approval_log ORDER BY ts DESC LIMIT 5000)`,
    );
    return record;
  }

  list(serverId?: string, limit = 100): ApprovalRecord[] {
    const rows = serverId
      ? this.db.all<ApprovalRow>(
          'SELECT * FROM approval_log WHERE server_id = ? ORDER BY ts DESC LIMIT ?',
          serverId,
          limit,
        )
      : this.db.all<ApprovalRow>('SELECT * FROM approval_log ORDER BY ts DESC LIMIT ?', limit);
    return rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      command: row.command,
      decision: row.decision as ApprovalAction,
      source: row.source as ApprovalSource,
      risk: row.risk as RiskLevel,
      reason: row.reason,
      ruleId: row.rule_id ?? undefined,
      auto: row.auto === 1,
      ts: Number(row.ts),
    }));
  }

  removeServer(serverId: string): void {
    this.db.run('DELETE FROM approval_log WHERE server_id = ?', serverId);
  }
}
