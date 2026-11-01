import { join } from 'node:path';
import type { ServerProfile } from '../shared/types';
import { SettingsStore } from './store/settings';
import { ServerStore } from './store/servers';
import { SecretStore } from './store/secrets';
import { ProviderStore } from './store/provider-store';
import { ProfileStore } from './store/profile-store';
import { RuntimeStore } from './store/runtime-store';
import { ChatStore } from './store/chat-store';
import { AuditStore } from './store/audit';
import { KnownHostStore } from './store/known-hosts';
import { HealthStateStore } from './store/health-store';
import { SshManager } from './ssh/manager';
import { MonitorService } from './monitor/collector';
import { HealthService } from './health/service';
import { SftpService } from './sftp/service';
import { TunnelService } from './tunnel/service';
import { McpServer } from './mcp/server';
import { AgentService } from './ai/agent';
import { DemoServer } from './demo/demo-server';
import { ReconService } from './recon/service';
import { createLogger } from './util/logger';

const log = createLogger('context');

/** 应用运行时聚合根：持有全部存储与后台服务。 */
export class AppContext {
  readonly dataDir: string;
  readonly settings: SettingsStore;
  readonly servers: ServerStore;
  readonly secrets: SecretStore;
  readonly providers: ProviderStore;
  readonly profiles: ProfileStore;
  readonly runtime: RuntimeStore;
  readonly chat: ChatStore;
  readonly audit: AuditStore;
  readonly knownHosts: KnownHostStore;
  readonly healthStates: HealthStateStore;
  readonly ssh: SshManager;
  readonly monitor: MonitorService;
  readonly health: HealthService;
  readonly sftp: SftpService;
  readonly tunnels: TunnelService;
  readonly mcp: McpServer;
  readonly agent: AgentService;
  readonly recon: ReconService;
  readonly demo = new DemoServer();
  private connectedOnce = new Set<string>();
  private lastSummaryAt = new Map<string, number>();
  private summaryTimers = new Map<string, NodeJS.Timeout>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.settings = new SettingsStore(this.dataDir);
    this.servers = new ServerStore(this.dataDir);
    this.secrets = new SecretStore(join(this.dataDir, 'secrets.json'));
    this.providers = new ProviderStore(this.dataDir, this.secrets);
    this.profiles = new ProfileStore(this.dataDir);
    this.runtime = new RuntimeStore(this.dataDir);
    this.chat = new ChatStore(this.dataDir);
    this.audit = new AuditStore(this.dataDir);
    this.knownHosts = new KnownHostStore(this.dataDir);
    this.healthStates = new HealthStateStore(this.dataDir);
    this.ssh = new SshManager(this.servers, this.secrets, this.knownHosts);
    this.monitor = new MonitorService(this.ssh, this.runtime, this.settings, this.profiles, this.servers);
    this.health = new HealthService({
      profiles: this.profiles,
      runtime: this.runtime,
      states: this.healthStates,
    });
    this.sftp = new SftpService(this.ssh);
    this.tunnels = new TunnelService(this.dataDir, this.ssh);
    this.mcp = new McpServer({
      servers: this.servers,
      settings: this.settings,
      secrets: this.secrets,
      toolContext: (serverId) => ({
        serverId,
        ssh: this.ssh,
        profiles: this.profiles,
        runtime: this.runtime,
        servers: this.servers,
        audit: this.audit,
        settings: this.settings,
        monitor: this.monitor,
      }),
    });
    this.agent = new AgentService({
      ssh: this.ssh,
      servers: this.servers,
      profiles: this.profiles,
      runtime: this.runtime,
      chat: this.chat,
      audit: this.audit,
      settings: this.settings,
      providers: this.providers,
      monitor: this.monitor,
      health: this.health,
    });
    this.recon = new ReconService({
      ssh: this.ssh,
      servers: this.servers,
      profiles: this.profiles,
      runtime: this.runtime,
      settings: this.settings,
    });
    this.ensureDefaultProvider();
    this.wireAutoFlow();
    void this.mcp.sync().catch((error) => log.warn('MCP 服务器启动失败', error));
  }

  private ensureDefaultProvider(): void {
    if (this.providers.list().length) return;
    this.providers.save({
      name: '演示模型',
      kind: 'mock',
      baseUrl: '',
      model: 'mock',
    });
    const list = this.providers.list();
    if (list[0]) this.settings.save({ activeProviderId: list[0].id });
    log.info('已创建内置演示模型');
  }

  private wireAutoFlow(): void {
    this.ssh.on('status', (info) => {
      if (info.state === 'connected') {
        void this.afterConnected(info.serverId);
      } else if (info.state === 'disconnected' || info.state === 'error') {
        this.monitor.stop(info.serverId);
        const timer = this.summaryTimers.get(info.serverId);
        if (timer) clearTimeout(timer);
      }
    });

    this.monitor.on('events', (serverId: string) => {
      if (!this.settings.get().aiAutoSummary) return;
      const last = this.lastSummaryAt.get(serverId) ?? 0;
      if (Date.now() - last < 10 * 60 * 1000) return;
      this.lastSummaryAt.set(serverId, Date.now());
      void this.agent.summarize(serverId);
    });
  }

  private async afterConnected(serverId: string): Promise<void> {
    const settings = this.settings.get();
    this.monitor.start(serverId);

    if (settings.autoRecon && !this.profiles.get(serverId)) {
      try {
        await this.recon.run(serverId);
      } catch (error) {
        log.warn('自动侦察失败', error);
      }
    }

    if (settings.aiAutoSummary && !this.connectedOnce.has(serverId)) {
      this.connectedOnce.add(serverId);
      const timer = setTimeout(() => {
        this.lastSummaryAt.set(serverId, Date.now());
        void this.agent.summarize(serverId);
      }, 8_000);
      timer.unref?.();
      this.summaryTimers.set(serverId, timer);
    }
  }

  async rescan(serverId: string): Promise<ServerProfile> {
    return this.recon.run(serverId);
  }

  async startDemo(): Promise<{ serverId: string; host: string; port: number }> {
    const info = await this.demo.start();
    let server = this.servers.list().find((item) => item.demo);
    if (!server) {
      server = this.servers.create({
        name: '演示服务器',
        host: info.host,
        port: info.port,
        username: 'ubuntu',
        authType: 'password',
        demo: true,
        description: '内置模拟 Ubuntu 22.04 服务器，用于体验与测试',
        group: '演示',
        tags: ['demo', 'ubuntu'],
      });
    } else if (server.port !== info.port) {
      server = this.servers.update(server.id, {
        host: info.host,
        port: info.port,
        username: server.username,
        authType: server.authType,
      });
    }
    this.secrets.set(server.id, { password: 'demo' });
    await this.ssh.connect(server.id);
    return { serverId: server.id, host: info.host, port: info.port };
  }

  stopDemo(): void {
    const demo = this.servers.list().find((item) => item.demo);
    if (demo) this.ssh.disconnect(demo.id);
    this.demo.stop();
  }

  demoStatus(): { running: boolean; host?: string; port?: number } {
    const info = this.demo.info;
    return info ? { running: true, host: info.host, port: info.port } : { running: false };
  }

  dispose(): void {
    for (const timer of this.summaryTimers.values()) clearTimeout(timer);
    this.summaryTimers.clear();
    this.tunnels.stopAll();
    this.mcp.stop();
    this.monitor.dispose();
    this.ssh.closeAll();
    this.demo.stop();
    this.runtime.dispose();
    this.chat.dispose();
  }
}
