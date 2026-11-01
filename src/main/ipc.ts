import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { writeFileSync } from 'node:fs';
import type { AppContext } from './context';
import type { ServerInput, TestResult } from '../shared/api';
import type { ApprovalDecision, IssueStatus, ProviderConfig, ProviderInput, ServerConfig } from '../shared/types';
import { testConnection } from './ssh/tester';
import { createProvider } from './ai/providers';
import { profileToMarkdown } from './recon/service';
import { checkForUpdates, openDownloadPage, type UpdateInfo } from './update/service';
import { createLogger } from './util/logger';

const log = createLogger('ipc');

function splitSecret(input: ServerInput): {
  config: Omit<ServerInput, 'password' | 'passphrase' | 'privateKey'>;
  secret: { password?: string; passphrase?: string; privateKey?: string } | null;
} {
  const { password, passphrase, privateKey, ...config } = input;
  const secret =
    password !== undefined || passphrase !== undefined || privateKey !== undefined
      ? { password, passphrase, privateKey }
      : null;
  return { config, secret };
}

function tempServerConfig(input: ServerInput): ServerConfig {
  return {
    id: input.id ?? 'test',
    name: input.name ?? input.host,
    host: input.host,
    port: input.port ?? 22,
    username: input.username,
    authType: input.authType,
    privateKeyPath: input.privateKeyPath,
    description: input.description,
    group: input.group ?? '默认分组',
    tags: input.tags ?? [],
    createdAt: '',
    updatedAt: '',
  };
}

/** 注册全部 IPC 命令。所有命令只做参数适配与调用，业务逻辑在各自服务中。 */
export function registerIpc(context: AppContext): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    platform: process.platform,
    dataDir: context.dataDir,
  }));

  ipcMain.handle('settings:get', () => context.settings.get());
  ipcMain.handle('settings:save', (_event, patch) => {
    const settings = context.settings.save(patch);
    // MCP 的启停与端口都来自设置，保存后立即同步运行状态。
    void context.mcp.sync().catch((error) => log.warn('MCP 重新加载失败', error));
    // 主题切换时同步窗口按钮区域配色，避免明亮主题下右上角残留深色块。
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      const light = settings.theme === 'light';
      window.setTitleBarOverlay({
        color: light ? '#f4f7fb' : '#11161e',
        symbolColor: light ? '#475569' : '#94a3b8',
        height: 44,
      });
    }
    return settings;
  });

  ipcMain.handle('servers:list', () => context.servers.list());
  ipcMain.handle('servers:create', (_event, input: ServerInput) => {
    const { config, secret } = splitSecret(input);
    const server = context.servers.create(config);
    if (secret) context.secrets.set(server.id, secret);
    return server;
  });
  ipcMain.handle('servers:update', (_event, id: string, input: ServerInput) => {
    const { config, secret } = splitSecret(input);
    const server = context.servers.update(id, config);
    if (secret) {
      const existing = context.secrets.get(id) ?? {};
      context.secrets.set(id, { ...existing, ...secret });
    }
    return server;
  });
  ipcMain.handle('servers:remove', (_event, id: string) => {
    context.ssh.disconnect(id);
    context.servers.remove(id);
    context.secrets.delete(id);
    context.profiles.remove(id);
    context.health.remove(id);
    context.tunnels.removeServer(id);
    context.chat.clear(id);
  });
  ipcMain.handle('servers:test', async (_event, input: ServerInput): Promise<TestResult> => {
    const { config, secret } = splitSecret(input);
    return testConnection(tempServerConfig(config), secret);
  });

  ipcMain.handle('connection:connect', async (_event, serverId: string) => context.ssh.connect(serverId));
  ipcMain.handle('connection:disconnect', (_event, serverId: string) => {
    context.ssh.disconnect(serverId);
  });
  ipcMain.handle('connection:list', () => context.ssh.listStates());
  ipcMain.handle('connection:resetHostKey', (_event, serverId: string) => {
    const server = context.servers.get(serverId);
    if (server) context.knownHosts.forget(`${server.host}:${server.port}`);
  });

  ipcMain.handle('terminal:open', (_event, serverId: string, cols: number, rows: number) =>
    context.ssh.openTerminal(serverId, cols, rows),
  );
  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) =>
    context.ssh.writeTerminal(sessionId, data),
  );
  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) =>
    context.ssh.resizeTerminal(sessionId, cols, rows),
  );
  ipcMain.handle('terminal:close', (_event, sessionId: string) => context.ssh.closeTerminal(sessionId));

  ipcMain.handle('sftp:home', (_event, serverId: string) => context.sftp.home(serverId));
  ipcMain.handle('sftp:list', (_event, serverId: string, path: string) => context.sftp.list(serverId, path));
  ipcMain.handle('sftp:preview', (_event, serverId: string, path: string) => context.sftp.preview(serverId, path));
  ipcMain.handle('sftp:download', (_event, serverId: string, path: string) => context.sftp.download(serverId, path));
  ipcMain.handle('sftp:upload', (_event, serverId: string, dir: string) => context.sftp.upload(serverId, dir));
  ipcMain.handle('sftp:mkdir', (_event, serverId: string, path: string) => context.sftp.mkdir(serverId, path));
  ipcMain.handle('sftp:rename', (_event, serverId: string, from: string, to: string) =>
    context.sftp.rename(serverId, from, to),
  );
  ipcMain.handle('sftp:remove', (_event, serverId: string, path: string, isDir: boolean) =>
    context.sftp.remove(serverId, path, isDir),
  );

  ipcMain.handle('tunnel:list', (_event, serverId: string) => context.tunnels.list(serverId));
  ipcMain.handle('tunnel:save', (_event, serverId: string, input) => context.tunnels.save(serverId, input));
  ipcMain.handle('tunnel:start', (_event, id: string) => context.tunnels.start(id));
  ipcMain.handle('tunnel:stop', (_event, id: string) => context.tunnels.stop(id));
  ipcMain.handle('tunnel:remove', (_event, serverId: string, id: string) => context.tunnels.remove(serverId, id));

  ipcMain.handle('exec', (_event, serverId: string, command: string, options) =>
    context.ssh.exec(serverId, command, options),
  );

  ipcMain.handle('monitor:snapshot', (_event, serverId: string) => {
    const data = context.runtime.get(serverId);
    return {
      serverId,
      connection: context.ssh.getState(serverId),
      profile: context.profiles.get(serverId),
      samples: data.samples,
      events: data.events,
      services: data.services,
      ports: data.ports,
      processes: data.processes,
      summary: data.summary,
      monitoring: context.monitor.isMonitoring(serverId),
    };
  });
  ipcMain.handle('monitor:start', (_event, serverId: string) => context.monitor.start(serverId));
  ipcMain.handle('monitor:stop', (_event, serverId: string) => context.monitor.stop(serverId));
  ipcMain.handle('monitor:acknowledge', (_event, serverId: string, eventId: string) =>
    context.runtime.acknowledgeEvent(serverId, eventId),
  );

  ipcMain.handle('profile:get', (_event, serverId: string) => context.profiles.get(serverId));
  ipcMain.handle('profile:rescan', (_event, serverId: string) => context.rescan(serverId));
  ipcMain.handle('profile:save', (_event, serverId: string, patch) => context.profiles.patch(serverId, patch));
  ipcMain.handle('profile:summarize', (_event, serverId: string) => context.agent.summarize(serverId));
  ipcMain.handle('profile:sync', async (_event, serverId: string) => {
    const profile = context.profiles.get(serverId);
    if (!profile) return { ok: false, error: '服务器档案不存在' };
    try {
      const path = await context.recon.syncToServer(serverId, profile);
      return { ok: true, path };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('profile:export', async (_event, serverId: string) => {
    const profile = context.profiles.get(serverId);
    if (!profile) return { ok: false, error: '服务器档案不存在' };
    const result = await dialog.showSaveDialog({
      title: '导出服务器档案',
      defaultPath: `${profile.hostname || 'server'}-profile.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      writeFileSync(result.filePath, profileToMarkdown(profile), 'utf8');
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ai:providers', () => context.providers.list());
  ipcMain.handle('ai:saveProvider', (_event, input: ProviderInput) => {
    const saved = context.providers.save(input);
    const settings = context.settings.get();
    if (!settings.activeProviderId) context.settings.save({ activeProviderId: saved.id });
    return saved;
  });
  ipcMain.handle('ai:removeProvider', (_event, id: string) => {
    context.providers.remove(id);
    if (context.settings.get().activeProviderId === id) {
      const next = context.providers.list()[0];
      context.settings.save({ activeProviderId: next?.id ?? null });
    }
  });
  ipcMain.handle('ai:testProvider', async (_event, input: ProviderInput): Promise<TestResult> => {
    const saved = input.id ? context.providers.get(input.id) : null;
    const config: ProviderConfig = {
      id: input.id ?? 'test',
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      model: input.model,
      hasApiKey: Boolean(input.apiKey || saved?.hasApiKey),
      headers: input.headers ?? saved?.headers,
      createdAt: '',
      updatedAt: '',
    };
    const apiKey = input.apiKey ?? (input.id ? context.providers.apiKey(input.id) : '');
    const provider = createProvider(config, apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const started = Date.now();
    try {
      const result = await provider.chat({
        messages: [{ role: 'user', content: '请只回复：ok' }],
        tools: [],
        signal: controller.signal,
      });
      return { ok: true, latencyMs: Date.now() - started, message: result.text.slice(0, 120) };
    } catch (error) {
      log.warn('模型连通性测试失败', error);
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  });
  ipcMain.handle('ai:send', (_event, serverId: string, text: string, issueId?: string) =>
    context.agent.send(serverId, text, issueId),
  );
  ipcMain.handle('ai:cancel', (_event, serverId: string) => context.agent.cancel(serverId));
  ipcMain.handle('ai:decide', (_event, serverId: string, decision: ApprovalDecision) =>
    context.agent.decide(serverId, decision),
  );
  ipcMain.handle('ai:history', (_event, serverId: string) => context.agent.history(serverId));
  ipcMain.handle('ai:clear', (_event, serverId: string) => context.agent.clear(serverId));
  ipcMain.handle('ai:status', (_event, serverId: string) => context.agent.status(serverId));
  ipcMain.handle('ai:analyzeCommand', (_event, serverId: string, command: string) =>
    context.agent.analyzeCommand(serverId, command),
  );

  ipcMain.handle('audit:list', (_event, serverId?: string, limit?: number) =>
    context.audit.list(serverId, limit ?? 200),
  );

  ipcMain.handle('health:report', (_event, serverId: string) => context.health.report(serverId));
  ipcMain.handle('health:resolve', (_event, serverId: string, issueId: string, status: IssueStatus) =>
    context.health.setStatus(serverId, issueId, status),
  );
  ipcMain.handle('health:tickets', (_event, serverId: string) => context.health.tickets(serverId));

  ipcMain.handle('mcp:info', () => context.mcp.info());

  ipcMain.handle('update:check', (): Promise<UpdateInfo> => checkForUpdates());
  ipcMain.handle('update:open', (_event, url: string) => openDownloadPage(url));

  ipcMain.handle('usage:summary', () => {
    const servers = context.servers.list();
    let totalInput = 0;
    let totalOutput = 0;
    const rows = servers
      .map((server) => {
        let input = 0;
        let output = 0;
        let messages = 0;
        for (const message of context.chat.list(server.id)) {
          if (!message.usage) continue;
          input += message.usage.inputTokens ?? 0;
          output += message.usage.outputTokens ?? 0;
          messages += 1;
        }
        totalInput += input;
        totalOutput += output;
        return { serverId: server.id, name: server.name, input, output, messages };
      })
      .sort((a, b) => b.input + b.output - (a.input + a.output));
    return { total: { input: totalInput, output: totalOutput }, servers: rows };
  });

  ipcMain.handle('demo:start', () => context.startDemo());
  ipcMain.handle('demo:stop', () => context.stopDemo());
  ipcMain.handle('demo:status', () => context.demoStatus());

  ipcMain.handle('profile:markdown', (_event, serverId: string) => {
    const profile = context.profiles.get(serverId);
    return profile ? profileToMarkdown(profile) : null;
  });
}
