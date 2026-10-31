import type {
  ProfileChecklistItem,
  ProfileRisk,
  ServerConfig,
  ServerProfile,
  ServiceInfo,
} from '../../shared/types';
import { attachPorts, toServices, type ReconResult } from './parse';

function num(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatGb(kb: number): string {
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

function runningCount(services: ServiceInfo[]): number {
  return services.filter((service) => service.state === 'running').length;
}

/** 从运行中的服务名推断服务器角色，作为模型总结之前的规则兜底。 */
export function inferRole(services: ServiceInfo[], runtimes: { name: string }[]): string {
  const terms = [
    ...services.map((service) => service.name.toLowerCase()),
    ...runtimes.map((runtime) => runtime.name.toLowerCase()),
  ];
  const has = (needle: string) => terms.some((term) => term.includes(needle));

  if (has('gitlab') || has('jenkins') || has('runner')) return 'CI / 构建服务器';
  const web = has('nginx') || has('apache2') || has('httpd') || has('caddy');
  const app = has('node') || has('php') || has('python') || has('java') || has('gunicorn') || has('uwsgi');
  if (web && app) return 'Web 应用服务器';
  if (has('docker') || has('containerd') || has('k3s') || has('kubelet')) return '容器宿主';
  if (web || has('haproxy') || has('traefik')) return 'Web / 反向代理';
  if (has('mysql') || has('mariadb') || has('postgres') || has('mongodb') || has('redis') || has('clickhouse')) {
    return '数据库服务器';
  }
  if (has('dnsmasq') || has('bind9') || has('named')) return 'DNS / 基础服务';
  return '通用 Linux 服务器';
}

function buildRisks(recon: ReconResult, services: ServiceInfo[]): ProfileRisk[] {
  const risks: ProfileRisk[] = [];
  const diskTotal = num(recon.base.DISK_TOTAL_KB);
  const diskUsed = num(recon.base.DISK_USED_KB);
  const diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;

  // 多分区与 inode：根分区之外的空间也经常是故障来源。
  for (const volume of recon.storage) {
    if (volume.mount === '/') continue;
    if (volume.usedPercent >= 92) {
      risks.push({
        id: `disk-critical-${volume.mount}`,
        level: 'critical',
        title: `${volume.mount} 占用 ${volume.usedPercent}%`,
        detail: `挂载点 ${volume.mount} 即将写满（剩余 ${formatGb(volume.availableKb)}）。`,
      });
    } else if (volume.usedPercent >= 85) {
      risks.push({
        id: `disk-warning-${volume.mount}`,
        level: 'warning',
        title: `${volume.mount} 占用 ${volume.usedPercent}%`,
        detail: `挂载点 ${volume.mount} 空间偏紧（剩余 ${formatGb(volume.availableKb)}）。`,
      });
    }
    if (volume.inodePercent !== undefined && volume.inodePercent >= 90) {
      risks.push({
        id: `inode-${volume.mount}`,
        level: 'warning',
        title: `${volume.mount} inode 使用 ${volume.inodePercent}%`,
        detail: 'inode 耗尽后无法创建新文件，常见于大量小文件或缓存目录。',
      });
    }
  }

  if (recon.memory.oomKills > 0) {
    risks.push({
      id: 'oom-kills',
      level: 'warning',
      title: `历史发生 ${recon.memory.oomKills} 次 OOM`,
      detail: '内存耗尽时内核会杀掉进程，建议检查内存占用高的服务或增加 Swap。',
    });
  }

  const failedLogins = recon.securityInfo.failedLogins ?? 0;
  if (failedLogins >= 100) {
    risks.push({
      id: 'failed-logins',
      level: 'warning',
      title: `SSH 失败登录 ${failedLogins} 次`,
      detail: '可能存在暴力破解尝试，建议启用 fail2ban、禁用密码登录或限制来源 IP。',
    });
  }

  const upgradable = recon.securityInfo.upgradablePackages ?? 0;
  if (upgradable >= 20) {
    risks.push({
      id: 'upgradable-packages',
      level: 'info',
      title: `${upgradable} 个软件包可升级`,
      detail: '建议在维护窗口更新安全补丁，升级前确认关键服务兼容性。',
    });
  }

  if (recon.health.zombies >= 5) {
    risks.push({
      id: 'zombie-processes',
      level: 'warning',
      title: `存在 ${recon.health.zombies} 个僵尸进程`,
      detail: '父进程未回收子进程，长期积累会耗尽进程表。',
    });
  }

  if (recon.health.journalErrors >= 50) {
    risks.push({
      id: 'journal-errors',
      level: 'warning',
      title: `最近 2 小时有 ${recon.health.journalErrors} 条错误日志`,
      detail: '建议查看 journalctl -p err 定位重复报错的服务。',
    });
  }

  if (recon.health.timeSynced === false) {
    risks.push({
      id: 'time-not-synced',
      level: 'info',
      title: '系统时间未同步',
      detail: '时间漂移会影响证书校验、日志排序与集群通信，建议启用 chrony/ntp。',
    });
  }

  for (const certificate of recon.certificates) {
    if (certificate.daysLeft === undefined) continue;
    if (certificate.daysLeft <= 7) {
      risks.push({
        id: `cert-${certificate.port}`,
        level: 'critical',
        title: `端口 ${certificate.port} 证书即将过期（${certificate.daysLeft} 天）`,
        detail: '证书过期后 HTTPS 将不可用，请尽快续期。',
      });
    } else if (certificate.daysLeft <= 30) {
      risks.push({
        id: `cert-${certificate.port}`,
        level: 'warning',
        title: `端口 ${certificate.port} 证书 ${certificate.daysLeft} 天后过期`,
        detail: '建议在到期前完成续期并重载 Web 服务。',
      });
    }
  }

  if (recon.failed.length) {
    risks.push({
      id: 'failed-units',
      level: 'warning',
      title: `${recon.failed.length} 个服务启动失败`,
      detail: recon.failed.map((unit) => unit.unit).join('、'),
    });
  }
  if (diskPercent >= 92) {
    risks.push({
      id: 'disk-critical',
      level: 'critical',
      title: `根分区磁盘占用 ${diskPercent}%`,
      detail: '磁盘即将写满，可能导致服务异常，请尽快清理日志或扩容。',
    });
  } else if (diskPercent >= 85) {
    risks.push({
      id: 'disk-warning',
      level: 'warning',
      title: `根分区磁盘占用 ${diskPercent}%`,
      detail: '建议检查日志与缓存目录，必要时清理。',
    });
  }

  const sshd = recon.security.sshd.join(' ').toLowerCase();
  if (sshd.includes('passwordauthentication yes')) {
    risks.push({
      id: 'ssh-password-auth',
      level: 'info',
      title: 'SSH 允许密码登录',
      detail: '可以考虑改为仅密钥登录以降低暴力破解风险。',
    });
  }
  if (sshd.includes('permitrootlogin yes')) {
    risks.push({
      id: 'ssh-root-login',
      level: 'warning',
      title: 'SSH 允许 root 直接登录',
      detail: '建议改为 PermitRootLogin no 或 prohibit-password。',
    });
  }
  if (recon.security.rebootRequired) {
    risks.push({
      id: 'reboot-required',
      level: 'info',
      title: '系统等待重启',
      detail: '存在内核或关键库更新，需在维护窗口重启。',
    });
  }

  const stoppedContainers = recon.containers.filter((container) => /^exited/i.test(container.status));
  if (stoppedContainers.length > 0) {
    risks.push({
      id: 'exited-containers',
      level: 'info',
      title: `${stoppedContainers.length} 个容器已退出`,
      detail: stoppedContainers.map((container) => container.name).join('、'),
    });
  }

  const swap = num(recon.base.SWAP_TOTAL_KB);
  const memory = num(recon.base.MEM_TOTAL_KB);
  if (swap === 0 && memory > 0 && memory < 2 * 1024 * 1024) {
    risks.push({
      id: 'no-swap',
      level: 'info',
      title: '未启用 Swap',
      detail: '内存较小的机器建议配置少量 Swap 以应对突发内存压力。',
    });
  }

  const failedByName = services.filter((service) => service.state === 'failed');
  if (failedByName.length && !recon.failed.length) {
    risks.push({
      id: 'failed-services',
      level: 'warning',
      title: `${failedByName.length} 个服务状态异常`,
      detail: failedByName.map((service) => service.name).join('、'),
    });
  }

  return risks;
}

function extractDomains(recon: ReconResult): { domain?: string; root?: string; server?: string }[] {
  const sites: { domain?: string; root?: string; server?: string }[] = [];
  const seen = new Set<string>();
  for (const name of recon.web.nginxSites) {
    const clean = name.replace(/\.conf$/, '');
    if (clean === 'default' || clean === 'default.conf') {
      if (!seen.has('default')) {
        seen.add('default');
        sites.push({ domain: '默认站点', server: 'nginx' });
      }
      continue;
    }
    const domain = clean.match(/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i)?.[0] ?? clean;
    if (!seen.has(domain)) {
      seen.add(domain);
      sites.push({ domain, server: 'nginx' });
    }
  }
  for (const line of recon.web.apacheVhosts) {
    const domain = line.match(/namevhost\s+([^\s(]+)/i)?.[1];
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      sites.push({ domain, server: 'apache' });
    }
  }
  return sites.slice(0, 20);
}

function buildSummary(recon: ReconResult, services: ServiceInfo[], role: string): string {
  const hostname = recon.base.HOSTNAME || '该服务器';
  const osName = recon.base.OS_NAME || recon.base.OS_ID || 'Linux';
  const kernel = recon.base.KERNEL ? `，内核 ${recon.base.KERNEL}` : '';
  const cores = num(recon.base.CPU_CORES);
  const memory = num(recon.base.MEM_TOTAL_KB);
  const diskTotal = num(recon.base.DISK_TOTAL_KB);
  const diskUsed = num(recon.base.DISK_USED_KB);
  const diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
  const uptimeDays = Math.floor(num(recon.base.UPTIME_SECONDS) / 86400);
  const running = services.filter((service) => service.state === 'running');
  const containerCount = services.filter((service) => service.kind === 'docker').length;

  const names = running
    .filter((service) => !service.name.match(/^(systemd-|user@|dbus|rsyslog|cron|getty|ssh\.service)/))
    .map((service) => service.name.replace(/\.service$/, ''))
    .slice(0, 8);

  return [
    `**${hostname}** 是一台 ${osName}${kernel} 的服务器，定位为「${role}」。`,
    `配置 ${cores || '?'} 核 CPU、${memory ? formatGb(memory) : '?'} 内存，根分区已用 ${diskPercent}%，已连续运行 ${uptimeDays} 天。`,
    `当前有 ${runningCount(services)} 个服务在运行${containerCount ? `，其中包含 ${containerCount} 个容器` : ''}。`,
    names.length ? `主要服务：${names.join('、')}。` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 基于侦察结果构建（或合并）服务器档案。 */
export function buildProfile(
  recon: ReconResult,
  server: ServerConfig,
  previous: ServerProfile | null,
): ServerProfile {
  const services = attachPorts(toServices(recon), recon.ports);
  const role = inferRole(services, recon.runtimes);
  const addresses = (recon.base.IP_ADDRS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const now = new Date().toISOString();
  const risks = buildRisks(recon, services);

  // 历史足迹：只记录精简统计，超过 30 条后把最旧记录压缩为摘要文本。
  const previousServices = previous?.services ?? [];
  const stateByName = new Map(previousServices.map((service) => [service.name, service.state]));
  const added = services.filter((service) => !stateByName.has(service.name)).map((service) => service.name);
  const removed = previousServices.filter((service) => !services.some((item) => item.name === service.name));
  const changed = services.filter(
    (service) => stateByName.has(service.name) && stateByName.get(service.name) !== service.state,
  );
  const noteParts = [
    added.length ? `新增 ${added.length} 个服务${added.length <= 3 ? `（${added.slice(0, 3).join('、')}）` : ''}` : '',
    removed.length ? `移除 ${removed.length} 个服务` : '',
    changed.length ? `${changed.length} 个服务状态变化` : '',
  ].filter(Boolean);

  const history = [...(previous?.history ?? [])];
  history.push({
    ts: now,
    services: services.length,
    running: runningCount(services),
    risks: risks.length,
    note: noteParts.join('，') || undefined,
  });
  let historySummary = previous?.historySummary ?? '';
  while (history.length > 30) {
    const oldest = history.shift();
    if (!oldest) break;
    const date = new Date(oldest.ts).toLocaleDateString('zh-CN');
    historySummary += `\n- ${date}：${oldest.services} 服务 / ${oldest.risks} 风险${oldest.note ? `（${oldest.note}）` : ''}`;
  }
  if (historySummary.length > 2000) historySummary = historySummary.slice(-2000);

  return {
    serverId: server.id,
    scannedAt: now,
    hostname: recon.base.HOSTNAME || server.name,
    os: {
      name: recon.base.OS_NAME || recon.base.OS_ID || 'Linux',
      version: recon.base.OS_VERSION || '',
      kernel: recon.base.KERNEL || '',
      arch: recon.base.ARCH || '',
      virtualization: recon.base.VIRT && recon.base.VIRT !== 'none' ? recon.base.VIRT : undefined,
    },
    hardware: {
      cpuModel: recon.base.CPU_MODEL || '',
      cpuCores: Math.round(num(recon.base.CPU_CORES)),
      memTotalKb: Math.round(num(recon.base.MEM_TOTAL_KB)),
      swapTotalKb: Math.round(num(recon.base.SWAP_TOTAL_KB)),
      diskTotalKb: Math.round(num(recon.base.DISK_TOTAL_KB)),
      diskUsedKb: Math.round(num(recon.base.DISK_USED_KB)),
    },
    network: {
      interfaces: recon.interfaces,
      publicIp: addresses[0],
    },
    role,
    summary: previous?.summary?.trim() ? previous.summary : buildSummary(recon, services, role),
    services: services.slice(0, 300),
    runtimes: recon.runtimes,
    webSites: extractDomains(recon),
    storage: recon.storage.length ? recon.storage : undefined,
    securityInfo: {
      failedLogins: recon.securityInfo.failedLogins,
      upgradablePackages: recon.securityInfo.upgradablePackages,
      loginUsers: recon.securityInfo.loginUsers,
      sudoUsers: recon.securityInfo.sudoUsers,
      suidCount: recon.securityInfo.suidCount,
    },
    health: {
      zombieProcesses: recon.health.zombies,
      oomKills: recon.memory.oomKills,
      journalErrors: recon.health.journalErrors,
      timeSynced: recon.health.timeSynced,
      failedUnits: recon.health.failedUnits,
    },
    certificates: recon.certificates,
    history,
    historySummary,
    risks,
    notes: previous?.notes ?? '',
    checklist: previous?.checklist ?? ([] as ProfileChecklistItem[]),
    summarizedAt: previous?.summarizedAt,
    lastUpdated: now,
  };
}
