import type {
  HealthIssue,
  HealthReport,
  HealthScore,
  IssueSeverity,
  IssueStatus,
  MonitorEvent,
  ServerProfile,
  ServiceInfo,
} from '../../shared/types';

export interface IssueState {
  status: IssueStatus;
  updatedAt: number;
}

export interface HealthInput {
  serverId: string;
  profile: ServerProfile | null;
  events: MonitorEvent[];
  services: ServiceInfo[];
  /** issueId -> 用户处理状态 */
  states: Record<string, IssueState>;
  now?: number;
}

const SEVERITY_WEIGHT: Record<IssueSeverity, number> = { critical: 15, warning: 6, info: 1 };

/** 按问题标题给出可执行的建议动作，避免所有问题都落到同一句空话。 */
function suggestFor(title: string, detail: string): string {
  const text = `${title} ${detail}`;
  if (/磁盘|分区|inode|空间/.test(text)) {
    return '查看占用最大的目录（du -sh /var/log/* | sort -h），清理日志或扩容后再复查。';
  }
  if (/证书|过期/.test(text)) {
    return '确认证书到期时间，执行续期（如 certbot renew）并重载 Web 服务。';
  }
  if (/OOM|内存/.test(text)) {
    return '找出占用内存最高的进程，评估是否需要增加内存、Swap 或调整服务限额。';
  }
  if (/登录|root|SSH|ssh/.test(text)) {
    return '检查 /var/log/auth.log 的来源 IP，考虑启用 fail2ban、禁用密码登录。';
  }
  if (/服务|容器|unit/.test(text)) {
    return '查看服务日志定位失败原因，修复配置后再重启并确认状态。';
  }
  if (/软件包|升级|补丁/.test(text)) {
    return '在维护窗口内评估并安装安全更新，升级前确认关键服务兼容性。';
  }
  if (/僵尸|进程/.test(text)) {
    return '定位产生僵尸进程的父进程，必要时重启对应服务。';
  }
  if (/时间|NTP|同步/.test(text)) {
    return '检查 chrony/ntpd 是否运行，确认时间源可达。';
  }
  return '可以让 AI 助手进一步定位原因，或手动检查相关日志。';
}

function normalizeState(states: Record<string, IssueState>, id: string, now: number): IssueState {
  return states[id] ?? { status: 'open', updatedAt: now };
}

/**
 * 把「档案里的风险 + 未确认的监控事件 + 异常服务 + 未完成检查项」聚合为一份体检报告。
 * 纯函数：不读写磁盘，便于单测；持久化与状态合并由 HealthService 负责。
 */
export function buildHealthReport(input: HealthInput): HealthReport {
  const now = input.now ?? Date.now();
  const issues: HealthIssue[] = [];
  const seen = new Set<string>();
  const { serverId, profile, events, services, states } = input;

  const push = (issue: Omit<HealthIssue, 'serverId' | 'status'> & { status?: IssueStatus }) => {
    if (seen.has(issue.id)) return;
    seen.add(issue.id);
    const state = normalizeState(states, issue.id, now);
    issues.push({
      ...issue,
      serverId,
      status: state.status,
      updatedAt: Math.max(issue.updatedAt, state.updatedAt),
    });
  };

  // 失败服务单独成条（信息更具体），档案里指向同一服务的风险不再重复展示。
  const failedServiceNames = (services ?? [])
    .filter((service) => service.state === 'failed')
    .map((service) => service.name.replace(/\.service$/, '').toLowerCase())
    .filter(Boolean);

  for (const risk of profile?.risks ?? []) {
    const text = `${risk.title} ${risk.detail}`.toLowerCase();
    if (failedServiceNames.some((name) => text.includes(name))) continue;
    push({
      id: `risk:${risk.id}`,
      severity: risk.level,
      source: 'profile',
      title: risk.title,
      detail: risk.detail,
      suggestion: suggestFor(risk.title, risk.detail),
      updatedAt: now,
    });
  }

  // 只有未确认、且还在 7 天内的事件才算「待处理」。已确认的历史告警不应拉低健康分。
  const recentFloor = now - 7 * 24 * 60 * 60 * 1000;
  for (const event of events) {
    if (event.acknowledged || event.ts < recentFloor) continue;
    push({
      id: `event:${event.id}`,
      severity: event.severity,
      source: 'monitor',
      title: event.title,
      detail: event.detail,
      suggestion: suggestFor(event.title, event.detail),
      updatedAt: event.ts,
    });
  }

  for (const service of services) {
    if (service.state !== 'failed') continue;
    push({
      id: `service:${service.name}`,
      severity: 'critical',
      source: 'service',
      title: `服务启动失败：${service.name}`,
      detail: service.description ? `${service.description}（${service.kind}）` : `服务 ${service.name} 当前为 failed 状态。`,
      suggestion: `查看 ${service.name} 的最近日志定位失败原因，修复后重启并验证状态。`,
      service: service.name,
      updatedAt: now,
    });
  }

  for (const item of profile?.checklist ?? []) {
    if (item.done) continue;
    push({
      id: `check:${item.id}`,
      severity: 'info',
      source: 'checklist',
      title: `待办：${item.text}`,
      detail: '这是档案中记录但尚未完成的检查项。',
      suggestion: '完成该项检查后，在服务器档案里勾选完成。',
      updatedAt: now,
    });
  }

  const order: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return order[a.severity] - order[b.severity] || b.updatedAt - a.updatedAt;
  });

  const open = issues.filter((issue) => issue.status === 'open');
  const critical = open.filter((issue) => issue.severity === 'critical').length;
  const warning = open.filter((issue) => issue.severity === 'warning').length;
  const info = open.filter((issue) => issue.severity === 'info').length;
  const raw = 100 - critical * SEVERITY_WEIGHT.critical - warning * SEVERITY_WEIGHT.warning - info * SEVERITY_WEIGHT.info;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const grade: HealthScore['grade'] = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 55 ? 'fair' : 'poor';

  return {
    serverId,
    generatedAt: now,
    score: { score, grade, critical, warning, info },
    issues,
  };
}
