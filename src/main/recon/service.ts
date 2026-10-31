import { EventEmitter } from 'node:events';
import type { ServerProfile } from '../../shared/types';
import type { SshManager } from '../ssh/manager';
import type { ProfileStore } from '../store/profile-store';
import type { RuntimeStore } from '../store/runtime-store';
import type { ServerStore } from '../store/servers';
import type { SettingsStore } from '../store/settings';
import { parseRecon } from './parse';
import { buildProfile } from './build-profile';
import { reconCommand } from './script';
import { createLogger } from '../util/logger';

const log = createLogger('recon');

export interface ReconDeps {
  ssh: SshManager;
  servers: ServerStore;
  profiles: ProfileStore;
  runtime: RuntimeStore;
  settings: SettingsStore;
}

/** 执行只读侦察并生成服务器档案。 */
export class ReconService extends EventEmitter {
  constructor(private readonly deps: ReconDeps) {
    super();
  }

  async run(serverId: string): Promise<ServerProfile> {
    const server = this.deps.servers.get(serverId);
    if (!server) throw new Error('服务器不存在');

    await this.deps.ssh.ensureConnected(serverId);
    log.info(`开始侦察 ${server.name}`);
    const result = await this.deps.ssh.exec(serverId, reconCommand(), { timeoutMs: 120_000 });
    if (!result.stdout.trim()) {
      throw new Error(result.stderr || '侦察没有返回数据');
    }

    const recon = parseRecon(result.stdout);
    const previous = this.deps.profiles.get(serverId);
    const profile = buildProfile(recon, server, previous);
    this.deps.profiles.save(serverId, profile);
    this.deps.runtime.setServices(serverId, profile.services);
    this.deps.runtime.setPorts(serverId, recon.ports);
    this.deps.runtime.setProcesses(serverId, recon.processes);

    if (this.deps.settings.get().syncProfileToServer) {
      try {
        await this.syncToServer(serverId, profile);
      } catch (error) {
        log.warn('档案同步到服务器失败', error);
      }
    }

    log.info(`侦察完成 ${server.name}: ${profile.services.length} 个服务，角色 ${profile.role}`);
    this.emit('profile', profile);
    return profile;
  }

  /** 把档案以 Markdown 写入远端 `~/.subshell/profile.md`。 */
  async syncToServer(serverId: string, profile: ServerProfile): Promise<string> {
    const markdown = profileToMarkdown(profile);
    const connection = this.deps.ssh.getConnection(serverId);
    if (!connection) throw new Error('连接未建立');
    const setup = await this.deps.ssh.exec(serverId, 'mkdir -p ~/.subshell && echo ok', { timeoutMs: 10_000 });
    if (setup.exitCode !== 0) throw new Error(setup.stderr || '无法创建 ~/.subshell 目录');
    await connection.writeRemoteFile('.subshell/profile.md', markdown);
    return '~/.subshell/profile.md';
  }
}

/** 生成可读、可归档的服务器档案 Markdown。 */
export function profileToMarkdown(profile: ServerProfile): string {
  const gb = (kb: number) => `${(kb / 1024 / 1024).toFixed(1)} GB`;
  const lines = [
    `# ${profile.hostname} 服务器档案`,
    '',
    `> 由 subshell 生成于 ${new Date(profile.scannedAt).toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '## 基本信息',
    '',
    `- 系统：${profile.os.name} ${profile.os.version}（${profile.os.kernel}，${profile.os.arch}）`,
    `- 角色：${profile.role}`,
    `- 配置：${profile.hardware.cpuCores} 核 / ${gb(profile.hardware.memTotalKb)} 内存 / ${gb(profile.hardware.diskTotalKb)} 磁盘`,
    `- 根分区已用：${gb(profile.hardware.diskUsedKb)}`,
    profile.network.publicIp ? `- 地址：${profile.network.publicIp}` : '',
    '',
    '## 服务',
    '',
  ].filter(Boolean);
  for (const service of profile.services.slice(0, 100)) {
    lines.push(`- ${service.name}（${service.kind}）：${service.state}${service.description ? ` — ${service.description}` : ''}`);
  }
  if (profile.storage?.length) {
    lines.push('', '## 存储', '');
    for (const volume of profile.storage) {
      const inode = volume.inodePercent !== undefined ? `，inode ${volume.inodePercent}%` : '';
      lines.push(`- ${volume.mount}：${volume.usedPercent}%（剩余 ${gb(volume.availableKb)}${inode}）`);
    }
  }
  if (profile.health) {
    lines.push(
      '',
      '## 健康检查',
      '',
      `- 僵尸进程：${profile.health.zombieProcesses}`,
      `- OOM 次数：${profile.health.oomKills}`,
      `- 最近 2 小时错误日志：${profile.health.journalErrors} 条`,
      `- 时间同步：${profile.health.timeSynced === undefined ? '未知' : profile.health.timeSynced ? '正常' : '未同步'}`,
    );
  }
  if (profile.securityInfo) {
    const security = profile.securityInfo;
    lines.push('', '## 安全', '');
    if (security.failedLogins !== undefined) lines.push(`- 失败登录次数：${security.failedLogins}`);
    if (security.upgradablePackages !== undefined) lines.push(`- 可升级软件包：${security.upgradablePackages}`);
    if (security.loginUsers?.length) lines.push(`- 当前登录用户：${security.loginUsers.join('、')}`);
    if (security.sudoUsers?.length) lines.push(`- sudo 用户：${security.sudoUsers.join('、')}`);
    if (security.suidCount !== undefined) lines.push(`- SUID 文件数量：${security.suidCount}`);
  }
  if (profile.certificates?.length) {
    lines.push('', '## 证书', '');
    for (const certificate of profile.certificates) {
      lines.push(`- 端口 ${certificate.port}：${certificate.daysLeft ?? '?'} 天后过期`);
    }
  }
  if (profile.history?.length) {
    lines.push('', '## 历史足迹', '');
    for (const entry of profile.history.slice(-5)) {
      const date = new Date(entry.ts).toLocaleString('zh-CN', { hour12: false });
      lines.push(`- ${date}：${entry.services} 服务 / ${entry.risks} 风险${entry.note ? `（${entry.note}）` : ''}`);
    }
  }
  if (profile.historySummary?.trim()) {
    lines.push('', '## 更早历史', profile.historySummary.trim());
  }
  if (profile.risks.length) {
    lines.push('', '## 风险', '');
    for (const risk of profile.risks) lines.push(`- [${risk.level}] **${risk.title}**：${risk.detail}`);
  }
  if (profile.checklist.length) {
    lines.push('', '## 检查项', '');
    for (const item of profile.checklist) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
  }
  if (profile.notes.trim()) lines.push('', '## 运维笔记', '', profile.notes);
  if (profile.summary.trim()) lines.push('', '## 综述', '', profile.summary);
  return `${lines.join('\n')}\n`;
}
