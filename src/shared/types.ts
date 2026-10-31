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
}

export interface UsageSummary {
  total: { input: number; output: number };
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
  usage?: { inputTokens?: number; outputTokens?: number };
}

export type AgentRunState = 'idle' | 'thinking' | 'tool' | 'awaiting_approval' | 'done' | 'error' | 'cancelled';

export interface AgentRunStatus {
  serverId: string;
  state: AgentRunState;
  round: number;
  error?: string;
}

export type AgentStreamEvent =
  | { type: 'run'; payload: AgentRunStatus }
  | { type: 'delta'; serverId: string; messageId: string; text: string }
  | { type: 'message'; serverId: string; message: ChatMessage }
  | { type: 'tool'; serverId: string; call: AgentToolCall }
  | { type: 'usage'; serverId: string; inputTokens: number; outputTokens: number }
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
  /** 每百万输入 token 的价格（元），用于估算金额，手工填写 */
  inputPricePerMTok: number;
  /** 每百万输出 token 的价格（元），用于估算金额，手工填写 */
  outputPricePerMTok: number;
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
