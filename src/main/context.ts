import { join } from 'node:path';
import type { ServerProfile } from '../shared/types';
import { closeDatabase, openDatabase, type SubshellDb } from './store/db';
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
import { CommandHistoryStore } from './store/command-history';
import { ApprovalRuleStore } from './store/approval-store';
import { ApprovalLogStore } from './store/approval-log';
import { SecurityStore } from './store/security-store';
import { McpClientStore } from './store/mcp-clients';
import { ClusterStore } from './store/cluster-store';
import { SshManager } from './ssh/manager';
import { MonitorService } from './monitor/collector';
import { HealthService } from './health/service';
import { SftpService } from './sftp/service';
import { TunnelService } from './tunnel/service';
import { McpServer } from './mcp/server';
import { AgentService } from './ai/agent';
import { DemoServer } from './demo/demo-server';
import { ReconService } from './recon/service';
import { CommandService } from './command/service';
import { SmartApprovalService } from './approval/service';
import { SecurityService } from './security/service';
import { ClusterService } from './cluster/service';
import { classifyCommand } from './ai/risk';
import { createLogger } from './util/logger';

const log = createLogger('context');

/** 应用运行时聚合根：持有全部存储与后台服务。 */
export class AppContext {
  readonly dataDir: string;
  /** 本地 SQLite 数据库（所有结构化数据的唯一存储）。 */
  readonly db: SubshellDb;
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
  readonly commandHistory: CommandHistoryStore;
  readonly approvalRules: ApprovalRuleStore;
  readonly approvalLog: ApprovalLogStore;
  readonly securityStore: SecurityStore;
  readonly mcpClients: McpClientStore;
  readonly clusterStore: ClusterStore;
  readonly ssh: SshManager;
  readonly monitor: MonitorService;
  readonly health: HealthService;
  readonly sftp: SftpService;
  readonly tunnels: TunnelService;
  readonly mcp: McpServer;
  readonly agent: AgentService;
  readonly recon: ReconService;
  readonly commands: CommandService;
  readonly approvals: SmartApprovalService;
  readonly security: SecurityService;
  readonly cluster: ClusterService;
  readonly demo = new DemoServer();
  private connectedOnce = new Set<string>();
  private lastSummaryAt = new Map<string, number>();
  private summaryTimers = new Map<string, NodeJS.Timeout>();
  private securityTimers = new Map<string, NodeJS.Timeout[]>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.db = openDatabase(this.dataDir);
    this.settings = new SettingsStore(this.db);
    this.servers = new ServerStore(this.db);
    // 凭据属于敏感数据，继续单独保存在系统凭据库加密文件中，不进入数据库。
    this.secrets = new SecretStore(join(this.dataDir, 'secrets.json'));
    this.providers = new ProviderStore(this.db, this.secrets);
    this.profiles = new ProfileStore(this.db);
    this.runtime = new RuntimeStore(this.db);
    this.chat = new ChatStore(this.db);
    this.audit = new AuditStore(this.db);
    this.knownHosts = new KnownHostStore(this.db);
    this.healthStates = new HealthStateStore(this.db);
    this.commandHistory = new CommandHistoryStore(this.db);
    this.approvalRules = new ApprovalRuleStore(this.db);
    this.approvalLog = new ApprovalLogStore(this.db);
    this.securityStore = new SecurityStore(this.db);
    this.mcpClients = new McpClientStore(this.db, this.secrets);
    this.clusterStore = new ClusterStore(this.db);
    this.ssh = new SshManager(this.servers, this.secrets, this.knownHosts);
    this.monitor = new MonitorService(this.ssh, this.runtime, this.settings, this.profiles, this.servers);
    this.health = new HealthService({
      profiles: this.profiles,
      runtime: this.runtime,
      states: this.healthStates,
    });
    this.sftp = new SftpService(this.ssh);
    this.tunnels = new TunnelService(this.db, this.ssh);
    this.commands = new CommandService({
      ssh: this.ssh,
      servers: this.servers,
      profiles: this.profiles,
      runtime: this.runtime,
      settings: this.settings,
      providers: this.providers,
      audit: this.audit,
      history: this.commandHistory,
    });
    this.approvals = new SmartApprovalService({
      settings: this.settings,
      providers: this.providers,
      servers: this.servers,
      profiles: this.profiles,
      runtime: this.runtime,
      rules: this.approvalRules,
      log: this.approvalLog,
    });
    this.security = new SecurityService({
      ssh: this.ssh,
      servers: this.servers,
      profiles: this.profiles,
      runtime: this.runtime,
      settings: this.settings,
      providers: this.providers,
      audit: this.audit,
      store: this.securityStore,
      recordCommand: (serverId, input) => this.commands.record(serverId, input),
    });
    this.cluster = new ClusterService({
      ssh: this.ssh,
      servers: this.servers,
      settings: this.settings,
      audit: this.audit,
      store: this.clusterStore,
      recordCommand: (serverId, input) => this.commands.record(serverId, input),
    });
    this.mcp = new McpServer({
      servers: this.servers,
      settings: this.settings,
      secrets: this.secrets,
      clients: this.mcpClients,
      approvals: this.approvals,
      toolContext: (serverId) => ({
        serverId,
        ssh: this.ssh,
        profiles: this.profiles,
        runtime: this.runtime,
        servers: this.servers,
        audit: this.audit,
        settings: this.settings,
        monitor: this.monitor,
        source: 'mcp',
        recordCommand: (target, input) => this.commands.record(target, input),
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
      approvals: this.approvals,
      commands: this.commands,
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
        this.clearSecuritySchedule(info.serverId);
        const timer = this.summaryTimers.get(info.serverId);
        if (timer) clearTimeout(timer);
      }
    });

    // 用户在交互式终端输入的每条命令都进入命令历史，便于事后回顾与回退。
    this.ssh.on('terminalCommand', (serverId: string, command: string) => {
      const risk = classifyCommand(command).level;
      this.commands.record(serverId, { command, source: 'terminal', risk, ok: true });
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
    this.ensureSecuritySchedule(serverId);

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

  /** 连接后首次延迟扫描，并按设置的间隔定期复检。 */
  private ensureSecuritySchedule(serverId: string): void {
    const settings = this.settings.get();
    if (!settings.securityAutoScan || this.securityTimers.has(serverId)) return;
    const intervalMs = Math.max(1, settings.securityScanIntervalHours) * 3_600_000;
    const initial = setTimeout(() => void this.runSecurityScan(serverId, 'connect'), 25_000);
    const periodic = setInterval(() => void this.runSecurityScan(serverId, 'scheduled'), intervalMs);
    initial.unref?.();
    periodic.unref?.();
    this.securityTimers.set(serverId, [initial, periodic]);
  }

  private async runSecurityScan(
    serverId: string,
    trigger: 'connect' | 'scheduled',
  ): Promise<void> {
    if (!this.settings.get().securityAutoScan) return;
    if (!this.ssh.isConnected(serverId)) return;
    try {
      await this.security.scan(serverId, trigger);
    } catch (error) {
      log.warn('定期安全检查失败', error);
    }
  }

  private clearSecuritySchedule(serverId: string): void {
    const timers = this.securityTimers.get(serverId);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    this.securityTimers.delete(serverId);
  }

  /** 设置变更后重建安全扫描定时器（间隔/开关变化时立即生效）。 */
  refreshSecuritySchedules(): void {
    for (const timers of this.securityTimers.values()) {
      for (const timer of timers) clearTimeout(timer);
    }
    this.securityTimers.clear();
    for (const connection of this.ssh.listStates()) {
      if (connection.state === 'connected') this.ensureSecuritySchedule(connection.serverId);
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
    for (const timers of this.securityTimers.values()) {
      for (const timer of timers) clearTimeout(timer);
    }
    this.securityTimers.clear();
    this.tunnels.stopAll();
    this.mcp.stop();
    this.monitor.dispose();
    this.ssh.closeAll();
    this.demo.stop();
    this.runtime.dispose();
    this.chat.dispose();
    closeDatabase(this.dataDir);
  }
}
