import type {
  SecurityFindingStatus,
  SecurityRemediation,
  SecurityScan,
} from '../../shared/types';
import type { SubshellDb } from './db';
import type { SecurityFindingState } from '../security/checks';

/**
 * 安全扫描结果与修复方案。扫描是「推导结果」，每次重新计算；
 * 这里只持久化最近一次扫描、用户对问题的处理状态与已生成的修复方案。
 */
export class SecurityStore {
  constructor(private readonly db: SubshellDb) {}

  latest(serverId: string): SecurityScan | null {
    const raw = this.db.doc(`security-scan:${serverId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SecurityScan;
    } catch {
      return null;
    }
  }

  saveScan(scan: SecurityScan): SecurityScan {
    this.db.setDoc(`security-scan:${scan.serverId}`, JSON.stringify(scan));
    return scan;
  }

  states(serverId: string): Record<string, SecurityFindingState> {
    const raw = this.db.doc(`security-state:${serverId}`);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, SecurityFindingState>;
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  setStatus(serverId: string, findingId: string, status: SecurityFindingStatus): void {
    const states = this.states(serverId);
    states[findingId] = { status, updatedAt: Date.now() };
    this.db.setDoc(`security-state:${serverId}`, JSON.stringify(states));
  }

  remediations(serverId: string): SecurityRemediation[] {
    const raw = this.db.doc(`security-remediation:${serverId}`);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as SecurityRemediation[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  saveRemediation(remediation: SecurityRemediation): SecurityRemediation[] {
    const list = this.remediations(remediation.serverId);
    const index = list.findIndex((item) => item.findingId === remediation.findingId);
    const next = index >= 0
      ? list.map((item) => (item.findingId === remediation.findingId ? remediation : item))
      : [remediation, ...list].slice(0, 50);
    this.db.setDoc(`security-remediation:${remediation.serverId}`, JSON.stringify(next));
    return next;
  }

  remove(serverId: string): void {
    this.db.deleteDoc(`security-scan:${serverId}`);
    this.db.deleteDoc(`security-state:${serverId}`);
    this.db.deleteDoc(`security-remediation:${serverId}`);
  }
}
