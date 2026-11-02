import { EventEmitter } from 'node:events';
import type {
  SecurityFinding,
  SecurityFindingStatus,
  SecurityRemediation,
  SecurityRemediationResult,
  SecurityReport,
  SecurityScan,
  ServerConfig,
} from '../../shared/types';
import type { SshManager } from '../ssh/manager';
import type { ServerStore } from '../store/servers';
import type { ProfileStore } from '../store/profile-store';
import type { RuntimeStore } from '../store/runtime-store';
import type { SettingsStore } from '../store/settings';
import type { ProviderStore } from '../store/provider-store';
import type { AuditStore } from '../store/audit';
import type { SecurityStore } from '../store/security-store';
import type { RecordCommandInput } from '../store/command-history';
import { evaluateSecurity } from './checks';
import { classifyCommand } from '../ai/risk';
import { buildSystemPrompt } from '../ai/prompt';
import { asString, asStringArray, extractJsonObject, resolveActiveProvider } from '../ai/provider-resolver';
import { createLogger } from '../util/logger';

const log = createLogger('security');

/** 只读安全检查脚本：不修改任何配置，也不读取 /etc/shadow 等敏感文件。 */
const SECURITY_SCRIPT = `set +e
export LC_ALL=C LANG=C LANGUAGE=C
printf '\\n##SECTION:LISTEN\\n'
if command -v ss >/dev/null 2>&1; then ss -tulpnH 2>/dev/null | head -300; elif command -v netstat >/dev/null 2>&1; then netstat -tulpn 2>/dev/null | head -300; fi
printf '\\n##SECTION:SSH_CONFIG\\n'
if [ -r /etc/ssh/sshd_config ]; then grep -Ei '^[[:space:]]*(PermitRootLogin|PasswordAuthentication|PermitEmptyPasswords|X11Forwarding|MaxAuthTries|PubkeyAuthentication|Port)[[:space:]]' /etc/ssh/sshd_config 2>/dev/null | head -40; fi
printf '\\n##SECTION:SSHD_EFFECTIVE\\n'
if command -v sshd >/dev/null 2>&1; then sshd -T 2>/dev/null | grep -Ei '^(permitrootlogin|passwordauthentication|permitemptypasswords|maxauthtries|pubkeyauthentication|x11forwarding)' | head -20; fi
printf '\\n##SECTION:FIREWALL\\n'
if command -v ufw >/dev/null 2>&1; then ufw status 2>/dev/null | head -6; fi
if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --state 2>/dev/null; fi
printf '\\n##SECTION:IPTABLES\\n'
if command -v iptables >/dev/null 2>&1; then iptables -S 2>/dev/null | head -60; fi
printf '\\n##SECTION:USERS\\n'
awk -F: '($3==0){print $1}' /etc/passwd 2>/dev/null
printf '\\n##SECTION:SUDO\\n'
getent group sudo 2>/dev/null; getent group wheel 2>/dev/null
printf '\\n##SECTION:UPDATES\\n'
if command -v apt-get >/dev/null 2>&1; then apt-get -s upgrade 2>/dev/null | grep -c '^Inst '; fi
printf '\\n##SECTION:DOCKER_SOCKET\\n'
if [ -S /var/run/docker.sock ]; then stat -c '%a %U' /var/run/docker.sock 2>/dev/null; fi
printf '\\n##SECTION:TIME\\n'
if command -v timedatectl >/dev/null 2>&1; then timedatectl show -p NTPSynchronized --value 2>/dev/null; fi
printf '\\n##SECTION:FAILED_LOGINS\\n'
lastb -n 80 2>/dev/null | wc -l
printf '\\n##SECTION:OS_RELEASE\\n'
cat /etc/os-release 2>/dev/null | head -6`;

export interface SecurityServiceDeps {
  ssh: SshManager;
  servers: ServerStore;
  profiles: ProfileStore;
  runtime: RuntimeStore;
  settings: SettingsStore;
  providers: ProviderStore;
  audit: AuditStore;
  store: SecurityStore;
  recordCommand?: (serverId: string, input: RecordCommandInput) => void;
}

function summarize(scan: Pick<SecurityScan, 'findings'>): string {
  const open = scan.findings.filter((finding) => finding.status === 'open');
  const critical = open.filter((finding) => finding.severity === 'critical').length;
  const warning = open.filter((finding) => finding.severity === 'warning').length;
  const info = open.filter((finding) => finding.severity === 'info').length;
  if (!open.length) return '未发现需要处理的安全问题。';
  return `发现 ${critical} 个严重问题、${warning} 个警告、${info} 个提示。`;
}

function mergeStates(scan: SecurityScan, states: ReturnType<SecurityStore['states']>): SecurityScan {
  return {
    ...scan,
    findings: scan.findings.map((finding) => {
      const state = states[finding.id];
      return state ? { ...finding, status: state.status, updatedAt: state.updatedAt } : finding;
    }),
  };
}

/**
 * 服务器安全检查服务：
 * - 定期执行只读检查，覆盖端口暴露、SSH 配置、防火墙、账户、更新、Docker、时间、证书等常见风险；
 * - 对确认的问题生成修复方案，并结合服务器档案分析与其他服务的冲突；
 * - 修复必须由用户确认，命令仍走本地风险分级。
 */
export class SecurityService extends EventEmitter {
  constructor(private readonly deps: SecurityServiceDeps) {
    super();
  }

  report(serverId: string): SecurityReport {
    const scan = this.deps.store.latest(serverId);
    const merged = scan ? mergeStates(scan, this.deps.store.states(serverId)) : null;
    return {
      serverId,
      scan: merged,
      remediations: this.deps.store.remediations(serverId),
    };
  }

  async scan(
    serverId: string,
    trigger: SecurityScan['trigger'] = 'manual',
  ): Promise<SecurityReport> {
    const server = this.deps.servers.get(serverId);
    if (!server) throw new Error('服务器不存在');
    const startedAt = Date.now();
    const result = await this.deps.ssh.exec(serverId, SECURITY_SCRIPT, { timeoutMs: 40_000 });
    if (!result.stdout.trim()) {
      throw new Error(result.stderr.trim() || '安全检查没有返回结果，请确认服务器已连接');
    }

    const profile = this.deps.profiles.get(serverId);
    const evaluation = evaluateSecurity({
      serverId,
      raw: result.stdout,
      profile,
      states: this.deps.store.states(serverId),
    });

    const scan: SecurityScan = {
      serverId,
      startedAt,
      finishedAt: Date.now(),
      trigger,
      findings: evaluation.findings,
      score: evaluation.score,
      summary: summarize({ findings: evaluation.findings }),
    };
    this.deps.store.saveScan(scan);
    const report = this.report(serverId);
    this.emit('update', serverId, report);
    log.info(`安全扫描完成 ${server.name}：${scan.summary}`);
    return report;
  }

  /** 记录用户对某个风险的处理决定（已修复 / 忽略 / 接受）。 */
  setStatus(serverId: string, findingId: string, status: SecurityFindingStatus): SecurityReport {
    this.deps.store.setStatus(serverId, findingId, status);
    const scan = this.deps.store.latest(serverId);
    if (scan) {
      this.deps.store.saveScan(mergeStates(scan, this.deps.store.states(serverId)));
    }
    const report = this.report(serverId);
    this.emit('update', serverId, report);
    return report;
  }

  /** 让模型为某个风险生成修复步骤，并分析可能与现有服务产生的冲突。 */
  async remediate(serverId: string, findingId: string): Promise<SecurityRemediation> {
    const server = this.deps.servers.get(serverId);
    if (!server) throw new Error('服务器不存在');
    const scan = this.deps.store.latest(serverId);
    const finding = scan?.findings.find((item) => item.id === findingId);
    if (!finding) throw new Error('风险项不存在，请先重新扫描');

    const { provider, config } = resolveActiveProvider(this.deps.providers, this.deps.settings);
    const system = [
      buildSystemPrompt(this.promptContext(server), this.deps.settings.get().language),
      '',
      '## 本次任务：为一条安全风险生成修复方案',
      '你只做规划，不执行命令，也不要调用工具。',
      '必须结合服务器档案中已有的服务、端口、网站与运维笔记，分析修复动作会不会与现有业务冲突（例如修改 SSH 端口没有同步防火墙、停用密码登录但没有配置密钥）。',
      '输出必须是 JSON 对象，不要包在代码块里：',
      '{"summary":"修复思路","steps":[{"title":"步骤标题","commands":["命令"],"risk":"low|medium|high","note":"注意事项"}],',
      '"impact":"修复的影响","conflicts":[{"target":"服务或端口","reason":"冲突原因","severity":"warning|info"}],"verification":["修复后如何验证"]}',
      '要求：命令可直接执行、尽量幂等；不要包含密码；不要提交关机、格式化、删除根目录等破坏性操作；不确定时少给命令并说明人工步骤。',
    ].join('\n');

    const user = [
      `风险项：${finding.title}`,
      `严重程度：${finding.severity}`,
      `详情：${finding.detail}`,
      finding.evidence ? `证据：${finding.evidence}` : '',
      finding.suggestion ? `已有建议：${finding.suggestion}` : '',
      '',
      '服务器上当前运行的服务与监听端口：',
      this.servicesDigest(serverId),
    ]
      .filter(Boolean)
      .join('\n');

    let remediation: SecurityRemediation;
    try {
      const controller = new AbortController();
      const result = await provider.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        tools: [],
        signal: controller.signal,
        timeoutMs: 90_000,
        maxTokens: 1800,
        temperature: 0.1,
      });
      const json = extractJsonObject(result.text);
      if (!json) throw new Error('模型没有返回结构化修复方案');

      const rawSteps = Array.isArray(json.steps) ? json.steps : [];
      const steps = rawSteps.slice(0, 12).flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        const commands = Array.isArray(record.commands)
          ? record.commands.filter((command): command is string => typeof command === 'string' && Boolean(command.trim()))
          : [];
        // 每条命令都重新做本地风险分级，模型不能降低风险等级。
        const risk = commands.reduce<'read' | 'low' | 'medium' | 'high' | 'blocked'>((highest, command) => {
          const level = classifyCommand(command).level;
          const rank = { read: 0, low: 1, medium: 2, high: 3, blocked: 4 } as const;
          return rank[level] > rank[highest] ? level : highest;
        }, 'read');
        return [
          {
            title: asString(record.title) || '修复步骤',
            commands: commands.map((command) => command.trim()),
            risk,
            note: asString(record.note) || undefined,
          },
        ];
      });

      const rawConflicts = Array.isArray(json.conflicts) ? json.conflicts : [];
      const conflicts = rawConflicts.slice(0, 10).flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        const target = asString(record.target);
        const reason = asString(record.reason);
        if (!target || !reason) return [];
        return [
          {
            target,
            reason,
            severity: record.severity === 'warning' ? ('warning' as const) : ('info' as const),
          },
        ];
      });

      remediation = {
        findingId,
        serverId,
        summary: asString(json.summary) || '模型未提供修复摘要',
        steps,
        impact: asString(json.impact),
        conflicts,
        verification: asStringArray(json.verification, 10),
        generatedAt: Date.now(),
        status: 'draft',
      };
      if (!steps.length) remediation.error = '模型没有给出可执行步骤，请参考人工建议';
      log.info(`生成安全修复方案 ${server.name} / ${finding.title}（${config.model}）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn('安全修复方案生成失败', message);
      remediation = {
        findingId,
        serverId,
        summary: '',
        steps: [],
        impact: '',
        conflicts: [],
        verification: [],
        generatedAt: Date.now(),
        status: 'draft',
        error: message,
      };
    }

    this.deps.store.saveRemediation(remediation);
    this.emit('update', serverId, this.report(serverId));
    return remediation;
  }

  /**
   * 执行已确认的修复方案。blocked 命令会被拒绝并中止，
   * 每条命令执行后记录审计与命令历史，便于回溯。
   */
  async applyRemediation(
    serverId: string,
    findingId: string,
    approved: boolean,
  ): Promise<SecurityRemediationResult> {
    if (!approved) throw new Error('修复需要用户明确确认');
    const scan = this.deps.store.latest(serverId);
    const finding = scan?.findings.find((item) => item.id === findingId);
    if (!finding) throw new Error('风险项不存在');
    const remediation = this.deps.store.remediations(serverId).find((item) => item.findingId === findingId);
    if (!remediation) throw new Error('还没有生成修复方案');

    const results: SecurityRemediationResult['results'] = [];
    let failed = false;
    for (const step of remediation.steps) {
      for (const rawCommand of step.commands) {
        const local = classifyCommand(rawCommand);
        if (local.level === 'blocked') {
          results.push({
            command: rawCommand,
            ok: false,
            output: `本地安全策略拒绝执行：${local.reasons.join('；')}`,
          });
          failed = true;
          break;
        }
        const trimmed = rawCommand.trim();
        const sudo = /^sudo\s+/.test(trimmed);
        const command = sudo ? trimmed.replace(/^sudo\s+/, '') : trimmed;
        try {
          const result = await this.deps.ssh.exec(serverId, command, { timeoutMs: 90_000, sudo });
          const ok = result.exitCode === 0;
          results.push({
            command: rawCommand,
            ok,
            output: [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 2000) || '（无输出）',
          });
          this.deps.audit.append({
            serverId,
            actor: 'ai',
            action: 'security-fix',
            detail: rawCommand,
            risk: local.level,
            ok,
          });
          this.deps.recordCommand?.(serverId, {
            command: rawCommand,
            source: 'security',
            risk: local.level,
            ok,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdout: result.stdout,
            stderr: result.stderr,
            purpose: `安全修复：${finding.title}`,
          });
          if (!ok) {
            failed = true;
            break;
          }
        } catch (error) {
          failed = true;
          results.push({
            command: rawCommand,
            ok: false,
            output: error instanceof Error ? error.message : String(error),
          });
          break;
        }
      }
      if (failed) break;
    }

    const next: SecurityRemediation = {
      ...remediation,
      status: failed ? 'failed' : 'applied',
    };
    this.deps.store.saveRemediation(next);
    // 全部成功才把风险标记为已修复；失败时保持待处理，避免误以为问题解决。
    if (!failed) this.deps.store.setStatus(serverId, findingId, 'fixed');

    const report = this.report(serverId);
    this.emit('update', serverId, report);
    return { remediation: next, results };
  }

  remove(serverId: string): void {
    this.deps.store.remove(serverId);
  }

  private servicesDigest(serverId: string): string {
    const profile = this.deps.profiles.get(serverId);
    const runtime = this.deps.runtime.get(serverId);
    const services = runtime.services.length ? runtime.services : (profile?.services ?? []);
    const ports = runtime.ports.length ? runtime.ports : [];
    const lines: string[] = [];
    if (services.length) {
      lines.push(
        ...services.slice(0, 60).map((service) => `- ${service.kind} ${service.name} [${service.state}]`),
      );
    }
    const exposed = ports.filter((port) => /^(0\.0\.0\.0|::|\*)$/.test(port.address));
    if (exposed.length) {
      lines.push(
        ...exposed
          .slice(0, 40)
          .map((port) => `- 监听 ${port.address}:${port.port}/${port.protocol}${port.process ? ` → ${port.process}` : ''}`),
      );
    }
    return lines.join('\n') || '（暂无服务与端口快照）';
  }

  private promptContext(server: ServerConfig) {
    const runtime = this.deps.runtime.get(server.id);
    return {
      server,
      profile: this.deps.profiles.get(server.id),
      sample: runtime.samples.at(-1),
      services: runtime.services,
      events: runtime.events,
    };
  }
}

export type { SecurityFinding, SecurityRemediation };
