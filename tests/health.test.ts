import { describe, expect, it } from 'vitest';
import { buildHealthReport } from '../src/main/health/report';
import type { MonitorEvent, ServerProfile, ServiceInfo } from '../src/shared/types';

function profile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    serverId: 'srv1',
    scannedAt: new Date().toISOString(),
    hostname: 'demo',
    os: { name: 'Ubuntu', version: '22.04', kernel: '5.15', arch: 'x64' },
    hardware: { cpuModel: 'Xeon', cpuCores: 4, memTotalKb: 8_000_000, swapTotalKb: 0, diskTotalKb: 1, diskUsedKb: 0 },
    network: { interfaces: [] },
    role: 'Web',
    summary: '',
    services: [],
    runtimes: [],
    webSites: [],
    risks: [],
    notes: '',
    checklist: [],
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

function service(name: string, state: ServiceInfo['state']): ServiceInfo {
  return { name, kind: 'systemd', state };
}

function event(overrides: Partial<MonitorEvent> = {}): MonitorEvent {
  return {
    id: 'evt1',
    serverId: 'srv1',
    ts: Date.now(),
    severity: 'warning',
    kind: 'disk',
    title: '磁盘占用偏高',
    detail: '根分区 92%',
    ...overrides,
  };
}

describe('体检报告', () => {
  it('没有问题时是满分且状态优秀', () => {
    const report = buildHealthReport({
      serverId: 'srv1',
      profile: profile(),
      events: [],
      services: [],
      states: {},
      now: 1_000,
    });
    expect(report.score.score).toBe(100);
    expect(report.score.grade).toBe('excellent');
    expect(report.issues).toHaveLength(0);
  });

  it('档案风险按严重度计入分数与排序', () => {
    const report = buildHealthReport({
      serverId: 'srv1',
      profile: profile({
        risks: [
          { id: 'r1', level: 'critical', title: '磁盘即将写满', detail: '剩余 1GB' },
          { id: 'r2', level: 'warning', title: 'SSH 允许 root 登录', detail: '' },
          { id: 'r3', level: 'info', title: '有软件包可升级', detail: '' },
        ],
      }),
      events: [],
      services: [],
      states: {},
      now: 1_000,
    });
    expect(report.score.critical).toBe(1);
    expect(report.score.warning).toBe(1);
    expect(report.score.info).toBe(1);
    expect(report.score.score).toBe(100 - 15 - 6 - 1);
    expect(report.issues[0]?.severity).toBe('critical');
    // 建议动作应针对磁盘场景给出可执行方向
    expect(report.issues[0]?.suggestion).toContain('du');
  });

  it('失败服务是严重问题，并带上服务名', () => {
    const report = buildHealthReport({
      serverId: 'srv1',
      profile: profile(),
      events: [],
      services: [service('nginx.service', 'running'), service('fail2ban.service', 'failed')],
      states: {},
      now: 1_000,
    });
    const issue = report.issues.find((item) => item.source === 'service');
    expect(issue?.severity).toBe('critical');
    expect(issue?.service).toBe('fail2ban.service');
  });

  it('指向同一失败服务的档案风险不会重复出现', () => {
    const report = buildHealthReport({
      serverId: 'srv1',
      profile: profile({ risks: [{ id: 'r1', level: 'critical', title: 'fail2ban.service 启动失败', detail: '' }] }),
      events: [],
      services: [service('fail2ban.service', 'failed')],
      states: {},
      now: 1_000,
    });
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.source).toBe('service');
  });

  it('已确认的告警不计入问题列表', () => {
    const report = buildHealthReport({
      serverId: 'srv1',
      profile: profile(),
      events: [event({ acknowledged: true }), event({ id: 'evt2', title: '内存紧张' })],
      services: [],
      states: {},
      now: Date.now(),
    });
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.title).toBe('内存紧张');
  });

  it('超过 7 天的历史事件不再计入', () => {
    const report = buildHealthReport({
      serverId: 'srv1',
      profile: profile(),
      events: [event({ ts: Date.now() - 8 * 24 * 60 * 60 * 1000 })],
      services: [],
      states: {},
      now: Date.now(),
    });
    expect(report.issues).toHaveLength(0);
  });

  it('用户标记已解决后不再扣分', () => {
    const report = buildHealthReport({
      serverId: 'srv1',
      profile: profile({ risks: [{ id: 'r1', level: 'critical', title: '磁盘即将写满', detail: '' }] }),
      events: [],
      services: [],
      states: { 'risk:r1': { status: 'resolved', updatedAt: 1 } },
      now: 1_000,
    });
    expect(report.score.critical).toBe(0);
    expect(report.score.score).toBe(100);
    expect(report.issues[0]?.status).toBe('resolved');
  });

  it('未完成的检查项作为提示出现', () => {
    const report = buildHealthReport({
      serverId: 'srv1',
      profile: profile({
        checklist: [
          { id: 'c1', text: '配置备份任务', done: false },
          { id: 'c2', text: '已完成项', done: true },
        ],
      }),
      events: [],
      services: [],
      states: {},
      now: 1_000,
    });
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.source).toBe('checklist');
    expect(report.issues[0]?.severity).toBe('info');
  });

  it('分数不会低于 0', () => {
    const risks = Array.from({ length: 10 }, (_, index) => ({
      id: `r${index}`,
      level: 'critical' as const,
      title: `问题 ${index}`,
      detail: '',
    }));
    const report = buildHealthReport({
      serverId: 'srv1',
      profile: profile({ risks }),
      events: [],
      services: [],
      states: {},
      now: 1_000,
    });
    expect(report.score.score).toBe(0);
    expect(report.score.grade).toBe('poor');
  });
});
