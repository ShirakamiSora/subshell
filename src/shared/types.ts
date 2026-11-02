/**
 * 主进程、预加载脚本与渲染进程共享的数据契约。
 * 所有跨越 IPC 边界的结构化数据都必须在这里定义，避免三处各写一份类型。
 */

export type AuthType = 'password' | 'key';

export interface JumpHostConfig {
  host: string;
  port: number;
  username: string;
  authType: AuthType;
}

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  /** 私钥文件路径（authType = key 时使用） */
  privateKeyPath?: string;
  /** 备注/用途 */
  description?: string;
  /** 分组名，默认「默认分组」 */
  group?: string;
  /** 主题色，用于头像 */
  color?: string;
  tags: string[];
  /** 是否为内置演示服务器（连接 127.0.0.1 的内存模拟服务） */
  demo?: boolean;
  jump?: JumpHostConfig | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerSecretInput {
  password?: string;
  passphrase?: string;
  /** 私钥内容（可替代私钥文件路径） */
  privateKey?: string;
}

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface ConnectionInfo {
  serverId: string;
  state: ConnectionState;
  since?: string;
  error?: string;
  latencyMs?: number;
  hostKeyFingerprint?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** 命令是否可能已被远端执行（超时/断线时用于安全提示） */
  uncertain?: boolean;
}

export interface ExecOptions {
  timeoutMs?: number;
  /** 以 sudo 执行。密码通过 stdin 提供，绝不写入命令行。 */
  sudo?: boolean;
}

// ---------------------------------------------------------------------------
// 监控与服务器状态
// ---------------------------------------------------------------------------

export interface MetricSample {
  ts: number;
  cpuPercent: number;
  memUsedPercent: number;
  memUsedKb: number;
  memTotalKb: number;
  swapUsedPercent: number;
  diskUsedPercent: number;
  diskUsedKb: number;
  diskTotalKb: number;
  load1: number;
  load5: number;
  load15: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
  processCount: number;
  uptimeSeconds: number;
  /** 采集失败时保留上一帧标记 */
  stale?: boolean;
}

export type ServiceKind = 'systemd' | 'docker' | 'process';
export type ServiceState = 'running' | 'stopped' | 'failed' | 'unknown';

export interface ServiceInfo {
  name: string;
  kind: ServiceKind;
  description?: string;
  state: ServiceState;
  subState?: string;
  enabled?: boolean;
  /** systemd 单元名称（容器时为容器名） */
  unit?: string;
  image?: string;
  ports?: string[];
  /** 进程方式的 PID */
  pid?: number;
}

export type MonitorSeverity = 'info' | 'warning' | 'critical';

export interface MonitorEvent {
  id: string;
  serverId: string;
  ts: number;
  severity: MonitorSeverity;
  kind: 'cpu' | 'memory' | 'disk' | 'load' | 'service' | 'port' | 'network' | 'system' | 'agent';
  title: string;
  detail: string;
  acknowledged?: boolean;
}

export interface PortInfo {
  protocol: string;
  address: string;
  port: number;
  process?: string;
  pid?: number;
}

export interface ProcessInfo {
  pid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  rssKb: number;
  command: string;
}

// ---------------------------------------------------------------------------
// 服务器档案（AI 的长期记忆）
// ---------------------------------------------------------------------------

export interface ProfileOs {
  name: string;
  version: string;
  kernel: string;
  arch: string;
  virtualization?: string;
}

export interface ProfileHardware {
  cpuModel: string;
  cpuCores: number;
  memTotalKb: number;
  swapTotalKb: number;
  diskTotalKb: number;
  diskUsedKb: number;
}

export interface ProfileNetworkInterface {
  name: string;
  addresses: string[];
}

export interface ProfileRuntime {
  name: string;
  version: string;
}

export interface ProfileRisk {
  id: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
}

export interface ProfileChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface ProfileStorage {
  mount: string;
  totalKb: number;
  usedKb: number;
  availableKb: number;
  usedPercent: number;
  inodePercent?: number;
}

export interface ProfileSecurityInfo {
  failedLogins?: number;
  upgradablePackages?: number;
  loginUsers?: string[];
  sudoUsers?: string[];
  suidCount?: number;
}

export interface ProfileHealth {
  zombieProcesses: number;
  oomKills: number;
  journalErrors: number;
  timeSynced?: boolean;
  failedUnits?: number;
}

export interface ProfileCertificate {
  port: number;
  expiresAt?: string;
  daysLeft?: number;
}

/** 档案的历史足迹：只保留精简统计，避免文件无限增长。 */
export interface ProfileHistoryEntry {
  ts: string;
  services: number;
  running: number;
  risks: number;
  note?: string;
}

export interface ServerProfile {
  serverId: string;
  /** 档案结构版本，用于升级时迁移旧文件 */
  schemaVersion?: number;
  scannedAt: string;
  hostname: string;
  os: ProfileOs;
  hardware: ProfileHardware;
  network: {
    interfaces: ProfileNetworkInterface[];
    publicIp?: string;
  };
  /** 模型 + 规则推断的服务器角色，例如「Nginx 反向代理 + Node.js 应用」 */
  role: string;
  /** 模型生成的服务器综述（Markdown） */
  summary: string;
  /** 结构化服务清单 */
  services: ServiceInfo[];
  runtimes: ProfileRuntime[];
  webSites: { domain?: string; root?: string; server?: string }[];
  /** 所有挂载点的磁盘与 inode 使用情况 */
  storage?: ProfileStorage[];
  securityInfo?: ProfileSecurityInfo;
  health?: ProfileHealth;
  /** 监听 443 的证书到期情况 */
  certificates?: ProfileCertificate[];
  /** 最近若干次扫描的精简足迹（最多 30 条） */
  history?: ProfileHistoryEntry[];
  /** 更早历史压缩后的摘要文本，控制档案体积 */
  historySummary?: string;
  risks: ProfileRisk[];
  /** 用户或模型维护的运维笔记（Markdown） */
  notes: string;
  checklist: ProfileChecklistItem[];
  /** 模型总结的更新时间 */
  summarizedAt?: string;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// AI Provider 与对话
// ---------------------------------------------------------------------------

export type ProviderKind = 'openai' | 'anthropic' | 'ollama' | 'mock';

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  /** 是否已保存 API Key（密钥本身只存于系统凭据库） */
  hasApiKey: boolean;
  /** 额外请求头，值可能需要脱敏 */
  headers?: Record<string, string>;
  contextWindow?: number;
  temperature?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderInput {
  id?: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
  contextWindow?: number;
  temperature?: number;
}

export type RiskLevel = 'read' | 'low' | 'medium' | 'high' | 'blocked';

export interface UsageServerSummary {
  serverId: string;
  name: string;
  input: number;
  output: number;
  messages: number;
  /** 命中的缓存输入 token */
  cachedInput: number;
  /** 写入缓存的 token */
  cacheCreation: number;
}

export interface UsageSummary {
  total: { input: number; output: number; cachedInput: number; cacheCreation: number };
  servers: UsageServerSummary[];
}

export interface CommandAnalysis {
  risk: RiskLevel;
  reasons: string[];
  explanation?: string;
  error?: string;
}

export type ToolCallStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'done'
  | 'error'
  | 'rejected'
  | 'cancelled';

export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  risk: RiskLevel;
  title: string;
  /** 将要执行的 shell 命令（只读工具也会展示） */
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
  error?: string;
  /** 审批说明（影响、回滚） */
  impact?: string;
  rollback?: string;
  /** 智能审批的判定来源与理由（未经过智能审批时为空） */
  approval?: {
    source: ApprovalSource;
    reason: string;
    auto: boolean;
    ruleName?: string;
  };
  createdAt: number;
  finishedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  /** 本轮助手消息的工具调用 */
  toolCalls?: AgentToolCall[];
  /** 是否被用户中止 */
  interrupted?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    /** 命中服务端上下文缓存的输入 token（价格通常更低） */
    cachedInputTokens?: number;
    /** 写入缓存的 token（Anthropic cache_creation）；不参与命中率计算 */
    cacheCreationTokens?: number;
  };
}

export type AgentRunState = 'idle' | 'thinking' | 'tool' | 'awaiting_approval' | 'done' | 'error' | 'cancelled';

export interface AgentRunStatus {
  serverId: string;
  state: AgentRunState;
  round: number;
  error?: string;
  /** 当前轮稳定系统提示的版本指纹；变化说明缓存前缀失效（档案更新等）。 */
  promptVersion?: string;
}

export type AgentStreamEvent =
  | { type: 'run'; payload: AgentRunStatus }
  | { type: 'delta'; serverId: string; messageId: string; text: string }
  | { type: 'message'; serverId: string; message: ChatMessage }
  | { type: 'tool'; serverId: string; call: AgentToolCall }
  | { type: 'usage'; serverId: string; inputTokens: number; outputTokens: number; cachedInputTokens?: number }
  | { type: 'summary'; serverId: string; text: string; ts: number };

export interface ApprovalDecision {
  callId: string;
  approved: boolean;
  /** 会话内始终允许该命令 */
  always?: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export type ThemeMode = 'dark' | 'light' | 'system';
export type Language = 'zh' | 'en';

/** 审批模式：strict 每次变更都确认；smart 由本地规则判定，低风险变更直接执行。 */
export type ApprovalMode = 'strict' | 'smart';

export interface AppSettings {
  activeProviderId: string | null;
  theme: ThemeMode;
  language: Language;
  approvalMode: ApprovalMode;
  /** 监控采样间隔（秒） */
  monitorIntervalSec: number;
  /** 是否自动侦察（连接后生成档案） */
  autoRecon: boolean;
  /** 是否自动批准只读工具 */
  autoApproveReadOnly: boolean;
  /** 是否把服务器档案同步到远端 ~/.subshell/profile.md */
  syncProfileToServer: boolean;
  /** 事件触发 AI 摘要 */
  aiAutoSummary: boolean;
  /** 保留监控样本数 */
  sampleRetention: number;
  /** 终端字号 */
  terminalFontSize: number;
  /** 命令审计日志 */
  auditEnabled: boolean;
  /** 是否启动内置 MCP 服务器（只监听 127.0.0.1） */
  mcpEnabled: boolean;
  /** MCP 服务器端口 */
  mcpPort: number;
  /** 是否允许外部 agent 通过 MCP 执行变更类工具 */
  mcpAllowMutations: boolean;
  /** 启动后自动检查新版本（只查询 GitHub Releases，不上报任何数据） */
  autoCheckUpdate: boolean;
  /** 每百万输入 token 的价格（元），用于估算金额，手工填写 */
  inputPricePerMTok: number;
  /** 每百万输出 token 的价格（元），用于估算金额，手工填写 */
  outputPricePerMTok: number;
  /** 智能审批：命令库匹配 + 模型独立会话判定 */
  smartApprovalEnabled: boolean;
  /** 智能审批：命令库未命中时是否交给模型判断 */
  smartApprovalUseModel: boolean;
  /** 记录命令历史（终端、AI、手动与集群执行） */
  commandHistoryEnabled: boolean;
  /** 每台服务器保留的命令历史条数上限 */
  commandHistoryRetention: number;
  /** 连接后与定时执行服务器安全检查 */
  securityAutoScan: boolean;
  /** 安全扫描间隔（小时） */
  securityScanIntervalHours: number;
  /** 集群批量执行的并发数 */
  clusterParallelism: number;
}

export interface AuditEntry {
  id: string;
  ts: number;
  serverId: string;
  actor: 'user' | 'ai';
  action: string;
  detail: string;
  risk?: RiskLevel;
  ok: boolean;
}

// ---------------------------------------------------------------------------
// 仪表盘聚合
// ---------------------------------------------------------------------------

export interface ServerRuntime {
  serverId: string;
  connection: ConnectionInfo;
  profile: ServerProfile | null;
  samples: MetricSample[];
  events: MonitorEvent[];
  services: ServiceInfo[];
  ports: PortInfo[];
  processes: ProcessInfo[];
  /** 模型生成的最新状态摘要 */
  summary?: { text: string; ts: number };
  monitoring: boolean;
}

export interface DemoStatus {
  running: boolean;
  host?: string;
  port?: number;
}

export interface AppInfo {
  version: string;
  electron: string;
  platform: string;
  dataDir: string;
}

export interface RealtimePayload {
  serverId: string;
  samples?: MetricSample[];
  events?: MonitorEvent[];
  services?: ServiceInfo[];
  ports?: PortInfo[];
  processes?: ProcessInfo[];
}

// ---------------------------------------------------------------------------
// 体检报告与检修工单
// ---------------------------------------------------------------------------

export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueStatus = 'open' | 'resolved' | 'ignored';
export type IssueSource = 'profile' | 'monitor' | 'service' | 'checklist';

export interface HealthIssue {
  id: string;
  serverId: string;
  severity: IssueSeverity;
  source: IssueSource;
  title: string;
  detail: string;
  /** 建议的处理动作，展示给用户与 AI */
  suggestion: string;
  /** 关联的服务名，便于一键定位 */
  service?: string;
  status: IssueStatus;
  /** 同一问题被重新检测到的时间 */
  updatedAt: number;
}

export interface HealthScore {
  /** 0-100，越高越健康 */
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  critical: number;
  warning: number;
  info: number;
}

export interface HealthReport {
  serverId: string;
  generatedAt: number;
  score: HealthScore;
  issues: HealthIssue[];
}

/** 一次针对某个问题的处理记录（谁、做了什么、结果如何）。 */
export interface TicketRecord {
  id: string;
  serverId: string;
  issueId: string;
  title: string;
  action: string;
  command?: string;
  ok: boolean;
  detail?: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// 远程文件（SFTP）
// ---------------------------------------------------------------------------

export type RemoteEntryType = 'file' | 'directory' | 'symlink' | 'other';

export interface RemoteEntry {
  name: string;
  /** 绝对路径 */
  path: string;
  type: RemoteEntryType;
  size: number;
  mode: number;
  mtime: number;
  /** 符号链接指向的目标（若有） */
  linkTarget?: string;
}

// ---------------------------------------------------------------------------
// 端口转发
// ---------------------------------------------------------------------------

export interface TunnelConfig {
  id: string;
  serverId: string;
  label: string;
  /** 本地监听端口（仅绑定 127.0.0.1） */
  localPort: number;
  /** 从服务器视角看到的目标地址 */
  remoteHost: string;
  remotePort: number;
}

export interface TunnelStatus extends TunnelConfig {
  running: boolean;
  connections: number;
  since?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// v0.3.1 命令历史与智能回退
// ---------------------------------------------------------------------------

/** 命令来源：AI 工具、交互式终端、手动执行、集群下发、MCP 调用、回退与安全修复执行。 */
export type CommandSource = 'ai' | 'terminal' | 'manual' | 'cluster' | 'mcp' | 'rollback' | 'security';

export interface CommandHistoryAnalysis {
  /** 这条命令做了什么 */
  summary: string;
  /** 影响范围与副作用 */
  impact: string;
  /** 风险点与注意事项 */
  riskNotes: string[];
  /** 是否可以安全回退 */
  reversible: boolean;
  generatedAt: number;
  model?: string;
  error?: string;
}

export interface RollbackStep {
  command: string;
  purpose: string;
  risk: RiskLevel;
}

export interface RollbackStepResult {
  command: string;
  ok: boolean;
  output: string;
  exitCode?: number | null;
}

/**
 * 智能回退方案。由模型在独立会话中生成，只作为建议：
 * 必须由用户确认后才会执行，且每条命令仍走本地风险分级。
 */
export interface RollbackPlan {
  entryId: string;
  summary: string;
  steps: RollbackStep[];
  /** 执行回退后可能出现的情况（模型预判） */
  predictions: string[];
  /** 回退动作与服务器上其他服务/配置的潜在冲突 */
  conflicts: string[];
  confidence: 'low' | 'medium' | 'high';
  generatedAt: number;
  status: 'planned' | 'executed' | 'failed' | 'cancelled';
  results?: RollbackStepResult[];
  error?: string;
}

export interface CommandHistoryEntry {
  id: string;
  serverId: string;
  command: string;
  source: CommandSource;
  risk: RiskLevel;
  ok: boolean;
  exitCode?: number | null;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  ts: number;
  /** 执行目的（AI 工具或集群下发时提供） */
  purpose?: string;
  /** 模型对这条命令的分析 */
  analysis?: CommandHistoryAnalysis;
  /** 最近一次生成的智能回退方案 */
  rollback?: RollbackPlan;
  /** 是否已经执行过回退 */
  reverted?: boolean;
}

export interface CommandHistoryQuery {
  limit?: number;
  query?: string;
  source?: CommandSource;
}

// ---------------------------------------------------------------------------
// v0.3.2 智能审批
// ---------------------------------------------------------------------------

export type ApprovalAction = 'approve' | 'reject' | 'ask';
export type ApprovalSource = 'rule' | 'model' | 'user' | 'session' | 'risk';

export interface ApprovalRule {
  id: string;
  name: string;
  /** 正则表达式，匹配完整命令（不区分大小写） */
  pattern: string;
  action: ApprovalAction;
  /** 命中时展示的风险等级（不能覆盖本地 blocked/high 判定） */
  risk?: RiskLevel;
  note?: string;
  builtin?: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ApprovalRuleInput {
  id?: string;
  name: string;
  pattern: string;
  action: ApprovalAction;
  note?: string;
  enabled?: boolean;
}

export interface ApprovalRecord {
  id: string;
  serverId: string;
  command: string;
  decision: ApprovalAction;
  source: ApprovalSource;
  risk: RiskLevel;
  reason: string;
  ruleId?: string;
  ruleName?: string;
  auto: boolean;
  ts: number;
}

/** 一次审批判定的结果。模型只能给出建议，不能执行命令。 */
export interface ApprovalVerdict {
  decision: ApprovalAction;
  source: ApprovalSource;
  risk: RiskLevel;
  reason: string;
  ruleId?: string;
  ruleName?: string;
}

// ---------------------------------------------------------------------------
// v0.3.3 服务器安全
// ---------------------------------------------------------------------------

export type SecuritySeverity = 'critical' | 'warning' | 'info';
export type SecurityFindingStatus = 'open' | 'fixed' | 'ignored' | 'accepted';
export type SecurityKind =
  | 'port'
  | 'service'
  | 'ssh'
  | 'firewall'
  | 'account'
  | 'update'
  | 'certificate'
  | 'docker'
  | 'permission'
  | 'time'
  | 'log'
  | 'custom';

export interface SecurityFinding {
  id: string;
  kind: SecurityKind;
  severity: SecuritySeverity;
  title: string;
  detail: string;
  /** 支撑判断的原始证据（已脱敏） */
  evidence?: string;
  suggestion?: string;
  status: SecurityFindingStatus;
  updatedAt: number;
}

export interface SecurityRemediationStep {
  title: string;
  commands: string[];
  risk: RiskLevel;
  note?: string;
}

export interface SecurityConflict {
  /** 可能受影响的服务、端口或配置 */
  target: string;
  reason: string;
  severity: 'warning' | 'info';
}

export interface SecurityRemediation {
  findingId: string;
  serverId: string;
  summary: string;
  steps: SecurityRemediationStep[];
  impact: string;
  /** 与服务器上其他服务的冲突分析（结合服务器档案） */
  conflicts: SecurityConflict[];
  verification: string[];
  generatedAt: number;
  status: 'draft' | 'applied' | 'failed';
  error?: string;
}

export interface SecurityScan {
  serverId: string;
  startedAt: number;
  finishedAt: number;
  trigger: 'manual' | 'scheduled' | 'connect';
  findings: SecurityFinding[];
  score: number;
  summary: string;
  error?: string;
}

export interface SecurityReport {
  serverId: string;
  scan: SecurityScan | null;
  remediations: SecurityRemediation[];
}

export interface SecurityRemediationResult {
  remediation: SecurityRemediation;
  results: { command: string; ok: boolean; output: string }[];
}

// ---------------------------------------------------------------------------
// v0.3.4 MCP 客户端与权限
// ---------------------------------------------------------------------------

export type McpScope = 'read' | 'exec' | 'admin';

export interface McpClient {
  id: string;
  name: string;
  scopes: McpScope[];
  /** 允许访问的服务器 ID；空数组表示全部 */
  servers: string[];
  enabled: boolean;
  createdAt: number;
  lastUsedAt?: number;
  calls: number;
  /** Token 前缀，仅用于识别；完整 Token 只在创建/轮换时返回一次 */
  tokenPrefix: string;
}

export interface McpClientInput {
  id?: string;
  name: string;
  scopes: McpScope[];
  servers: string[];
  enabled?: boolean;
}

export interface McpClientsResult {
  clients: McpClient[];
  /** 新建或轮换时的一次性完整 Token */
  token?: string;
}

export interface McpCallRecord {
  id: string;
  clientId: string;
  tool: string;
  serverId?: string;
  ok: boolean;
  detail: string;
  ts: number;
}

export interface McpStatus {
  running: boolean;
  port: number;
  /** 兼容旧客户端的默认 Token（完整权限受设置约束） */
  token: string;
  mutationEnabled: boolean;
  endpoint: string;
  clients: McpClient[];
}

// ---------------------------------------------------------------------------
// v0.3.8 集群运维
// ---------------------------------------------------------------------------

export type ClusterTargetStatus =
  | 'pending'
  | 'prechecking'
  | 'ready'
  | 'blocked'
  | 'running'
  | 'ok'
  | 'failed'
  | 'skipped';

export interface ClusterCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ClusterTargetResult {
  serverId: string;
  serverName: string;
  status: ClusterTargetStatus;
  precheck: {
    ok: boolean;
    checks: ClusterCheck[];
    latencyMs?: number;
    error?: string;
  };
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}

export interface ClusterPrecheckResult {
  serverId: string;
  serverName: string;
  ok: boolean;
  latencyMs?: number;
  checks: ClusterCheck[];
  error?: string;
}

export interface ClusterRunInput {
  serverIds: string[];
  command: string;
  purpose?: string;
  concurrency?: number;
}

export interface ClusterRun {
  id: string;
  command: string;
  purpose?: string;
  startedAt: number;
  finishedAt?: number;
  phase: 'prechecking' | 'running' | 'done' | 'failed' | 'cancelled';
  targets: ClusterTargetResult[];
}
