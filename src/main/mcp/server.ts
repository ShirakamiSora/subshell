import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { McpClient, McpScope, McpStatus, ServerConfig } from '../../shared/types';
import type { SettingsStore } from '../store/settings';
import type { SecretStore } from '../store/secrets';
import type { ServerStore } from '../store/servers';
import type { McpClientStore } from '../store/mcp-clients';
import type { SmartApprovalService } from '../approval/service';
import { TOOL_DEFINITIONS, executeTool, prepareToolCall, type ToolContext } from '../ai/tools';
import { createLogger } from '../util/logger';

const log = createLogger('mcp');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_VERSION = '0.3.8';
const MAX_BODY_BYTES = 1024 * 1024;

/** 通过 MCP 暴露的工具：默认只读；变更类工具还需要 scope 与全局开关。 */
const READ_ONLY_TOOLS = new Set([
  'get_overview',
  'list_services',
  'list_ports',
  'list_processes',
  'inspect_service',
  'read_logs',
  'read_file',
  'list_files',
]);
const MUTATION_TOOLS = new Set(['service_action', 'run_command']);

const TOKEN_SECRET_KEY = 'mcp:token';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface AuthContext {
  kind: 'legacy' | 'client';
  client?: McpClient;
  scopes: Set<McpScope>;
}

export interface McpDeps {
  servers: ServerStore;
  settings: SettingsStore;
  secrets: SecretStore;
  toolContext: (serverId: string) => ToolContext;
  /** v0.3.4：多客户端与权限；缺省时退化为单一 Token 的只读模式。 */
  clients?: McpClientStore;
  /** 变更类调用在没有交互审批时，交给智能审批做自动判定。 */
  approvals?: SmartApprovalService;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 内置 MCP 服务器（JSON-RPC over HTTP，仅回环地址）。
 *
 * 设计取舍：
 * - 只监听 127.0.0.1，并要求 Bearer Token，避免局域网内其他程序直接接管服务器；
 * - 每个客户端独立 Token、作用域（read/exec/admin）与服务器白名单；
 * - 默认只读；变更类工具必须同时满足全局开关与客户端 scope；
 * - 需要审批的命令交给智能审批判定，无法判定时直接拒绝，绝不绕过本地风险分级；
 * - 所有调用记录在 MCP 调用日志中。
 */
export class McpServer {
  private server: Server | null = null;
  private port = 0;

  constructor(private readonly deps: McpDeps) {}

  private ensureToken(): string {
    const existing = this.deps.secrets.get(TOKEN_SECRET_KEY)?.password;
    if (existing) return existing;
    const token = randomBytes(24).toString('base64url');
    this.deps.secrets.set(TOKEN_SECRET_KEY, { password: token });
    return token;
  }

  token(): string {
    return this.ensureToken();
  }

  info(): McpStatus {
    const settings = this.deps.settings.get();
    return {
      running: Boolean(this.server),
      port: this.port || settings.mcpPort,
      token: this.ensureToken(),
      mutationEnabled: settings.mcpAllowMutations,
      endpoint: `http://127.0.0.1:${this.port || settings.mcpPort}/mcp`,
      clients: this.deps.clients?.list() ?? [],
    };
  }

  private endpoint(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  async sync(): Promise<void> {
    const settings = this.deps.settings.get();
    if (settings.mcpEnabled && !this.server) await this.start();
    else if (!settings.mcpEnabled && this.server) this.stop();
    else if (this.server && this.port !== settings.mcpPort) {
      this.stop();
      await this.start();
    }
  }

  async start(): Promise<void> {
    if (this.server) return;
    const settings = this.deps.settings.get();
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });

    let actualPort = settings.mcpPort;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(settings.mcpPort, '127.0.0.1', () => {
        server.removeListener('error', onError);
        const address = server.address();
        if (typeof address === 'object' && address) actualPort = address.port;
        resolve();
      });
    }).catch((error: unknown) => {
      const message =
        (error as { code?: string }).code === 'EADDRINUSE'
          ? `MCP 端口 ${settings.mcpPort} 已被占用，请在设置里换一个端口`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new Error(message);
    });

    this.server = server;
    this.port = actualPort;
    log.info(`MCP 服务器已启动 ${this.endpoint()}`);
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    log.info('MCP 服务器已停止');
  }

  private authorize(token: string): AuthContext | null {
    if (!token) return null;
    const settings = this.deps.settings.get();
    if (token === this.ensureToken()) {
      // 兼容旧客户端：默认 Token 拥有只读权限，开启变更开关后额外获得 exec。
      const scopes = new Set<McpScope>(['read']);
      if (settings.mcpAllowMutations) scopes.add('exec');
      return { kind: 'legacy', scopes };
    }
    const client = this.deps.clients?.identify(token) ?? null;
    if (!client) return null;
    return { kind: 'client', client, scopes: new Set(client.scopes) };
  }

  private hasScope(auth: AuthContext, scope: McpScope): boolean {
    return auth.scopes.has(scope) || auth.scopes.has('admin');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/mcp') {
      json(res, 404, { error: 'not found' });
      return;
    }
    if (req.method === 'GET') {
      // 便于用户/客户端探活
      json(res, 200, { server: 'subshell', protocolVersion: PROTOCOL_VERSION });
      return;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' });
      return;
    }

    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const auth = this.authorize(token);
    if (!auth) {
      json(res, 401, rpcError(null, -32001, '未授权：请在请求头带上 Authorization: Bearer <token>'));
      return;
    }

    let payload: JsonRpcRequest;
    try {
      payload = JSON.parse(await readBody(req)) as JsonRpcRequest;
    } catch (error) {
      json(res, 400, rpcError(null, -32700, error instanceof Error ? error.message : '解析请求失败'));
      return;
    }

    const result = await this.dispatch(payload, auth);
    if (result === undefined) {
      // 通知类消息没有响应体
      res.writeHead(202);
      res.end();
      return;
    }
    json(res, 200, result);
  }

  private async dispatch(request: JsonRpcRequest, auth: AuthContext): Promise<unknown> {
    const id = request.id ?? null;
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'subshell', version: SERVER_VERSION },
          },
        };
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: this.listTools(auth) } };
      case 'tools/call':
        return this.callTool(request, auth);
      default:
        return rpcError(id, -32601, `不支持的方法：${request.method ?? '(空)'}`);
    }
  }

  private visibleServers(auth: AuthContext): ServerConfig[] {
    const all = this.deps.servers.list();
    const allow = auth.client?.servers ?? [];
    return allow.length ? all.filter((server) => allow.includes(server.id)) : all;
  }

  private listTools(auth: AuthContext): unknown[] {
    const settings = this.deps.settings.get();
    const tools: unknown[] = [];
    for (const tool of TOOL_DEFINITIONS) {
      if (READ_ONLY_TOOLS.has(tool.name)) {
        if (this.hasScope(auth, 'read')) tools.push(this.decorate(tool, auth));
      } else if (MUTATION_TOOLS.has(tool.name) && settings.mcpAllowMutations && this.hasScope(auth, 'exec')) {
        tools.push(this.decorate(tool, auth));
      }
    }
    return tools;
  }

  /** 每个 MCP 工具都要求显式指定目标服务器，防止外部 agent 误操作到别的机器。 */
  private decorate(tool: (typeof TOOL_DEFINITIONS)[number], auth: AuthContext): unknown {
    const parameters = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
    const visible = this.visibleServers(auth);
    return {
      name: tool.name,
      description:
        tool.name === 'run_command'
          ? `${tool.description}\n注意：通过 MCP 调用时，无法自动判定的命令会被拒绝，请优先使用只读工具。`
          : tool.description,
      inputSchema: {
        type: 'object',
        properties: {
          server: {
            type: 'string',
            description: `目标服务器名称或 ID。可用：${visible.map((item) => item.name).join('、') || '（无）'}`,
          },
          ...(parameters.properties ?? {}),
        },
        required: ['server', ...(parameters.required ?? [])],
        additionalProperties: false,
      },
    };
  }

  private resolveServer(value: unknown, auth: AuthContext): ServerConfig | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const key = value.trim().toLowerCase();
    const list = this.visibleServers(auth);
    return (
      list.find((server) => server.id === value) ??
      list.find((server) => server.name.toLowerCase() === key) ??
      list.find((server) => `${server.username}@${server.host}`.toLowerCase() === key) ??
      null
    );
  }

  private async callTool(request: JsonRpcRequest, auth: AuthContext): Promise<unknown> {
    const id = request.id ?? null;
    const name = String(request.params?.name ?? '');
    const rawArgs = (request.params?.arguments ?? {}) as Record<string, unknown>;

    if (!READ_ONLY_TOOLS.has(name) && !MUTATION_TOOLS.has(name)) {
      return rpcError(id, -32602, `工具不可用：${name}`);
    }
    const requiredScope: McpScope = MUTATION_TOOLS.has(name) ? 'exec' : 'read';
    if (!this.hasScope(auth, requiredScope)) {
      return rpcError(id, -32003, `权限不足：该客户端没有 ${requiredScope} 权限`);
    }
    const settings = this.deps.settings.get();
    if (MUTATION_TOOLS.has(name) && !settings.mcpAllowMutations) {
      return rpcError(id, -32602, '变更类工具未启用：请在 Subshell 设置 → MCP 中开启「允许变更操作」');
    }

    const server = this.resolveServer(rawArgs.server, auth);
    if (!server) {
      return rpcError(id, -32602, `未知服务器：${String(rawArgs.server ?? '')}。请在参数中传入 server。`);
    }

    const args: Record<string, unknown> = { ...rawArgs };
    delete args.server;

    const context = this.deps.toolContext(server.id);
    const prepared = prepareToolCall(name, args, context);

    if (prepared.blocked) {
      return this.resultError(id, `本地安全策略拒绝：${prepared.blocked}`, auth, name, server.id);
    }

    // 没有交互审批：交给智能审批判定；无法判定则拒绝。
    if (prepared.needsApproval) {
      if (!this.deps.approvals) {
        return this.resultError(
          id,
          '这条命令需要用户审批，MCP 通道没有审批界面，已拒绝执行。请改用只读工具，或让用户在本应用中批准。',
          auth,
          name,
          server.id,
        );
      }
      const verdict = await this.deps.approvals.decide({
        serverId: server.id,
        command: prepared.command ?? '',
        risk: prepared.risk,
        kind: prepared.kind,
        purpose: typeof args.purpose === 'string' ? args.purpose : undefined,
        title: prepared.title,
      });
      if (verdict.decision !== 'approve') {
        return this.resultError(
          id,
          `智能审批未通过（${verdict.reason}）。请让用户在本应用中手动批准，或改用只读工具。`,
          auth,
          name,
          server.id,
        );
      }
    }

    const result = await executeTool(prepared, context);
    this.record(auth, name, server.id, result.ok, result.ok ? result.output : (result.error ?? ''));
    const text = result.ok
      ? result.output || '（无输出）'
      : `执行失败：${result.error ?? result.output ?? '未知错误'}`;
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text }], isError: !result.ok },
    };
  }

  private resultError(
    id: JsonRpcRequest['id'],
    message: string,
    auth: AuthContext,
    tool: string,
    serverId: string,
  ): unknown {
    this.record(auth, tool, serverId, false, message);
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: message }], isError: true },
    };
  }

  private record(
    auth: AuthContext,
    tool: string,
    serverId: string,
    ok: boolean,
    detail: string,
  ): void {
    if (!this.deps.clients) return;
    try {
      this.deps.clients.recordCall({
        clientId: auth.client?.id ?? 'legacy',
        tool,
        serverId,
        ok,
        detail,
      });
    } catch (error) {
      log.warn('记录 MCP 调用失败', error);
    }
  }
}
