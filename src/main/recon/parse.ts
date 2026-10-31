import type { PortInfo, ProcessInfo, ServiceInfo } from '../../shared/types';

export interface SystemdUnit {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

export interface DockerContainer {
  name: string;
  image: string;
  status: string;
  ports: string;
}

export interface ReconStorage {
  mount: string;
  totalKb: number;
  usedKb: number;
  availableKb: number;
  usedPercent: number;
  inodePercent?: number;
}

export interface ReconSecurity {
  failedLogins?: number;
  upgradablePackages?: number;
  loginUsers: string[];
  sudoUsers: string[];
  suidCount?: number;
}

export interface ReconHealth {
  zombies: number;
  timeSynced?: boolean;
  failedUnits: number;
  journalErrors: number;
}

export interface ReconCertificate {
  port: number;
  expiresAt?: string;
  daysLeft?: number;
}

export interface ReconResult {
  base: Record<string, string>;
  storage: ReconStorage[];
  memory: {
    totalKb: number;
    availableKb: number;
    swapTotalKb: number;
    swapFreeKb: number;
    oomKills: number;
  };
  networkInfo: {
    defaultRoutes: string[];
    dns: string[];
    summary: string[];
    somaxconn?: number;
    fileHandles?: string;
  };
  securityInfo: ReconSecurity;
  health: ReconHealth;
  certificates: ReconCertificate[];
  packages: string[];
  interfaces: { name: string; addresses: string[] }[];
  units: SystemdUnit[];
  enabled: Set<string>;
  failed: SystemdUnit[];
  containers: DockerContainer[];
  ports: PortInfo[];
  processes: ProcessInfo[];
  runtimes: { name: string; version: string }[];
  web: {
    nginxSites: string[];
    apacheVhosts: string[];
    cron: string[];
    timers: string[];
    homeDirs: string[];
  };
  security: {
    sshd: string[];
    firewall: string[];
    selinux: string;
    rebootRequired: boolean;
  };
  raw: Record<string, string>;
}

/** 按 `##SECTION:name` 切分侦察输出。 */
export function splitSections(raw: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = raw.split(/^##SECTION:(.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i]?.trim() ?? '';
    const body = parts[i + 1] ?? '';
    if (name) sections[name] = body.replace(/^\n+/, '').trimEnd();
  }
  return sections;
}

export function parseBase(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function parseSystemdLine(line: string): SystemdUnit | null {
  const cleaned = line.replace(/^[\s●*]+/, '').trim();
  if (!cleaned || cleaned.startsWith('UNIT') || cleaned.startsWith('0 loaded')) return null;
  const match = cleaned.match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
  if (!match) return null;
  return {
    unit: match[1]!,
    load: match[2]!,
    active: match[3]!,
    sub: match[4]!,
    description: match[5] ?? '',
  };
}

export function parseUnits(body: string): SystemdUnit[] {
  return body
    .split('\n')
    .map(parseSystemdLine)
    .filter((unit): unit is SystemdUnit => unit !== null);
}

/** 解析 `systemctl list-unit-files --state=enabled`（只有单元名、状态、预设三列）。 */
export function parseEnabledUnits(body: string): Set<string> {
  const result = new Set<string>();
  for (const line of body.split('\n')) {
    const name = line.trim().replace(/^[●*\s]+/, '').split(/\s+/)[0];
    if (name && name.endsWith('.service')) result.add(name);
  }
  return result;
}

export function parseInterfaces(body: string): { name: string; addresses: string[] }[] {
  const result: { name: string; addresses: string[] }[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const name = parts[0]!;
    if (!/^[a-zA-Z0-9_.:@-]+$/.test(name)) continue;
    const addresses = parts.slice(2).filter((part) => part.includes('/') && (part.includes('.') || part.includes(':')));
    if (addresses.length) result.push({ name, addresses });
  }
  return result;
}

export function parseContainers(body: string): DockerContainer[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', image = '', status = '', ports = ''] = line.split('|');
      return { name, image, status, ports };
    })
    .filter((item) => item.name);
}

export function parsePorts(body: string): PortInfo[] {
  const seen = new Set<string>();
  const result: PortInfo[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const protocol = tokens[0]?.toLowerCase();
    if (protocol !== 'tcp' && protocol !== 'udp') continue;

    let local = '';
    if (tokens[1] === 'LISTEN' || tokens[1] === 'UNCONN') {
      local = tokens[4] ?? '';
    } else if (/^\d+$/.test(tokens[1] ?? '') && tokens[3]) {
      // netstat -tulpn: proto recv-q send-q local foreign state pid/program
      local = tokens[3] ?? '';
    } else {
      local = tokens[4] ?? '';
    }

    const colon = local.lastIndexOf(':');
    if (colon < 0) continue;
    const address = local.slice(0, colon).replace(/^\[|\]$/g, '').replace(/%[^%]*$/, '');
    const port = Number.parseInt(local.slice(colon + 1), 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;

    const processMatch = trimmed.match(/users:\(\("([^"]+)",pid=(\d+)/) ?? trimmed.match(/(\d+)\/([^\s]+)\s*$/);
    let process: string | undefined;
    let pid: number | undefined;
    if (processMatch) {
      if (/^\d+$/.test(processMatch[1]!)) {
        pid = Number.parseInt(processMatch[1]!, 10);
        process = processMatch[2];
      } else {
        process = processMatch[1];
        pid = processMatch[2] ? Number.parseInt(processMatch[2], 10) : undefined;
      }
    }

    const key = `${protocol}:${address}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ protocol, address, port, process, pid });
  }
  return result.sort((a, b) => a.port - b.port);
}

export function parseProcesses(body: string): ProcessInfo[] {
  const result: ProcessInfo[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
    if (match) {
      result.push({
        pid: Number.parseInt(match[1]!, 10),
        user: match[2]!,
        cpuPercent: Number.parseFloat(match[3]!),
        memPercent: Number.parseFloat(match[4]!),
        rssKb: Number.parseInt(match[5]!, 10),
        command: match[6]!.trim(),
      });
      continue;
    }
    // busybox `ps aux` fallback
    const aux = line.match(/^\s*(\S+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.*)$/);
    if (aux) {
      result.push({
        pid: Number.parseInt(aux[2]!, 10),
        user: aux[1]!,
        cpuPercent: Number.parseFloat(aux[3]!),
        memPercent: Number.parseFloat(aux[4]!),
        rssKb: 0,
        command: aux[5]!.trim(),
      });
    }
  }
  return result;
}

export function parseRuntimes(body: string): { name: string; version: string }[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('RUNTIME='))
    .map((line) => {
      const value = line.slice('RUNTIME='.length);
      const [name = '', version = ''] = value.split('|');
      return { name, version: version.trim() };
    })
    .filter((item) => item.name);
}

export function parseWeb(body: string): ReconResult['web'] {
  const result: ReconResult['web'] = { nginxSites: [], apacheVhosts: [], cron: [], timers: [], homeDirs: [] };
  let current = '';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'NGINX_SITES:') { current = 'nginx'; continue; }
    if (trimmed === 'APACHE_VHOSTS:') { current = 'apache'; continue; }
    if (trimmed === 'CRON:') { current = 'cron'; continue; }
    if (trimmed === 'TIMERS:') { current = 'timers'; continue; }
    if (trimmed === 'HOME_DIRS:') { current = 'home'; continue; }
    if (current === 'nginx') result.nginxSites.push(trimmed);
    else if (current === 'apache') result.apacheVhosts.push(trimmed);
    else if (current === 'cron') result.cron.push(trimmed);
    else if (current === 'timers') result.timers.push(trimmed);
    else if (current === 'home') result.homeDirs.push(trimmed);
  }
  return result;
}

export function parseSecurity(body: string): ReconResult['security'] {
  const result: ReconResult['security'] = {
    sshd: [],
    firewall: [],
    selinux: '',
    rebootRequired: false,
  };
  let current = '';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'SSHD:') { current = 'sshd'; continue; }
    if (trimmed === 'FIREWALL:') { current = 'firewall'; continue; }
    if (trimmed === 'SELINUX:') { current = 'selinux'; continue; }
    if (trimmed === 'REBOOT_REQUIRED:') { current = 'reboot'; continue; }
    if (trimmed === 'END:') break;
    if (current === 'sshd') result.sshd.push(trimmed);
    else if (current === 'firewall') result.firewall.push(trimmed);
    else if (current === 'selinux') result.selinux = trimmed;
    else if (current === 'reboot') result.rebootRequired = trimmed === 'yes';
  }
  return result;
}

function parseKeyValues(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 解析所有挂载点的磁盘与 inode 使用率。 */
export function parseStorage(body: string): ReconStorage[] {
  const [dfPart = '', inodePart = ''] = body.split('##INODE');
  const parseDf = (text: string): ReconStorage[] => {
    const result: ReconStorage[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [device = '', total = '', used = '', available = '', percent = '', mount = ''] = trimmed.split('|');
      const totalKb = Number.parseFloat(total);
      if (!mount || !device || !Number.isFinite(totalKb) || totalKb <= 0) continue;
      result.push({
        mount: mount.trim(),
        totalKb: Math.round(totalKb),
        usedKb: Math.round(Number.parseFloat(used) || 0),
        availableKb: Math.round(Number.parseFloat(available) || 0),
        usedPercent: Math.round((Number.parseFloat(percent) || 0) * 10) / 10,
      });
    }
    return result;
  };

  const storage = parseDf(dfPart);
  const inodeByMount = new Map(parseDf(inodePart).map((item) => [item.mount, item.usedPercent]));
  return storage.map((item) => ({
    ...item,
    inodePercent: inodeByMount.get(item.mount),
  }));
}

/** 解析 health section。 */
export function parseHealth(body: string): ReconHealth {
  const values = parseKeyValues(body);
  const timeSynced = values.TIME_SYNCED;
  return {
    zombies: toNumber(values.ZOMBIES) ?? 0,
    timeSynced: timeSynced === 'yes' ? true : timeSynced === 'no' ? false : undefined,
    failedUnits: toNumber(values.FAILED_UNITS) ?? 0,
    journalErrors: toNumber(values.JOURNAL_ERRORS) ?? 0,
  };
}

/** 解析 security section 中的统计项（SSHD/FIREWALL 文本仍由 parseSecurity 处理）。 */
export function parseSecurityStats(body: string): ReconSecurity {
  const values = parseKeyValues(body);
  const split = (value: string | undefined): string[] =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  return {
    failedLogins: toNumber(values.FAILED_LOGINS),
    upgradablePackages: toNumber(values.UPGRADABLE),
    loginUsers: split(values.LOGIN_USERS),
    sudoUsers: split(values.SUDO_USERS),
    suidCount: toNumber(values.SUID),
  };
}

/** 解析 443 证书到期时间。 */
export function parseCertificates(body: string): ReconCertificate[] {
  const result: ReconCertificate[] = [];
  const match = body.match(/CERT_443=(.+)/);
  if (!match) return result;
  const value = match[1]!.trim();
  const dateMatch = value.match(/([A-Z][a-z]{2})\s+(\d{1,2})\s+[\d:]+\s+(\d{4})/);
  if (!dateMatch) return result;
  const parsed = new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]} GMT`);
  if (Number.isNaN(parsed.getTime())) return result;
  result.push({
    port: 443,
    expiresAt: parsed.toISOString(),
    daysLeft: Math.floor((parsed.getTime() - Date.now()) / 86_400_000),
  });
  return result;
}

/** 解析完整侦察输出。 */
export function parseRecon(raw: string): ReconResult {
  const sections = splitSections(raw);
  const memoryValues = parseBase(sections.memory ?? '');
  const networkLines = (sections.network ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    base: parseBase(sections.base ?? ''),
    storage: parseStorage(sections.storage ?? ''),
    memory: {
      totalKb: toNumber(memoryValues.MemTotal) ?? 0,
      availableKb: toNumber(memoryValues.MemAvailable) ?? 0,
      swapTotalKb: toNumber(memoryValues.SwapTotal) ?? 0,
      swapFreeKb: toNumber(memoryValues.SwapFree) ?? 0,
      oomKills: toNumber(memoryValues.OOM_KILL) ?? 0,
    },
    networkInfo: {
      defaultRoutes: networkLines.filter((line) => line.startsWith('default')),
      dns: networkLines.filter((line) => line.startsWith('nameserver')),
      summary: networkLines.filter((line) => /^(TCP|UDP|Total|Sockets)/i.test(line)).slice(0, 4),
      somaxconn: toNumber(parseBase(sections.network ?? '').SOMAXCONN),
      fileHandles: parseBase(sections.network ?? '').FILE_NR,
    },
    securityInfo: parseSecurityStats(sections.security ?? ''),
    health: parseHealth(sections.health ?? ''),
    certificates: parseCertificates(sections.certs ?? ''),
    packages: (sections.packages ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8),
    interfaces: parseInterfaces(sections.interfaces ?? ''),
    units: parseUnits(sections.systemd ?? ''),
    enabled: parseEnabledUnits(sections.enabled ?? ''),
    failed: parseUnits(sections.failed ?? ''),
    containers: parseContainers(sections.docker ?? ''),
    ports: parsePorts(sections.ports ?? ''),
    processes: parseProcesses(sections.processes ?? ''),
    runtimes: parseRuntimes(sections.runtimes ?? ''),
    web: parseWeb(sections.web ?? ''),
    security: parseSecurity(sections.security ?? ''),
    raw: sections,
  };
}

export function systemdState(unit: SystemdUnit): ServiceInfo['state'] {
  if (unit.load === 'failed' || unit.active === 'failed') return 'failed';
  if (unit.active === 'active') return 'running';
  if (unit.active === 'inactive' || unit.active === 'dead') return 'stopped';
  return 'unknown';
}

export function dockerState(status: string): ServiceInfo['state'] {
  if (/^restarting/i.test(status)) return 'failed';
  if (/^up/i.test(status)) return 'running';
  if (/^exited/i.test(status) || /^created/i.test(status)) return 'stopped';
  return 'unknown';
}

/** 将侦察结果转换为统一服务清单。 */
export function toServices(recon: ReconResult): ServiceInfo[] {
  const services: ServiceInfo[] = [];
  for (const unit of recon.units) {
    services.push({
      name: unit.unit,
      kind: 'systemd',
      description: unit.description,
      state: systemdState(unit),
      subState: unit.sub,
      enabled: recon.enabled.has(unit.unit),
      unit: unit.unit,
      ports: [],
    });
  }
  for (const container of recon.containers) {
    services.push({
      name: container.name,
      kind: 'docker',
      description: container.image,
      state: dockerState(container.status),
      subState: container.status,
      image: container.image,
      ports: container.ports
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    });
  }
  return services;
}

/** 把端口与已知服务关联，便于 UI 与模型理解端口用途。 */
export function attachPorts(services: ServiceInfo[], ports: PortInfo[]): ServiceInfo[] {
  return services.map((service) => {
    const needle = service.name.replace(/\.service$/, '');
    const matched = ports.filter((port) => {
      const process = (port.process ?? '').toLowerCase();
      return (
        process === needle.toLowerCase() ||
        process === service.name.toLowerCase() ||
        (service.kind === 'docker' && service.name.toLowerCase().includes(process))
      );
    });
    return {
      ...service,
      ports: [
        ...new Set([...(service.ports ?? []), ...matched.map((port) => `${port.port}/${port.protocol}`)]),
      ],
    };
  });
}
