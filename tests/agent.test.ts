import { describe, expect, it, vi } from 'vitest';
import { AgentService, toProviderMessages } from '../src/main/ai/agent';
import type { AgentStreamEvent, ChatMessage, ExecResult, ServerConfig, ServerProfile } from '../src/shared/types';
import type { RuntimeData } from '../src/main/store/runtime-store';

const server: ServerConfig = {
  id: 'srv1',
  name: 'demo-web-01',
  host: '127.0.0.1',
  port: 2222,
  username: 'ubuntu',
  authType: 'password',
  group: 'demo',
  tags: [],
  createdAt: '',
  updatedAt: '',
};

const sample = {
  ts: Date.now(),
  cpuPercent: 21,
  memUsedPercent: 50,
  memUsedKb: 4_000_000,
  memTotalKb: 8_000_000,
  swapUsedPercent: 0,
  diskUsedPercent: 42,
  diskUsedKb: 35_000_000,
  diskTotalKb: 83_000_000,
  load1: 1,
  load5: 1,
  load15: 1,
  netRxBytesPerSec: 1000,
  netTxBytesPerSec: 500,
  processCount: 120,
  uptimeSeconds: 100_000,
};

const profile: ServerProfile = {
  serverId: 'srv1',
  scannedAt: new Date().toISOString(),
  hostname: 'demo-web-01',
  os: { name: 'Ubuntu', version: '22.04', kernel: '5.15.0', arch: 'x86_64' },
  hardware: { cpuModel: 'Xeon', cpuCores: 4, memTotalKb: 8_000_000, swapTotalKb: 0, diskTotalKb: 83_000_000, diskUsedKb: 35_000_000 },
  network: { interfaces: [] },
  role: 'Web 应用服务器',
  summary: '演示服务器',
  services: [
    { name: 'nginx.service', kind: 'systemd', state: 'running', ports: ['80/tcp'] },
    { name: 'fail2ban.service', kind: 'systemd', state: 'failed', ports: [] },
  ],
  runtimes: [],
  webSites: [],
  risks: [],
  notes: '',
  checklist: [],
  lastUpdated: new Date().toISOString(),
};

function createHarness() {
  const chats = new Map<string, ChatMessage[]>();
  const chat = {
    list: (id: string) => chats.get(id) ?? [],
    append: (id: string, message: ChatMessage) => {
      const list = [...(chats.get(id) ?? []), message];
      chats.set(id, list);
      return list;
    },
    updateMessage: (id: string, messageId: string, patch: Partial<ChatMessage>) => {
      const list = (chats.get(id) ?? []).map((item) => (item.id === messageId ? { ...item, ...patch } : item));
      chats.set(id, list);
      return list.find((item) => item.id === messageId) ?? null;
    },
    clear: (id: string) => chats.set(id, []),
    flush: () => undefined,
    dispose: () => undefined,
  };

  let runtime: RuntimeData = {
    samples: [sample],
    events: [],
    services: profile.services,
    ports: [],
    processes: [],
    monitoring: true,
    updatedAt: Date.now(),
  };

  const execCalls: string[] = [];
  const ssh = {
    exec: async (_serverId: string, command: string): Promise<ExecResult> => {
      execCalls.push(command);
      if (command.includes('is-active')) {
        return { stdout: 'active\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 3 };
      }
      if (command.startsWith('systemctl') || command.includes('systemctl')) {
        return { stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 5 };
      }
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 2 };
    },
  };

  const providers = {
    list: () => [
      {
        id: 'p_mock',
        name: '演示模型',
        kind: 'mock' as const,
        baseUrl: '',
        model: 'mock',
        hasApiKey: false,
        createdAt: '',
        updatedAt: '',
      },
    ],
    get: () => null,
    apiKey: () => '',
    save: () => ({}) as never,
    remove: () => undefined,
  };

  const settings = {
    get: () => ({
      activeProviderId: 'p_mock',
      theme: 'dark' as const,
      language: 'zh' as const,
      approvalMode: 'strict' as const,
      monitorIntervalSec: 15,
      autoRecon: true,
      autoApproveReadOnly: true,
      syncProfileToServer: false,
      aiAutoSummary: false,
      sampleRetention: 720,
      terminalFontSize: 14,
      auditEnabled: true,
      inputPricePerMTok: 0,
      outputPricePerMTok: 0,
    }),
    save: () => ({} as never),
  };

  const profiles = {
    get: () => profile,
    save: () => profile,
    patch: (_id: string, patch: Partial<ServerProfile>) => ({ ...profile, ...patch }),
    remove: () => undefined,
  };

  const servers = {
    get: () => server,
    list: () => [server],
  };

  const audit = { append: () => ({}) as never, list: () => [] };
  const monitor = {
    sampleOnce: async () => sample,
    refreshStatus: async () => undefined,
    isMonitoring: () => true,
    start: () => undefined,
    stop: () => undefined,
  };

  const agent = new AgentService({
    ssh: ssh as never,
    servers: servers as never,
    profiles: profiles as never,
    runtime: {
      get: () => runtime,
      appendSample: (_id: string, next: typeof sample) => {
        runtime = { ...runtime, samples: [...runtime.samples, next] };
        return runtime;
      },
      appendEvent: () => runtime,
      setSummary: (_id: string, text: string) => {
        runtime = { ...runtime, summary: { text, ts: Date.now() } };
        return runtime;
      },
    } as never,
    chat: chat as never,
    audit: audit as never,
    settings: settings as never,
    providers: providers as never,
    monitor: monitor as never,
  });

  const events: AgentStreamEvent[] = [];
  agent.on('event', (event: AgentStreamEvent) => events.push(event));
  return { agent, events, execCalls, chats };
}

function reachedEnd(events: AgentStreamEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === 'run' && (event.payload.state === 'done' || event.payload.state === 'error'),
  );
}

async function waitFor(predicate: () => boolean, timeout = 12_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('等待超时');
}

describe('AI Agent 工具循环', () => {
  it('只读查询自动执行并生成总结', async () => {
    const { agent, events } = createHarness();
    agent.send('srv1', '检查服务器当前状态');
    await waitFor(() => reachedEnd(events));

    const toolEvents = events.filter((event) => event.type === 'tool').map((event) => event);
    expect(toolEvents.length).toBeGreaterThan(0);
    const calls = events
      .filter((event): event is Extract<AgentStreamEvent, { type: 'tool' }> => event.type === 'tool')
      .map((event) => event.call);
    expect(calls.some((call) => call.name === 'get_overview' && call.status === 'done')).toBe(true);

    const messages = events.filter((event): event is Extract<AgentStreamEvent, { type: 'message' }> => event.type === 'message');
    const assistant = messages.filter((event) => event.message.role === 'assistant');
    expect(assistant.length).toBeGreaterThan(0);
    expect(assistant.at(-1)?.message.content).toContain('服务器');
    expect(agent.history('srv1').length).toBeGreaterThan(1);
  }, 20_000);

  it('变更操作等待审批，批准后执行并验证', async () => {
    const { agent, events, execCalls } = createHarness();
    agent.send('srv1', '重启 nginx 服务');

    await waitFor(() =>
      events.some(
        (event) => event.type === 'tool' && event.call.status === 'awaiting_approval',
      ),
    );
    const pending = events.find(
      (event): event is Extract<AgentStreamEvent, { type: 'tool' }> =>
        event.type === 'tool' && event.call.status === 'awaiting_approval',
    );
    expect(pending?.call.command).toContain('systemctl restart nginx');

    // 审批卡片必须已经随消息到达前端，否则用户无法批准。
    const messageWithCall = events.some(
      (event) =>
        event.type === 'message' &&
        event.message.toolCalls?.some((call) => call.id === pending!.call.id),
    );
    expect(messageWithCall).toBe(true);

    expect(execCalls).toHaveLength(0);
    agent.decide('srv1', { callId: pending!.call.id, approved: true });
    await waitFor(() => reachedEnd(events));

    expect(execCalls.some((command) => command.includes('systemctl restart nginx'))).toBe(true);
    expect(execCalls.some((command) => command.includes('systemctl is-active'))).toBe(true);
    const done = events.filter(
      (event): event is Extract<AgentStreamEvent, { type: 'tool' }> => event.type === 'tool' && event.call.status === 'done',
    );
    expect(done.some((event) => event.call.stdout?.includes('active'))).toBe(true);
  }, 20_000);

  it('拒绝审批时不执行命令', async () => {
    const { agent, events, execCalls } = createHarness();
    agent.send('srv1', '重启 nginx 服务');
    await waitFor(() => events.some((event) => event.type === 'tool' && event.call.status === 'awaiting_approval'));
    const pending = events.find(
      (event): event is Extract<AgentStreamEvent, { type: 'tool' }> =>
        event.type === 'tool' && event.call.status === 'awaiting_approval',
    );
    agent.decide('srv1', { callId: pending!.call.id, approved: false, reason: '现在不要重启' });
    await waitFor(() => reachedEnd(events));
    expect(execCalls.some((command) => command.includes('systemctl restart'))).toBe(false);

    const rejected = events.find(
      (event): event is Extract<AgentStreamEvent, { type: 'tool' }> =>
        event.type === 'tool' && event.call.status === 'rejected',
    );
    expect(rejected).toBeTruthy();
  }, 20_000);
});

describe('上下文裁剪', () => {
  it('只保留最近若干轮并包含工具结果', () => {
    const history: ChatMessage[] = [];
    for (let index = 0; index < 20; index += 1) {
      history.push({ id: `u${index}`, role: 'user', content: `问题 ${index}`, ts: index });
      history.push({
        id: `a${index}`,
        role: 'assistant',
        content: `回答 ${index}`,
        ts: index,
        toolCalls: [
          {
            id: `c${index}`,
            name: 'get_overview',
            args: {},
            status: 'done',
            risk: 'read',
            title: '读取概览',
            stdout: `输出 ${index}`,
            createdAt: index,
          },
        ],
      });
    }
    const messages = toProviderMessages(history, '系统提示');
    const userMessages = messages.filter((message) => message.role === 'user');
    expect(userMessages.length).toBeLessThanOrEqual(12);
    expect(messages.some((message) => message.role === 'tool')).toBe(true);
    expect(messages[0]?.content).toBe('系统提示');
  });
});

// 防止未使用告警
void vi;
