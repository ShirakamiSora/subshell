import { join } from 'node:path';
import type { IssueStatus, TicketRecord } from '../../shared/types';
import type { IssueState } from '../health/report';
import type { SubshellDb } from './db';
import { SqliteStore } from './sqlite-store';

const SCHEMA_VERSION = 2;

/**
 * 每个服务器一份体检状态与工单记录。
 * 状态只保存「用户处理过什么」，问题本身每次都由档案 + 实时数据重新推导，
 * 这样服务器恢复健康后问题会自动消失，不会留下陈旧条目。
 */
export class HealthStateStore {
  private stateStores = new Map<string, SqliteStore<Record<string, IssueState>>>();
  private ticketStores = new Map<string, SqliteStore<TicketRecord[]>>();

  constructor(private readonly db: SubshellDb) {}

  private stateStore(serverId: string): SqliteStore<Record<string, IssueState>> {
    const cached = this.stateStores.get(serverId);
    if (cached) return cached;
    const store = new SqliteStore<Record<string, IssueState>>(this.db, `health:${serverId}`, () => ({}), {
      version: SCHEMA_VERSION,
      legacyFile: join(this.db.dataDir, 'servers', serverId, 'health.json'),
      migrate: (data) =>
        typeof data === 'object' && data !== null ? (data as Record<string, IssueState>) : {},
    });
    this.stateStores.set(serverId, store);
    return store;
  }

  private ticketStore(serverId: string): SqliteStore<TicketRecord[]> {
    const cached = this.ticketStores.get(serverId);
    if (cached) return cached;
    const store = new SqliteStore<TicketRecord[]>(this.db, `tickets:${serverId}`, () => [], {
      version: SCHEMA_VERSION,
      legacyFile: join(this.db.dataDir, 'servers', serverId, 'tickets.json'),
      migrate: (data) => (Array.isArray(data) ? (data as TicketRecord[]) : []),
    });
    this.ticketStores.set(serverId, store);
    return store;
  }

  states(serverId: string): Record<string, IssueState> {
    return this.stateStore(serverId).read();
  }

  setStatus(serverId: string, issueId: string, status: IssueStatus): Record<string, IssueState> {
    return this.stateStore(serverId).update((current) => ({
      ...current,
      [issueId]: { status, updatedAt: Date.now() },
    }));
  }

  addTicket(serverId: string, ticket: TicketRecord): TicketRecord[] {
    return this.ticketStore(serverId).update((current) => [ticket, ...current].slice(0, 200));
  }

  listTickets(serverId: string, limit = 50): TicketRecord[] {
    return this.ticketStore(serverId).read().slice(0, limit);
  }

  remove(serverId: string): void {
    this.stateStores.delete(serverId);
    this.ticketStores.delete(serverId);
    this.db.deleteDoc(`health:${serverId}`);
    this.db.deleteDoc(`tickets:${serverId}`);
  }
}
