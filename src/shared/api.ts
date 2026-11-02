import type {
  AgentRunStatus,
  AgentStreamEvent,
  AgentToolCall,
  AppInfo,
  AppSettings,
  ApprovalDecision,
  ApprovalRecord,
  ApprovalRule,
  ApprovalRuleInput,
  ApprovalVerdict,
  AuditEntry,
  ChatMessage,
  ClusterPrecheckResult,
  ClusterRun,
  ClusterRunInput,
  CommandHistoryEntry,
  CommandHistoryQuery,
  ConnectionInfo,
  DemoStatus,
  ExecOptions,
  ExecResult,
  HealthReport,
  IssueStatus,
  McpCallRecord,
  McpClient,
  McpClientInput,
  McpClientsResult,
  McpStatus,
  MetricSample,
  MonitorEvent,
  PortInfo,
  ProcessInfo,
  ProviderConfig,
  ProviderInput,
  RealtimePayload,
  RemoteEntry,
  SecurityFindingStatus,
  SecurityRemediation,
  SecurityRemediationResult,
  SecurityReport,
  ServerConfig,
  ServerProfile,
  ServerRuntime,
  ServiceInfo,
  TicketRecord,
  TunnelStatus,
} from './types';

export interface ServerInput {
  id?: string;
  name?: string;
  host: string;
  port?: number;
  username: string;
  authType: 'password' | 'key';
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  privateKey?: string;
  description?: string;
  group?: string;
  tags?: string[];
}

export interface TestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  message?: string;
}

export interface EventMap {
  'connection:update': ConnectionInfo;
  'terminal:data': { sessionId: string; data: string };
  'terminal:exit': { sessionId: string };
  'monitor:sample': { serverId: string; sample: MetricSample };
  'monitor:events': { serverId: string; events: MonitorEvent[] };
  'monitor:status': {
    serverId: string;
    services?: ServiceInfo[];
    ports?: PortInfo[];
    processes?: ProcessInfo[];
  };
  'profile:update': ServerProfile;
  'agent:event': AgentStreamEvent;
  'health:update': HealthReport;
  'servers:update': ServerConfig[];
  'app:notice': { level: 'info' | 'warning' | 'error'; message: string };
  'command:update': { serverId: string; entry: CommandHistoryEntry };
  'security:update': SecurityReport;
  'cluster:update': ClusterRun;
}

export type EventChannel = keyof EventMap;

/** preload 暴露给渲染进程的完整 API。 */
export interface SubshellApi {
  app: {
    info(): Promise<AppInfo>;
  };
  settings: {
    get(): Promise<AppSettings>;
    save(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  servers: {
    list(): Promise<ServerConfig[]>;
    create(input: ServerInput): Promise<ServerConfig>;
    update(id: string, input: ServerInput): Promise<ServerConfig>;
    remove(id: string): Promise<void>;
    test(input: ServerInput): Promise<TestResult>;
  };
  connection: {
    connect(serverId: string): Promise<ConnectionInfo>;
    disconnect(serverId: string): Promise<void>;
    list(): Promise<ConnectionInfo[]>;
    resetHostKey(serverId: string): Promise<void>;
  };
  terminal: {
    open(serverId: string, cols: number, rows: number): Promise<string>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    close(sessionId: string): Promise<void>;
  };
  exec(serverId: string, command: string, options?: ExecOptions): Promise<ExecResult>;
  monitor: {
    snapshot(serverId: string): Promise<ServerRuntime>;
    start(serverId: string): Promise<void>;
    stop(serverId: string): Promise<void>;
    acknowledge(serverId: string, eventId: string): Promise<void>;
  };
  profile: {
    get(serverId: string): Promise<ServerProfile | null>;
    rescan(serverId: string): Promise<ServerProfile>;
    save(serverId: string, patch: Partial<ServerProfile>): Promise<ServerProfile>;
    summarize(serverId: string): Promise<string | null>;
    sync(serverId: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    export(serverId: string): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
    markdown(serverId: string): Promise<string | null>;
  };
  ai: {
    providers(): Promise<ProviderConfig[]>;
    saveProvider(input: ProviderInput): Promise<ProviderConfig>;
    removeProvider(id: string): Promise<void>;
    testProvider(input: ProviderInput): Promise<TestResult>;
    send(serverId: string, text: string, issueId?: string): Promise<{ messageId: string }>;
    cancel(serverId: string): Promise<void>;
    decide(serverId: string, decision: ApprovalDecision): Promise<void>;
    history(serverId: string): Promise<ChatMessage[]>;
    clear(serverId: string): Promise<void>;
    status(serverId: string): Promise<AgentRunStatus>;
    analyzeCommand(serverId: string, command: string): Promise<import('./types').CommandAnalysis>;
  };
  audit: {
    list(serverId?: string, limit?: number): Promise<AuditEntry[]>;
  };
  health: {
    report(serverId: string): Promise<HealthReport>;
    resolve(serverId: string, issueId: string, status: IssueStatus): Promise<HealthReport>;
    tickets(serverId: string): Promise<TicketRecord[]>;
  };
  mcp: {
    info(): Promise<McpStatus>;
    clients(): Promise<McpClient[]>;
    saveClient(input: McpClientInput): Promise<McpClientsResult>;
    toggleClient(id: string, enabled: boolean): Promise<McpClient[]>;
    rotateClient(id: string): Promise<McpClientsResult>;
    removeClient(id: string): Promise<McpClient[]>;
    calls(limit?: number): Promise<McpCallRecord[]>;
  };
  commands: {
    list(serverId: string, query?: CommandHistoryQuery): Promise<CommandHistoryEntry[]>;
    get(serverId: string, id: string): Promise<CommandHistoryEntry | null>;
    analyze(serverId: string, id: string): Promise<CommandHistoryEntry>;
    planRollback(serverId: string, id: string, note?: string): Promise<CommandHistoryEntry>;
    applyRollback(serverId: string, id: string, approved: boolean): Promise<CommandHistoryEntry>;
    remove(serverId: string, id: string): Promise<void>;
    clear(serverId: string): Promise<void>;
  };
  approval: {
    rules(): Promise<ApprovalRule[]>;
    saveRule(input: ApprovalRuleInput): Promise<ApprovalRule[]>;
    toggleRule(id: string, enabled: boolean): Promise<ApprovalRule[]>;
    deleteRule(id: string): Promise<ApprovalRule[]>;
    resetRules(): Promise<ApprovalRule[]>;
    records(serverId?: string, limit?: number): Promise<ApprovalRecord[]>;
    test(serverId: string, command: string): Promise<ApprovalVerdict>;
  };
  security: {
    report(serverId: string): Promise<SecurityReport>;
    scan(serverId: string): Promise<SecurityReport>;
    resolve(serverId: string, findingId: string, status: SecurityFindingStatus): Promise<SecurityReport>;
    remediate(serverId: string, findingId: string): Promise<SecurityRemediation>;
    apply(serverId: string, findingId: string, approved: boolean): Promise<SecurityRemediationResult>;
  };
  cluster: {
    precheck(serverIds: string[], command?: string): Promise<ClusterPrecheckResult[]>;
    run(input: ClusterRunInput): Promise<ClusterRun>;
    cancel(runId: string): Promise<void>;
    history(limit?: number): Promise<ClusterRun[]>;
  };
  update: {
    check(): Promise<{
      current: string;
      latest: string;
      hasUpdate: boolean;
      url: string;
      notes?: string;
      checkedAt: number;
      error?: string;
    }>;
    open(url: string): Promise<void>;
  };
  sftp: {
    home(serverId: string): Promise<string>;
    list(serverId: string, path: string): Promise<RemoteEntry[]>;
    preview(serverId: string, path: string): Promise<{ ok: boolean; content?: string; binary?: boolean; error?: string }>;
    download(serverId: string, path: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
    upload(serverId: string, dir: string): Promise<{ ok: boolean; files?: string[]; canceled?: boolean; error?: string }>;
    mkdir(serverId: string, path: string): Promise<void>;
    rename(serverId: string, from: string, to: string): Promise<void>;
    remove(serverId: string, path: string, isDir: boolean): Promise<void>;
  };
  tunnels: {
    list(serverId: string): Promise<TunnelStatus[]>;
    save(
      serverId: string,
      input: { id?: string; label?: string; localPort: number; remoteHost: string; remotePort: number },
    ): Promise<TunnelStatus[]>;
    start(id: string): Promise<void>;
    stop(id: string): Promise<void>;
    remove(serverId: string, id: string): Promise<TunnelStatus[]>;
  };
  usage: {
    summary(): Promise<import('./types').UsageSummary>;
  };
  demo: {
    start(): Promise<{ serverId: string; host: string; port: number }>;
    stop(): Promise<void>;
    status(): Promise<DemoStatus>;
  };
  events: {
    on<K extends EventChannel>(channel: K, handler: (payload: EventMap[K]) => void): () => void;
  };
}

export type { AgentToolCall, RealtimePayload };
