import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '../src/main/mcp/server';
import type { AppSettings, ServerConfig } from '../src/shared/types';

const server: ServerConfig = {
  id: 'srv1',
  name: 'demo',
  host: '127.0.0.1',
  port: 22,
  username: 'ubuntu',
  authType: 'password',
  tags: [],
  createdAt: '',
  updatedAt: '',
};

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    activeProviderId: null,
    theme: 'light',
    language: 'zh',
    approvalMode: 'smart',
    monitorIntervalSec: 15,
    autoRecon: false,
    autoApproveReadOnly: true,
    syncProfileToServer: false,
    aiAutoSummary: false,
    sampleRetention: 720,
    terminalFontSize: 14,
    auditEnabled: true,
    mcpEnabled: true,
    mcpPort: 0,
    mcpAllowMutations: false,
    autoCheckUpdate: false,
    inputPricePerMTok: 0,
    outputPricePerMTok: 0,
    ...overrides,
  };
}

describe('MCP 服务器', () => {
  let mcp: McpServer;
  let current: AppSettings;
  let secretToken = '';

  beforeEach(async () => {
    current = settings();
    const secrets = new Map<string, { password: string }>();
    mcp = new McpServer({
      servers: {
        list: () => [server],
        get: (id: string) => (id === server.id ? server : null),
      } as never,
      settings: { get: () => current } as never,
      secrets: {
        get: (key: string) => secrets.get(key) ?? null,
        set: (key: string, value: { password: string }) => {
          secrets.set(key, value);
        },
        has: (key: string) => secrets.has(key),
        delete: (key: string) => secrets.delete(key),
      } as never,
      toolContext: () => ({}) as never,
    });
    await mcp.start();
    secretToken = mcp.token();
  });

  afterEach(() => {
    mcp.stop();
  });

  async function rpc(body: unknown, token: string | null = secretToken): Promise<Response> {
    return fetch(`http://127.0.0.1:${mcp.info().port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('缺少 Token 时拒绝请求', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null);
    expect(response.status).toBe(401);
  });

  it('initialize 返回协议版本与服务信息', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const payload = (await response.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(payload.result.protocolVersion).toBeTruthy();
    expect(payload.result.serverInfo.name).toBe('subshell');
  });

  it('默认只暴露只读工具', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const payload = (await response.json()) as { result: { tools: { name: string }[] } };
    const names = payload.result.tools.map((tool) => tool.name);
    expect(names).toContain('get_overview');
    expect(names).toContain('read_logs');
    expect(names).not.toContain('run_command');
    expect(names).not.toContain('service_action');
  });

  it('开启变更后暴露 service_action 与 run_command', async () => {
    current = settings({ mcpAllowMutations: true });
    const response = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const payload = (await response.json()) as { result: { tools: { name: string }[] } };
    const names = payload.result.tools.map((tool) => tool.name);
    expect(names).toContain('service_action');
    expect(names).toContain('run_command');
  });

  it('每个工具都要求显式指定 server 参数', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    const payload = (await response.json()) as {
      result: { tools: { name: string; inputSchema: { required: string[] } }[] };
    };
    for (const tool of payload.result.tools) {
      expect(tool.inputSchema.required).toContain('server');
    }
  });

  it('未知服务器返回参数错误', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'get_overview', arguments: { server: 'nope' } },
    });
    const payload = (await response.json()) as { error?: { code: number } };
    expect(payload.error?.code).toBe(-32602);
  });

  it('未知方法返回 -32601', async () => {
    const response = await rpc({ jsonrpc: '2.0', id: 6, method: 'unknown/method' });
    const payload = (await response.json()) as { error?: { code: number } };
    expect(payload.error?.code).toBe(-32601);
  });
});
