import type {
  CommandSource,
  ProfileChecklistItem,
  ProfileRisk,
  RiskLevel,
  ServerProfile,
} from '../../shared/types';
import type { SshManager } from '../ssh/manager';
import type { ProfileStore } from '../store/profile-store';
import type { RuntimeStore } from '../store/runtime-store';
import type { ServerStore } from '../store/servers';
import type { AuditStore } from '../store/audit';
import type { SettingsStore } from '../store/settings';
import type { RecordCommandInput } from '../store/command-history';
import type { MonitorService } from '../monitor/collector';
import type { ToolDefinition } from './providers/types';
import {
  classifyCommand,
  classifyServiceAction,
  isValidUnitName,
  validateReadPath,
} from './risk';
import { createLogger } from '../util/logger';

const log = createLogger('tools');

export interface ToolContext {
  serverId: string;
  ssh: SshManager;
  profiles: ProfileStore;
  runtime: RuntimeStore;
  servers: ServerStore;
  audit: AuditStore;
  settings: SettingsStore;
  monitor: MonitorService;
  /** 命令来源（AI / MCP），用于命令历史归因。 */
  source?: CommandSource;
  /** 记录命令历史；未注入时不记录。 */
  recordCommand?: (serverId: string, input: RecordCommandInput) => void;
}

export interface PreparedToolCall {
  name: string;
  args: Record<string, unknown>;
  title: string;
  command?: string;
  risk: RiskLevel;
  impact: string;
  rollback?: string;
  needsApproval: boolean;
  /**
   * 工具类别。智能审批只自动放行 service 类的低风险操作；
   * write（写档案/笔记）与 command（任意命令）始终需要用户确认。
   */
  kind: 'read' | 'service' | 'write' | 'command';
  /** 本地直接拒绝的原因（如危险命令） */
  blocked?: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  command?: string;
  exitCode?: number | null;
  durationMs?: number;
  error?: string;
}

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** 暴露给模型的工具目录。名称与参数保持稳定，避免模型需要重新学习。 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_overview',
    description: '获取服务器当前概览：CPU、内存、磁盘、负载、运行时长、服务统计与最近告警。排查问题的第一步。',
    parameters: schema({}),
  },
  {
    name: 'list_services',
    description: '列出服务器上的 systemd 服务与 Docker 容器，可按运行状态或类型过滤。',
    parameters: schema(
      {
        status: { type: 'string', enum: ['all', 'running', 'stopped', 'failed'], description: '筛选状态，默认 all' },
        kind: { type: 'string', enum: ['all', 'systemd', 'docker'], description: '筛选类型，默认 all' },
      },
      [],
    ),
  },
  {
    name: 'inspect_service',
    description: '查看单个服务的详细状态和最近日志（systemd 或 Docker 容器）。',
    parameters: schema(
      {
        name: { type: 'string', description: '服务名（如 nginx 或 nginx.service）或容器名' },
        kind: { type: 'string', enum: ['systemd', 'docker'], description: '默认 systemd' },
        logLines: { type: 'number', description: '日志行数，默认 40，最大 300' },
      },
      ['name'],
    ),
  },
  {
    name: 'service_action',
    description: '对 systemd 服务或 Docker 容器执行启动、停止、重启、重载、启用、禁用。变更类操作需要用户审批。',
    parameters: schema(
      {
        name: { type: 'string', description: '服务名或容器名' },
        action: {
          type: 'string',
          enum: ['start', 'stop', 'restart', 'reload', 'enable', 'disable'],
          description: '要执行的动作',
        },
        kind: { type: 'string', enum: ['systemd', 'docker'], description: '默认 systemd' },
        sudo: { type: 'boolean', description: '是否需要 sudo 权限，默认 false' },
      },
      ['name', 'action'],
    ),
  },
  {
    name: 'list_processes',
    description: '按 CPU 或内存占用排序列出进程，用于定位资源占用高的程序。',
    parameters: schema(
      {
        sort: { type: 'string', enum: ['cpu', 'mem'], description: '排序字段，默认 cpu' },
        limit: { type: 'number', description: '返回条数，默认 15，最大 50' },
      },
      [],
    ),
  },
  {
    name: 'list_ports',
    description: '列出服务器当前监听的 TCP/UDP 端口及其所属进程。',
    parameters: schema({}),
  },
  {
    name: 'read_logs',
    description: '读取服务日志（journald）或指定日志文件，可按关键字过滤。',
    parameters: schema(
      {
        unit: { type: 'string', description: 'systemd 服务名，与 path 二选一' },
        path: { type: 'string', description: '日志文件绝对路径，例如 /var/log/nginx/error.log' },
        lines: { type: 'number', description: '读取行数，默认 100，最大 500' },
        since: { type: 'string', description: 'journalctl 时间范围，例如 "1 hour ago"' },
        priority: { type: 'string', enum: ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info'], description: 'journald 最低级别' },
        grep: { type: 'string', description: '关键字过滤（不区分大小写）' },
      },
      [],
    ),
  },
  {
    name: 'read_file',
    description: '读取服务器上的文本文件内容（只允许常见配置与日志目录，敏感文件会被拒绝）。',
    parameters: schema(
      {
        path: { type: 'string', description: '文件绝对路径' },
        offset: { type: 'number', description: '起始行号，默认 1' },
        limit: { type: 'number', description: '读取行数，默认 200，最大 500' },
      },
      ['path'],
    ),
  },
  {
    name: 'list_files',
    description: '列出目录内容（名称、大小、权限、修改时间）。',
    parameters: schema(
      {
        path: { type: 'string', description: '目录绝对路径' },
      },
      ['path'],
    ),
  },
  {
    name: 'run_command',
    description:
      '在服务器上执行任意 shell 命令。只读命令会自动执行；变更类命令会先请求用户确认。危险命令会被直接拒绝。',
    parameters: schema(
      {
        command: { type: 'string', description: '要执行的 shell 命令' },
        purpose: { type: 'string', description: '这条命令的目的，展示给用户确认' },
      },
      ['command', 'purpose'],
    ),
  },
  {
    name: 'update_profile',
    description:
      '更新这台服务器的长期档案（角色、综述、运维笔记、风险、检查项）。用于记录你了解到的服务器知识与待办事项。',
    parameters: schema(
      {
        role: { type: 'string', description: '服务器角色，例如「Nginx 反向代理 + Node.js 应用」' },
        summary: { type: 'string', description: '服务器综述（Markdown），面向后续运维的判断依据' },
        notes: { type: 'string', description: '运维笔记（Markdown），会覆盖原笔记' },
        appendNote: { type: 'string', description: '追加一条带时间戳的运维笔记' },
        risks: {
          type: 'array',
          description: '风险列表，会替换原列表',
          items: {
            type: 'object',
            properties: {
              level: { type: 'string', enum: ['info', 'warning', 'critical'] },
              title: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['level', 'title', 'detail'],
            additionalProperties: false,
          },
        },
        checklist: {
          type: 'array',
          description: '检查项列表，会替换原列表',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              done: { type: 'boolean' },
            },
            required: ['text', 'done'],
            additionalProperties: false,
          },
        },
      },
      [],
    ),
  },
  {
    name: 'finish',
    description: '任务完成时调用，提交最终结论。调用后本次运行结束。',
    parameters: schema(
      {
        summary: { type: 'string', description: '给用户的最终总结（Markdown）' },
      },
      ['summary'],
    ),
  },
];

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numArg(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = args[key];
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function clip(text: string, max = 6000): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${clean.slice(0, head)}\n…[中间内容已省略]…\n${clean.slice(-tail)}`;
}

function formatExec(command: string, result: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number }): string {
  const lines = [`命令: ${command}`, `退出码: ${result.exitCode ?? '未获取'}（耗时 ${result.durationMs}ms）`];
  if (result.timedOut) lines.push('⚠ 命令执行超时，远端结果未知。');
  if (result.stdout.trim()) lines.push('输出:', clip(result.stdout, 5000));
  if (result.stderr.trim()) lines.push('stderr:', clip(result.stderr, 1500));
  if (!result.stdout.trim() && !result.stderr.trim()) lines.push('（无输出）');
  return lines.join('\n');
}

function resolveUnit(name: string): string {
  return name.endsWith('.service') ? name : `${name}.service`;
}

/**
 * 内部诊断命令统一使用 C locale。远端若配置了 zh_CN/ja_JP 等 locale，
 * systemd/journalctl/ps 的表头与状态词会被翻译，解析与展示都会失真；
 * 用户自己通过 run_command 执行的命令不加这个前缀，保持其所见即所得。
 */
const C = 'LC_ALL=C ';

function serviceActionCommand(
  name: string,
  action: string,
  kind: 'systemd' | 'docker',
  sudo: boolean,
): string {
  if (kind === 'docker') {
    return `docker ${action} ${name}`;
  }
  const unit = resolveUnit(name);
  const prefix = sudo ? 'sudo ' : '';
  return `${prefix}systemctl ${action} ${unit}`;
}

/** 在不执行命令的前提下，把一次工具调用转换为待展示/待审批的计划。 */
export function prepareToolCall(name: string, args: Record<string, unknown>, _ctx: ToolContext): PreparedToolCall {
  const base = { name, args };

  switch (name) {
    case 'get_overview':
      return { ...base, title: '读取系统概览', risk: 'read', impact: '仅读取系统信息', needsApproval: false, kind: 'read' };
    case 'list_services':
      return { ...base, title: '列出服务状态', risk: 'read', impact: '仅读取服务列表', needsApproval: false, kind: 'read' };
    case 'list_processes':
      return { ...base, title: '查看进程占用', risk: 'read', impact: '仅读取进程信息', needsApproval: false, kind: 'read' };
    case 'list_ports':
      return { ...base, title: '查看监听端口', risk: 'read', impact: '仅读取端口信息', needsApproval: false, kind: 'read' };
    case 'inspect_service': {
      const unit = str(args, 'name');
      return {
        ...base,
        title: `查看服务 ${unit}`,
        risk: 'read',
        impact: '仅读取服务状态与日志',
        needsApproval: false,
        kind: 'read',
      };
    }
    case 'read_logs': {
      const unit = str(args, 'unit');
      const path = str(args, 'path');
      return {
        ...base,
        title: `读取日志 ${unit || path}`,
        risk: 'read',
        impact: '仅读取日志内容',
        needsApproval: false,
        kind: 'read',
      };
    }
    case 'read_file':
      return {
        ...base,
        title: `读取文件 ${str(args, 'path')}`,
        risk: 'read',
        impact: '仅读取文件内容',
        needsApproval: false,
        kind: 'read',
      };
    case 'list_files':
      return {
        ...base,
        title: `列出目录 ${str(args, 'path')}`,
        risk: 'read',
        impact: '仅读取目录列表',
        needsApproval: false,
        kind: 'read',
      };
    case 'service_action': {
      const unit = str(args, 'name');
      const action = str(args, 'action');
      const kind = str(args, 'kind') === 'docker' ? 'docker' : 'systemd';
      const sudo = args.sudo === true;
      const risk = classifyServiceAction(action, unit);
      const command = serviceActionCommand(unit, action, kind, sudo);
      return {
        ...base,
        title: `${actionLabel(action)} ${kind === 'docker' ? '容器' : '服务'} ${unit}`,
        command,
        risk: risk.level,
        impact:
          action === 'stop'
            ? '该服务将停止，依赖它的功能会不可用。'
            : action === 'restart' || action === 'reload'
              ? '服务会短暂中断或重新加载配置，通常持续数秒。'
              : action === 'disable'
                ? '该服务将不再开机自启。'
                : '变更服务运行状态。',
        rollback:
          action === 'stop'
            ? `systemctl start ${resolveUnit(unit)}`
            : action === 'disable'
              ? `systemctl enable ${resolveUnit(unit)}`
              : undefined,
        needsApproval: true,
        kind: 'service',
      };
    }
    case 'run_command': {
      const command = str(args, 'command');
      const assessment = classifyCommand(command);
      return {
        ...base,
        title: '执行命令',
        command,
        risk: assessment.level,
        impact: assessment.reasons.join('；'),
        needsApproval: assessment.level !== 'read',
        kind: 'command',
        blocked: assessment.level === 'blocked' ? assessment.reasons.join('；') : undefined,
      };
    }
    case 'update_profile':
      return {
        ...base,
        title: '更新服务器档案',
        risk: 'low',
        // 档案内容会被注入后续对话的系统提示，因此必须让用户看到模型要写入什么，
        // 否则就存在「模型改写自己的上下文」的注入通道。
        impact: '写入本地保存的服务器知识（会进入后续对话的上下文），不会改动服务器',
        needsApproval: true,
        kind: 'write',
      };
    case 'finish':
      return { ...base, title: '结束任务', risk: 'read', impact: '提交总结', needsApproval: false, kind: 'read' };
    default:
      return {
        ...base,
        title: `未知工具 ${name}`,
        risk: 'medium',
        impact: '未注册的工具',
        needsApproval: true,
        kind: 'command',
        blocked: `不支持的工具：${name}`,
      };
  }
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    start: '启动',
    stop: '停止',
    restart: '重启',
    reload: '重载',
    enable: '启用',
    disable: '禁用',
  };
  return map[action] ?? action;
}

/** 执行已准备的工具调用。调用方负责审批与事件投影。 */
export async function executeTool(prepared: PreparedToolCall, ctx: ToolContext): Promise<ToolResult> {
  const started = Date.now();
  if (prepared.blocked) {
    return { ok: false, output: `操作被本地安全策略拒绝：${prepared.blocked}`, error: prepared.blocked, command: prepared.command };
  }

  try {
    switch (prepared.name) {
      case 'get_overview':
        return await getOverview(ctx);
      case 'list_services':
        return listServices(prepared.args, ctx);
      case 'inspect_service':
        return await inspectService(prepared.args, ctx);
      case 'service_action':
        return await serviceAction(prepared, ctx);
      case 'list_processes':
        return await listProcesses(prepared.args, ctx);
      case 'list_ports':
        return await listPorts(prepared.args, ctx);
      case 'read_logs':
        return await readLogs(prepared.args, ctx);
      case 'read_file':
        return await readFile(prepared.args, ctx);
      case 'list_files':
        return await listFiles(prepared.args, ctx);
      case 'run_command':
        return await runCommand(prepared, ctx);
      case 'update_profile':
        return updateProfile(prepared.args, ctx);
      case 'finish':
        return { ok: true, output: str(prepared.args, 'summary') || '任务完成' };
      default:
        return { ok: false, output: `不支持的工具：${prepared.name}`, error: 'unknown tool' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`工具执行失败 ${prepared.name}`, message);
    return { ok: false, output: `工具执行失败：${message}`, error: message, command: prepared.command };
  } finally {
    log.debug(`工具 ${prepared.name} 耗时 ${Date.now() - started}ms`);
  }
}

async function getOverview(ctx: ToolContext): Promise<ToolResult> {
  const data = ctx.runtime.get(ctx.serverId);
  let sample = data.samples.at(-1);
  if (!sample) {
    sample = await ctx.monitor.sampleOnce(ctx.serverId);
    ctx.runtime.appendSample(ctx.serverId, sample, ctx.settings.get().sampleRetention);
  }
  const profile = ctx.profiles.get(ctx.serverId);
  const running = data.services.filter((service) => service.state === 'running');
  const failed = data.services.filter((service) => service.state === 'failed');
  const recentEvents = data.events.slice(0, 4);

  const lines = [
    `主机: ${profile?.hostname ?? '未知'}  (${profile?.os.name ?? ''} ${profile?.os.version ?? ''}, 内核 ${profile?.os.kernel ?? '?'})`,
    `CPU: ${sample.cpuPercent}%（${profile?.hardware.cpuCores ?? '?'} 核），负载 ${sample.load1.toFixed(2)} / ${sample.load5.toFixed(2)} / ${sample.load15.toFixed(2)}`,
    `内存: ${(sample.memUsedKb / 1024 / 1024).toFixed(1)} GB / ${(sample.memTotalKb / 1024 / 1024).toFixed(1)} GB (${sample.memUsedPercent}%)`,
    `磁盘: 根分区 ${sample.diskUsedPercent}%（已用 ${(sample.diskUsedKb / 1024 / 1024).toFixed(1)} GB / ${(sample.diskTotalKb / 1024 / 1024).toFixed(1)} GB）`,
    `运行时长: ${Math.floor(sample.uptimeSeconds / 86400)} 天，进程数 ${sample.processCount}`,
    `网络: 入 ${formatRate(sample.netRxBytesPerSec)} / 出 ${formatRate(sample.netTxBytesPerSec)}`,
    `服务: 运行中 ${running.length} 个，失败 ${failed.length} 个`,
  ];
  if (failed.length) lines.push(`失败服务: ${failed.map((service) => service.name).join('、')}`);
  if (recentEvents.length) {
    lines.push('最近告警:');
    for (const event of recentEvents) lines.push(`- [${event.severity}] ${event.title}`);
  }
  if (profile) {
    lines.push('', `服务器角色: ${profile.role}`);
    if (profile.summary) lines.push('档案摘要:', clip(profile.summary, 2500));
    if (profile.risks.length) {
      lines.push('已知风险:');
      for (const risk of profile.risks.slice(0, 6)) lines.push(`- [${risk.level}] ${risk.title}：${risk.detail}`);
    }
  } else {
    lines.push('', '尚未生成服务器档案，建议先执行一次完整侦察。');
  }
  return { ok: true, output: lines.join('\n') };
}

function listServices(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const status = str(args, 'status') || 'all';
  const kind = str(args, 'kind') || 'all';
  const data = ctx.runtime.get(ctx.serverId);
  const profile = ctx.profiles.get(ctx.serverId);
  let services = data.services.length ? data.services : (profile?.services ?? []);
  if (status !== 'all') services = services.filter((service) => service.state === status);
  if (kind !== 'all') services = services.filter((service) => service.kind === kind);
  services = services.slice(0, 80);

  if (!services.length) return { ok: true, output: '没有匹配的服务。' };
  const lines = services.map((service) => {
    const ports = service.ports?.length ? ` 端口 ${service.ports.join(',')}` : '';
    return `${service.kind === 'docker' ? '容器' : '服务'} ${service.name} [${service.state}]${ports}${service.description ? ` — ${service.description}` : ''}`;
  });
  return { ok: true, output: lines.join('\n') };
}

async function inspectService(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const name = str(args, 'name');
  const kind = str(args, 'kind') === 'docker' ? 'docker' : 'systemd';
  const logLines = numArg(args, 'logLines', 40, 300);
  if (!name) return { ok: false, output: '缺少服务名' };
  if (!isValidUnitName(name)) return { ok: false, output: '服务名包含非法字符' };

  if (kind === 'docker') {
    const inspect = await ctx.ssh.exec(
      ctx.serverId,
      `${C}docker inspect ${name} --format '{{.State.Status}} | restarts={{.RestartCount}} | image={{.Config.Image}} | started={{.State.StartedAt}}'`,
      { timeoutMs: 15_000 },
    );
    const logs = await ctx.ssh.exec(ctx.serverId, `${C}docker logs --tail ${logLines} ${name} 2>&1`, {
      timeoutMs: 15_000,
    });
    return {
      ok: inspect.exitCode === 0,
      command: `docker inspect ${name}`,
      output: `${formatExec('docker inspect', inspect)}\n\n最近日志:\n${clip(logs.stdout, 4000)}`,
    };
  }

  const unit = resolveUnit(name);
  const status = await ctx.ssh.exec(
    ctx.serverId,
    `${C}systemctl status ${unit} --no-pager -l --lines=${logLines}`,
    { timeoutMs: 20_000 },
  );
  return {
    ok: true,
    command: `systemctl status ${unit}`,
    output: formatExec(`systemctl status ${unit}`, status),
  };
}

async function serviceAction(prepared: PreparedToolCall, ctx: ToolContext): Promise<ToolResult> {
  const name = str(prepared.args, 'name');
  const action = str(prepared.args, 'action');
  const kind = str(prepared.args, 'kind') === 'docker' ? 'docker' : 'systemd';
  const sudo = prepared.args.sudo === true;
  if (!name) return { ok: false, output: '缺少服务名' };
  if (!isValidUnitName(name)) return { ok: false, output: '服务名包含非法字符' };
  if (!prepared.command) return { ok: false, output: '无法生成服务操作命令' };

  const result = await ctx.ssh.exec(ctx.serverId, prepared.command, {
    timeoutMs: 45_000,
    sudo: sudo && kind === 'systemd',
  });

  ctx.audit.append({
    serverId: ctx.serverId,
    actor: 'ai',
    action: `${action} ${name}`,
    detail: prepared.command,
    risk: prepared.risk,
    ok: result.exitCode === 0,
  });
  ctx.recordCommand?.(ctx.serverId, {
    command: prepared.command,
    source: ctx.source ?? 'ai',
    risk: prepared.risk,
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    purpose: `${actionLabel(action)} ${kind === 'docker' ? '容器' : '服务'} ${name}`,
  });

  let verification = '';
  if (kind === 'systemd' && ['start', 'restart', 'reload', 'stop'].includes(action)) {
    const check = await ctx.ssh.exec(ctx.serverId, `${C}systemctl is-active ${resolveUnit(name)}`, {
      timeoutMs: 10_000,
    });
    verification = `\n验证: systemctl is-active → ${check.stdout.trim() || '未知'}`;
  } else if (kind === 'docker') {
    const check = await ctx.ssh.exec(ctx.serverId, `${C}docker inspect ${name} --format '{{.State.Status}}'`, {
      timeoutMs: 10_000,
    });
    verification = `\n验证: 容器状态 → ${check.stdout.trim() || '未知'}`;
  }

  return {
    ok: result.exitCode === 0,
    command: prepared.command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    output: `${formatExec(prepared.command, result)}${verification}`,
  };
}

async function listProcesses(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sort = str(args, 'sort') === 'mem' ? 'mem' : 'cpu';
  const limit = numArg(args, 'limit', 15, 50);
  const data = ctx.runtime.get(ctx.serverId);
  const processes = [...data.processes];

  if (!processes.length) {
    const result = await ctx.ssh.exec(
      ctx.serverId,
      `${C}ps -eo pid=,user=,%cpu=,%mem=,rss=,args= --sort=-%${sort === 'mem' ? 'mem' : 'cpu'} 2>/dev/null | head -${limit + 5}`,
      { timeoutMs: 15_000 },
    );
    return { ok: true, command: 'ps', output: clip(result.stdout, 5000) };
  }

  processes.sort((a, b) => (sort === 'mem' ? b.memPercent - a.memPercent : b.cpuPercent - a.cpuPercent));
  const lines = processes
    .slice(0, limit)
    .map(
      (process) =>
        `PID ${process.pid} ${process.user} CPU ${process.cpuPercent.toFixed(1)}% 内存 ${process.memPercent.toFixed(1)}% ${process.command}`,
    );
  return { ok: true, output: lines.join('\n') };
}

async function listPorts(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const data = ctx.runtime.get(ctx.serverId);
  if (data.ports.length) {
    const lines = data.ports.map(
      (port) => `${port.protocol} ${port.address}:${port.port}${port.process ? ` → ${port.process}${port.pid ? ` (${port.pid})` : ''}` : ''}`,
    );
    return { ok: true, output: lines.join('\n') };
  }
  const result = await ctx.ssh.exec(ctx.serverId, `${C}ss -tulpnH 2>/dev/null || ${C}netstat -tulpn 2>/dev/null`, {
    timeoutMs: 15_000,
  });
  return { ok: true, command: 'ss -tulpn', output: clip(result.stdout, 6000) };
}

async function readLogs(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const unit = str(args, 'unit');
  const path = str(args, 'path');
  const lines = numArg(args, 'lines', 100, 500);
  const since = str(args, 'since');
  const priority = str(args, 'priority');
  const grep = str(args, 'grep');

  if (path) {
    const validation = validateReadPath(path);
    if (!validation.ok) return { ok: false, output: validation.reason ?? '路径不允许' };
    const result = await ctx.ssh.exec(
      ctx.serverId,
      `${C}tail -n ${lines} ${validation.normalized}${grep ? ` | grep -i ${shellArg(grep)}` : ''}`,
      { timeoutMs: 20_000 },
    );
    return {
      ok: result.exitCode === 0,
      command: `tail -n ${lines} ${validation.normalized}`,
      output: formatExec('tail', result),
    };
  }

  if (!unit) return { ok: false, output: '需要提供 unit 或 path' };
  if (!isValidUnitName(unit)) return { ok: false, output: '服务名包含非法字符' };

  const parts = [`${C}journalctl -u ${resolveUnit(unit)} -n ${lines} --no-pager -o short-iso`];
  if (since) parts.push(`--since ${shellArg(since)}`);
  if (priority) parts.push(`-p ${priority}`);
  let command = parts.join(' ');
  if (grep) command += ` | grep -i ${shellArg(grep)}`;

  const result = await ctx.ssh.exec(ctx.serverId, command, { timeoutMs: 25_000 });
  return {
    ok: true,
    command,
    output: formatExec('journalctl', result),
  };
}

async function readFile(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const path = str(args, 'path');
  const offset = numArg(args, 'offset', 1, 100_000);
  const limit = numArg(args, 'limit', 200, 500);
  const validation = validateReadPath(path);
  if (!validation.ok) return { ok: false, output: validation.reason ?? '路径不允许' };
  const end = offset + limit - 1;
  const result = await ctx.ssh.exec(
    ctx.serverId,
    `${C}sed -n '${offset},${end}p' ${validation.normalized}`,
    { timeoutMs: 20_000 },
  );
  return {
    ok: result.exitCode === 0,
    command: `sed -n '${offset},${end}p' ${validation.normalized}`,
    output: `${formatExec('read', result)}`,
  };
}

async function listFiles(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const path = str(args, 'path');
  const validation = validateReadPath(path);
  if (!validation.ok) return { ok: false, output: validation.reason ?? '路径不允许' };
  const result = await ctx.ssh.exec(ctx.serverId, `${C}ls -lah ${validation.normalized}`, { timeoutMs: 15_000 });
  return { ok: result.exitCode === 0, command: `ls -lah ${validation.normalized}`, output: formatExec('ls', result) };
}

async function runCommand(prepared: PreparedToolCall, ctx: ToolContext): Promise<ToolResult> {
  const command = str(prepared.args, 'command');
  if (!command) return { ok: false, output: '缺少命令' };
  const purpose = str(prepared.args, 'purpose');
  const result = await ctx.ssh.exec(ctx.serverId, command, { timeoutMs: 60_000 });
  ctx.audit.append({
    serverId: ctx.serverId,
    actor: 'ai',
    action: 'run_command',
    detail: command,
    risk: prepared.risk,
    ok: result.exitCode === 0,
  });
  ctx.recordCommand?.(ctx.serverId, {
    command,
    source: ctx.source ?? 'ai',
    risk: prepared.risk,
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    purpose: purpose || undefined,
  });
  return {
    ok: result.exitCode === 0,
    command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    output: formatExec(command, result),
  };
}

function updateProfile(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
  const current = ctx.profiles.get(ctx.serverId);
  if (!current) return { ok: false, output: '服务器档案不存在，请先完成侦察' };

  const patch: Partial<ServerProfile> = {};
  const role = str(args, 'role');
  if (role) patch.role = role;
  const summary = str(args, 'summary');
  if (summary) patch.summary = summary;
  const notes = str(args, 'notes');
  const appendNote = str(args, 'appendNote');
  if (notes) patch.notes = notes;
  if (appendNote) {
    const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
    patch.notes = `${patch.notes ?? current.notes}\n\n- **${stamp}**：${appendNote}`.trim();
  }
  if (Array.isArray(args.risks)) {
    patch.risks = (args.risks as ProfileRisk[])
      .filter((risk) => risk && typeof risk.title === 'string')
      .map((risk, index) => ({
        id: `ai-${index}-${Date.now().toString(36)}`,
        level: risk.level === 'critical' || risk.level === 'warning' ? risk.level : 'info',
        title: String(risk.title).slice(0, 200),
        detail: String(risk.detail ?? '').slice(0, 1000),
      }));
  }
  if (Array.isArray(args.checklist)) {
    patch.checklist = (args.checklist as ProfileChecklistItem[])
      .filter((item) => item && typeof item.text === 'string')
      .map((item, index) => ({
        id: `ai-${index}-${Date.now().toString(36)}`,
        text: String(item.text).slice(0, 300),
        done: Boolean(item.done),
      }));
  }

  const saved = ctx.profiles.patch(ctx.serverId, patch);
  ctx.audit.append({
    serverId: ctx.serverId,
    actor: 'ai',
    action: 'update_profile',
    detail: `更新字段：${Object.keys(patch).join(', ') || '无'}`,
    risk: 'low',
    ok: true,
  });
  return {
    ok: true,
    output: `服务器档案已更新。当前角色：${saved.role}；风险 ${saved.risks.length} 条；检查项 ${saved.checklist.length} 条。`,
  };
}

function shellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatRate(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB/s`;
}
