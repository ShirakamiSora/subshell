import type {
  SecurityFinding,
  SecurityFindingStatus,
  SecuritySeverity,
  ServerProfile,
} from '../../shared/types';
import { splitSections, parsePorts } from '../recon/parse';

export interface SecurityFindingState {
  status: SecurityFindingStatus;
  updatedAt: number;
}

export interface SecurityCheckInput {
  serverId: string;
  raw: string;
  profile: ServerProfile | null;
  states: Record<string, SecurityFindingState>;
  now?: number;
}

export interface SecurityEvaluation {
  findings: SecurityFinding[];
  score: number;
}

/** 高危监听端口：直接暴露到公网时风险很高。 */
const SENSITIVE_PORTS: Record<number, { severity: SecuritySeverity; title: string; detail: string; service: string }> = {
  23: { severity: 'critical', title: 'Telnet 端口对外开放', detail: 'Telnet 使用明文传输凭据，任何网络抓包都能拿到账号密码。', service: 'telnet' },
  2375: { severity: 'critical', title: 'Docker API 未加密对外开放', detail: 'Docker 远程 API 等同于 root 权限，暴露到公网可被直接接管服务器。', service: 'docker' },
  2376: { severity: 'warning', title: 'Docker API 对外开放', detail: '请确认已启用双向 TLS 并限制来源 IP。', service: 'docker' },
  3306: { severity: 'critical', title: 'MySQL 端口对外开放', detail: '数据库不应直接暴露到公网；优先只监听 127.0.0.1 或通过 SSH 隧道访问。', service: 'mysql' },
  5432: { severity: 'critical', title: 'PostgreSQL 端口对外开放', detail: '数据库端口暴露会带来暴力破解与数据泄露风险。', service: 'postgresql' },
  6379: { severity: 'critical', title: 'Redis 端口对外开放', detail: '未授权的 Redis 可被写入 SSH 公钥或窃取数据。', service: 'redis' },
  27017: { severity: 'critical', title: 'MongoDB 端口对外开放', detail: '历史上大量 MongoDB 因公网无认证被拖库。', service: 'mongodb' },
  9200: { severity: 'warning', title: 'Elasticsearch 对外开放', detail: '请确认启用了认证，并限制访问来源。', service: 'elasticsearch' },
  11211: { severity: 'critical', title: 'Memcached 对外开放', detail: 'Memcached 无认证，可被用于放大攻击或读取缓存数据。', service: 'memcached' },
  2181: { severity: 'warning', title: 'Zookeeper 对外开放', detail: '请限制 Zookeeper 只在内网可访问。', service: 'zookeeper' },
  9092: { severity: 'warning', title: 'Kafka 对外开放', detail: 'Kafka 默认无认证，暴露会允许任意写入与读取。', service: 'kafka' },
  1433: { severity: 'critical', title: 'SQL Server 端口对外开放', detail: '数据库不应直接暴露到公网。', service: 'mssql' },
  3389: { severity: 'critical', title: '远程桌面端口对外开放', detail: 'RDP 是暴力破解与勒索软件的重点目标。', service: 'rdp' },
  5900: { severity: 'warning', title: 'VNC 对外开放', detail: 'VNC 通常无加密，请通过 SSH 隧道访问。', service: 'vnc' },
  21: { severity: 'warning', title: 'FTP 端口对外开放', detail: 'FTP 使用明文传输，建议改用 SFTP。', service: 'ftp' },
};

const PUBLIC_ADDRESS = /^(0\.0\.0\.0|::|\[::\]|\*|)$/;

function scalar(sections: Record<string, string>, name: string): string {
  return (sections[name] ?? '').trim();
}

function parseKeyValue(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([\w-]+)\s+(.+)$/.exec(trimmed);
    if (!match) continue;
    result[match[1]!.toLowerCase()] = match[2]!.trim();
  }
  return result;
}

function parseUid0Users(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-zA-Z0-9_.-]+$/.test(line));
}

function parseGroupMembers(body: string): string[] {
  const members = new Set<string>();
  for (const line of body.split('\n')) {
    const parts = line.split(':');
    if (parts.length < 4) continue;
    const list = (parts[3] ?? '').split(',');
    for (const user of list) {
      const name = user.trim();
      if (name) members.add(name);
    }
  }
  return [...members];
}

function majorVersion(version: string): number {
  const parsed = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPublic(address: string): boolean {
  return PUBLIC_ADDRESS.test(address);
}

function statusOf(
  states: Record<string, SecurityFindingState>,
  id: string,
  now: number,
): { status: SecurityFindingStatus; updatedAt: number } {
  return states[id] ?? { status: 'open', updatedAt: now };
}

/**
 * 把只读检查结果转换为风险清单。纯函数，便于单测与重复计算。
 * 只报告可解释、可修复的问题；没有证据的猜测不进入清单。
 */
export function evaluateSecurity(input: SecurityCheckInput): SecurityEvaluation {
  const now = input.now ?? Date.now();
  const sections = splitSections(input.raw);
  const findings: SecurityFinding[] = [];
  const seen = new Set<string>();

  const push = (
    id: string,
    severity: SecuritySeverity,
    kind: SecurityFinding['kind'],
    title: string,
    detail: string,
    evidence?: string,
    suggestion?: string,
  ) => {
    if (seen.has(id)) return;
    seen.add(id);
    const state = statusOf(input.states, id, now);
    findings.push({
      id,
      kind,
      severity,
      title,
      detail,
      evidence: evidence?.slice(0, 1200),
      suggestion,
      status: state.status,
      updatedAt: state.updatedAt,
    });
  };

  // ---- 监听端口 ----
  const ports = parsePorts(scalar(sections, 'LISTEN'));
  const exposed = ports.filter((port) => isPublic(port.address));
  for (const port of exposed) {
    const rule = SENSITIVE_PORTS[port.port];
    if (!rule) continue;
    const process = port.process ? `，进程 ${port.process}` : '';
    push(
      `port:${port.port}`,
      rule.severity,
      'port',
      rule.title,
      `${rule.detail}当前监听 ${port.address}:${port.port}（${port.protocol}${process}）。`,
      `${port.protocol} ${port.address}:${port.port}${port.process ? ` ${port.process}` : ''}`,
      `把 ${rule.service} 改为只监听 127.0.0.1，或在防火墙/安全组中仅放行可信来源 IP。`,
    );
  }
  if (exposed.some((port) => port.port === 22)) {
    push(
      'ssh:public-port',
      'info',
      'ssh',
      'SSH 端口对公网开放',
      'SSH 是暴力破解的主要目标。如果条件允许，建议限制来源 IP，或改用非默认端口并启用 fail2ban。',
      `22/tcp 监听于 ${exposed.find((port) => port.port === 22)?.address ?? '0.0.0.0'}`,
      '在云安全组限制 22 端口来源；或修改 sshd 端口并配置 fail2ban。',
    );
  }

  // ---- SSH 配置 ----
  const sshEffective = parseKeyValue(scalar(sections, 'SSHD_EFFECTIVE'));
  const sshConfig = parseKeyValue(scalar(sections, 'SSH_CONFIG'));
  const ssh = { ...sshConfig, ...sshEffective };
  if (ssh.permitrootlogin && /^yes$/i.test(ssh.permitrootlogin)) {
    push(
      'ssh:root-login',
      'warning',
      'ssh',
      'SSH 允许 root 直接登录',
      'root 直接登录会放大暴力破解与误操作风险，建议改为 PermitRootLogin prohibit-password 并使用普通用户 + sudo。',
      `PermitRootLogin ${ssh.permitrootlogin}`,
      '修改 /etc/ssh/sshd_config：PermitRootLogin prohibit-password，然后 sshd -t && systemctl reload sshd。',
    );
  }
  if (ssh.passwordauthentication && /^yes$/i.test(ssh.passwordauthentication)) {
    push(
      'ssh:password-auth',
      'warning',
      'ssh',
      'SSH 允许密码登录',
      '密码登录可被暴力破解。确认已配置密钥登录后，可以关闭密码认证。',
      `PasswordAuthentication ${ssh.passwordauthentication}`,
      '确认密钥登录可用后，将 PasswordAuthentication 改为 no 并重载 sshd。',
    );
  }
  if (ssh.permitemptypasswords && /^yes$/i.test(ssh.permitemptypasswords)) {
    push(
      'ssh:empty-password',
      'critical',
      'ssh',
      'SSH 允许空密码登录',
      '任何能连上 SSH 的账号都可以无密码登录，必须立即关闭。',
      `PermitEmptyPasswords ${ssh.permitemptypasswords}`,
      '设置 PermitEmptyPasswords no，并为所有账号设置强密码或密钥。',
    );
  }
  const maxAuth = Number.parseInt(ssh.maxauthtries ?? '', 10);
  if (Number.isFinite(maxAuth) && maxAuth > 5) {
    push(
      'ssh:max-auth-tries',
      'info',
      'ssh',
      'SSH 认证尝试次数偏大',
      `MaxAuthTries=${maxAuth}，建议收敛到 3-5 次以降低暴力破解成功率。`,
      `MaxAuthTries ${maxAuth}`,
      '在 sshd_config 中设置 MaxAuthTries 3~5。',
    );
  }

  // ---- 防火墙 ----
  const firewallBody = `${scalar(sections, 'FIREWALL')}\n${scalar(sections, 'IPTABLES')}`.trim();
  const firewallOff =
    /Status:\s*inactive/i.test(firewallBody) ||
    /not running/i.test(firewallBody) ||
    (/(^|\n)\s*-P INPUT ACCEPT/.test(firewallBody) && !/(^|\n)\s*-A INPUT/.test(firewallBody));
  if (firewallBody && firewallOff) {
    push(
      'firewall:inactive',
      'warning',
      'firewall',
      '主机防火墙未启用',
      '未检测到生效的 ufw / firewalld / iptables 规则。若云安全组已收敛端口，可忽略此项；否则建议启用主机防火墙。',
      firewallBody.slice(0, 500),
      '启用 ufw（ufw default deny incoming; ufw allow <必要端口>; ufw enable）或 firewalld，并保留 SSH 端口。',
    );
  }

  // ---- 账户 ----
  const uid0 = parseUid0Users(scalar(sections, 'USERS'));
  const extraRoot = uid0.filter((name) => name !== 'root');
  for (const user of extraRoot) {
    push(
      `account:uid0:${user}`,
      'critical',
      'account',
      `存在额外的 UID 0 账户：${user}`,
      'UID 0 等同于 root，多一个入口就多一份被接管的风险。请确认用途，不需要时删除或降权。',
      `uid=0 ${user}`,
      `确认用途后执行 usermod -u <新UID> ${user} 或 userdel ${user}（先备份权限）。`,
    );
  }
  const sudoUsers = parseGroupMembers(scalar(sections, 'SUDO'));
  if (sudoUsers.length > 0) {
    push(
      'account:sudo-users',
      'info',
      'account',
      '存在 sudo 权限账户',
      `以下账户拥有 sudo 权限：${sudoUsers.join('、')}。请定期复核，移除不再需要的授权。`,
      sudoUsers.join(', '),
      '定期复核 sudo/wheel 组成员；对离职或不再需要的账户执行 gpasswd -d <user> sudo。',
    );
  }

  // ---- 系统更新 ----
  const updates = Number.parseInt(scalar(sections, 'UPDATES'), 10);
  if (Number.isFinite(updates) && updates > 0) {
    push(
      'update:pending',
      updates > 30 ? 'critical' : 'warning',
      'update',
      `有 ${updates} 个可升级软件包`,
      updates > 30
        ? '长期未更新的系统通常包含已公开的高危漏洞，建议尽快在维护窗口内升级。'
        : '存在可升级的安全更新，建议在维护窗口内评估并安装。',
      `apt-get -s upgrade 可升级 ${updates} 个包`,
      '先在测试环境验证，再执行 apt-get upgrade / yum update；升级前确认关键服务兼容性。',
    );
  }

  // ---- Docker ----
  const dockerSocket = scalar(sections, 'DOCKER_SOCKET');
  if (dockerSocket) {
    const [mode = '', owner = ''] = dockerSocket.split(/\s+/);
    if (/[0-9][0-9][7][0-9]|[0-9][0-9][0-9][7]/.test(mode ?? '') || /^(666|777)$/.test(mode ?? '')) {
      push(
        'docker:socket-permission',
        'critical',
        'docker',
        'Docker Socket 权限过宽',
        '能读写 /var/run/docker.sock 就等同于 root 权限，过宽权限会让普通用户直接接管宿主机。',
        `${mode} ${owner}`,
        '恢复为 root:docker 660：chown root:docker /var/run/docker.sock && chmod 660 /var/run/docker.sock。',
      );
    }
  }

  // ---- 时间同步 ----
  const ntp = scalar(sections, 'TIME').toLowerCase();
  if (ntp === 'no' || ntp === 'false') {
    push(
      'time:unsynced',
      'warning',
      'time',
      '系统时间未同步',
      '时间漂移会导致证书校验失败、日志时间错乱，并影响集群节点一致性。',
      `NTPSynchronized=${ntp}`,
      '启用 chrony 或 systemd-timesyncd，确认时间源可达。',
    );
  }

  // ---- 失败登录 ----
  const failedLogins = Number.parseInt(scalar(sections, 'FAILED_LOGINS'), 10);
  if (Number.isFinite(failedLogins) && failedLogins > 20) {
    push(
      'log:failed-logins',
      'warning',
      'log',
      '近期存在大量失败登录',
      `最近记录到约 ${failedLogins} 条失败登录，可能存在暴力破解尝试。`,
      `lastb 记录 ${failedLogins} 条`,
      '启用 fail2ban 或限制 SSH 来源；检查 /var/log/auth.log 中的来源 IP。',
    );
  }

  // ---- 证书 ----
  for (const cert of input.profile?.certificates ?? []) {
    if (cert.daysLeft === undefined) continue;
    if (cert.daysLeft < 7) {
      push(
        `cert:${cert.port}`,
        'critical',
        'certificate',
        `端口 ${cert.port} 证书即将过期`,
        `证书仅剩 ${cert.daysLeft} 天，过期后 HTTPS 会直接不可用。`,
        cert.expiresAt,
        '立即续期（certbot renew）并重载 Web 服务，随后验证证书链。',
      );
    } else if (cert.daysLeft < 30) {
      push(
        `cert:${cert.port}`,
        'warning',
        'certificate',
        `端口 ${cert.port} 证书 ${cert.daysLeft} 天后过期`,
        '建议提前续期，避免自动续期任务失败导致站点中断。',
        cert.expiresAt,
        '检查 certbot 定时任务，手动执行一次 certbot renew --dry-run。',
      );
    }
  }

  // ---- 系统版本 ----
  const osRelease = parseKeyValue(scalar(sections, 'OS_RELEASE').replace(/=/g, ' '));
  const osId = (osRelease.id ?? '').toLowerCase().replace(/"/g, '');
  const osVersion = (osRelease.version_id ?? '').replace(/"/g, '');
  const major = majorVersion(osVersion);
  if (osId === 'ubuntu' && major > 0 && major < 20) {
    push(
      'os:eol',
      'warning',
      'update',
      `Ubuntu ${osVersion} 已停止标准支持`,
      '旧版本不再获得安全更新，建议规划升级。',
      `Ubuntu ${osVersion}`,
      '先评估业务兼容性，再按官方文档跨版本升级；无法升级时收敛对外暴露面。',
    );
  } else if (osId === 'debian' && major > 0 && major < 11) {
    push(
      'os:eol',
      'warning',
      'update',
      `Debian ${osVersion} 已停止标准支持`,
      '旧版本不再获得安全更新，建议规划升级。',
      `Debian ${osVersion}`,
      '评估后升级到受支持的 Debian 版本。',
    );
  } else if ((osId === 'centos' && major <= 8) || (osId === 'almalinux' && major < 8) || (osId === 'rocky' && major < 8)) {
    push(
      'os:eol',
      'warning',
      'update',
      `${osId} ${osVersion} 已停止维护`,
      '该发行版已不再提供安全更新，继续使用会持续累积未修复漏洞。',
      `${osId} ${osVersion}`,
      '迁移到受支持的发行版（如 Rocky Linux / AlmaLinux / Debian）。',
    );
  }

  const weight: Record<SecuritySeverity, number> = { critical: 18, warning: 7, info: 1 };
  const open = findings.filter((finding) => finding.status === 'open');
  const score = Math.max(
    0,
    Math.min(100, Math.round(100 - open.reduce((sum, finding) => sum + weight[finding.severity], 0))),
  );

  const order: Record<SecuritySeverity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title));

  return { findings, score };
}
