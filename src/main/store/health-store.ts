import { join } from 'node:path';
import type { IssueStatus, TicketRecord } from '../../shared/types';
import type { IssueState } from '../health/report';
import { JsonStore } from './json-store';

const SCHEMA_VERSION = 2;

/**
 * 每个服务器一份体检状态与工单记录。
 * 状态只保存「用户处理过什么」，问题本身每次都由档案 + 实时数据重新推导，
 * 这样服务器恢复健康后问题会自动消失，不会留下陈旧条目。
 */
export class HealthStateStore {
  private stateStores = new Map<string, JsonStore<Record<string, IssueState>>>();
  private ticketStores = new Map<string, JsonStore<TicketRecord[]>>();

  constructor(private readonly dataDir: string) {}

  private stateStore(serverId: string): JsonStore<Record<string, IssueState>> {
    const cached = this.stateStores.get(serverId);
    if (cached) return cached;
    const store = new JsonStore<Record<string, IssueState>>(
      join(this.dataDir, 'servers', serverId, 'health.json'),
      () => ({}),
      {
        version: SCHEMA_VERSION,
        migrate: (data) =>
          typeof data === 'object' && data !== null ? (data as Record<string, IssueState>) : {},
      },
    );
    this.stateStores.set(serverId, store);
    return store;
  }

  private ticketStore(serverId: string): JsonStore<TicketRecord[]> {
    const cached = this.ticketStores.get(serverId);
    if (cached) return cached;
    const store = new JsonStore<TicketRecord[]>(
      join(this.dataDir, 'servers', serverId, 'tickets.json'),
      () => [],
      {
        version: SCHEMA_VERSION,
        migrate: (data) => (Array.isArray(data) ? (data as TicketRecord[]) : []),
      },
    );
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
  }
}
