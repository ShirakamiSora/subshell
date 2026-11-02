import { describe, expect, it } from 'vitest';
import { buildPromptParts, buildSystemPrompt, type PromptContext } from '../src/main/ai/prompt';
import { toProviderMessages } from '../src/main/ai/agent';
import type { ServerConfig, ServerProfile } from '../src/shared/types';

const server: ServerConfig = {
  id: 'srv1',
  name: 'demo-web-01',
  host: '10.0.12.8',
  port: 22,
  username: 'ubuntu',
  authType: 'password',
  tags: [],
  createdAt: '',
  updatedAt: '',
};

const profile: ServerProfile = {
  serverId: 'srv1',
  scannedAt: new Date().toISOString(),
  hostname: 'demo-web-01',
  os: { name: 'Ubuntu', version: '22.04', kernel: '5.15', arch: 'x64' },
  hardware: { cpuModel: 'Xeon', cpuCores: 4, memTotalKb: 8_000_000, swapTotalKb: 0, diskTotalKb: 80_000_000, diskUsedKb: 30_000_000 },
  network: { interfaces: [] },
  role: 'Web 应用服务器',
  summary: '演示服务器',
  services: [{ name: 'nginx.service', kind: 'systemd', state: 'running', ports: ['80/tcp'] }],
  runtimes: [],
  webSites: [],
  risks: [],
  notes: '',
  checklist: [],
  lastUpdated: new Date().toISOString(),
};

const context: PromptContext = {
  server,
  profile,
  sample: {
    ts: Date.now(),
    cpuPercent: 41,
    memUsedPercent: 50,
    memUsedKb: 4_000_000,
    memTotalKb: 8_000_000,
    swapUsedPercent: 0,
    diskUsedPercent: 42,
    diskUsedKb: 30_000_000,
    diskTotalKb: 80_000_000,
    load1: 1,
    load5: 1,
    load15: 1,
    netRxBytesPerSec: 1000,
    netTxBytesPerSec: 500,
    processCount: 120,
    uptimeSeconds: 100_000,
  },
  services: profile.services,
  events: [{ id: 'e1', serverId: 'srv1', ts: Date.now(), severity: 'warning', kind: 'cpu', title: 'CPU 偏高', detail: '' }],
};

describe('系统提示拆分与缓存前缀', () => {
  it('档案与实时数据不变时稳定段逐字节一致', () => {
    const first = buildPromptParts(context);
    const second = buildPromptParts(context);
    expect(first.stable).toBe(second.stable);
    expect(first.version).toBe(second.version);
  });

  it('实时指标与服务告警不进入稳定段', () => {
    const parts = buildPromptParts(context);
    expect(parts.live).toContain('实时状态');
    expect(parts.live).toContain('CPU');
    expect(parts.stable).not.toContain('实时状态');
    expect(parts.stable).not.toContain('CPU：41%');
    expect(parts.stable).toContain('服务器综述');
  });

  it('档案变化时稳定段版本号变化', () => {
    const before = buildPromptParts(context);
    const after = buildPromptParts({
      ...context,
      profile: { ...profile, role: '数据库服务器', lastUpdated: new Date().toISOString() },
    });
    expect(after.version).not.toBe(before.version);
    expect(after.stable).not.toBe(before.stable);
  });

  it('实时上下文只附加到最后一条用户消息', () => {
    const messages = toProviderMessages(
      [
        { id: 'u1', role: 'user', content: '检查状态', ts: 1 },
        { id: 'a1', role: 'assistant', content: '好的', ts: 2 },
        { id: 'u2', role: 'user', content: '再看看磁盘', ts: 3 },
      ],
      '稳定系统提示',
      { liveContext: '## 实时状态\n- CPU：41%' },
    );
    expect(messages[0]).toEqual({ role: 'system', content: '稳定系统提示' });
    const userMessages = messages.filter((message) => message.role === 'user');
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]?.content).toBe('检查状态');
    expect(userMessages[1]?.content).toContain('再看看磁盘');
    expect(userMessages[1]?.content).toContain('实时状态');
  });

  it('完整系统提示同时包含稳定段与实时段', () => {
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain('## 工作方式');
    expect(prompt).toContain('## 实时状态');
  });
});
