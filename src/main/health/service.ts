import { EventEmitter } from 'node:events';
import type { HealthReport, IssueStatus, TicketRecord } from '../../shared/types';
import type { ProfileStore } from '../store/profile-store';
import type { RuntimeStore } from '../store/runtime-store';
import type { HealthStateStore } from '../store/health-store';
import { buildHealthReport } from './report';

export interface HealthDeps {
  profiles: ProfileStore;
  runtime: RuntimeStore;
  states: HealthStateStore;
}

/**
 * 体检服务：把档案、监控事件、服务状态与用户处理记录合成为一份报告。
 * 报告是「推导结果」而不是存储对象，服务器恢复后问题会自动消失。
 */
export class HealthService extends EventEmitter {
  constructor(private readonly deps: HealthDeps) {
    super();
  }

  report(serverId: string): HealthReport {
    const profile = this.deps.profiles.get(serverId);
    const runtime = this.deps.runtime.get(serverId);
    const services = runtime.services.length ? runtime.services : (profile?.services ?? []);
    return buildHealthReport({
      serverId,
      profile,
      events: runtime.events,
      services,
      states: this.deps.states.states(serverId),
    });
  }

  setStatus(serverId: string, issueId: string, status: IssueStatus): HealthReport {
    this.deps.states.setStatus(serverId, issueId, status);
    const report = this.report(serverId);
    this.emit('update', serverId, report);
    return report;
  }

  tickets(serverId: string, limit?: number): TicketRecord[] {
    return this.deps.states.listTickets(serverId, limit);
  }

  recordTicket(ticket: TicketRecord): void {
    this.deps.states.addTicket(ticket.serverId, ticket);
    this.emit('update', ticket.serverId, this.report(ticket.serverId));
  }

  remove(serverId: string): void {
    this.deps.states.remove(serverId);
  }
}
