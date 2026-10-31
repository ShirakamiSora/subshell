import type { ChatOptions, ChatResult, Provider, ToolCallRequest } from './types';

const KNOWN_SERVICES = [
  'nginx',
  'apache2',
  'httpd',
  'mysql',
  'mariadb',
  'postgresql',
  'redis',
  'redis-server',
  'docker',
  'docker.service',
  'ssh',
  'sshd',
  'php-fpm',
  'gunicorn',
  'node',
  'pm2-root',
  'supervisor',
  'jenkins',
  'gitlab-runner',
  'cron',
  'fail2ban',
];

function extractService(text: string): string {
  for (const service of KNOWN_SERVICES) {
    if (text.toLowerCase().includes(service)) return service;
  }
  const match = text.match(/(?:服务|service)\s*[:：]?\s*([a-zA-Z0-9@_.:-]{2,})/i);
  return match?.[1] ?? 'nginx';
}

function toolCall(name: string, args: Record<string, unknown>): ToolCallRequest {
  return {
    id: `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    arguments: JSON.stringify(args),
  };
}

/**
 * 内置演示模型：不需要 API Key，用固定剧本驱动完整工具链，
 * 用于离线体验、端到端测试与 UI 验收。
 */
export class MockProvider implements Provider {
  readonly kind = 'mock';

  async chat(options: ChatOptions): Promise<ChatResult> {
    const last = options.messages.at(-1);
    const lastUser = [...options.messages].reverse().find((message) => message.role === 'user')?.content ?? '';

    // 无工具场景（状态摘要、连通性测试）直接返回文本。
    if (!options.tools.length) {
      const text = this.plainSummary(lastUser);
      await this.stream(text, options.onDelta);
      return { text, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
    }

    if (last?.role === 'tool') {
      const text = this.summarize(options.messages);
      await this.stream(text, options.onDelta);
      return { text, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
    }

    const text = lastUser.trim();
    const calls: ToolCallRequest[] = [];

    if (/重启|restart|重载|reload/i.test(text)) {
      calls.push(toolCall('service_action', { name: extractService(text), action: /重载|reload/i.test(text) ? 'reload' : 'restart' }));
    } else if (/停止|stop|关闭/i.test(text)) {
      calls.push(toolCall('service_action', { name: extractService(text), action: 'stop' }));
    } else if (/启动|start|开启/i.test(text)) {
      calls.push(toolCall('service_action', { name: extractService(text), action: 'start' }));
    } else if (/日志|log|报错/i.test(text)) {
      calls.push(toolCall('read_logs', { unit: extractService(text), lines: 60 }));
    } else if (/进程|cpu|内存|memory/i.test(text)) {
      calls.push(toolCall('list_processes', { sort: 'cpu', limit: 10 }));
    } else if (/端口|port/i.test(text)) {
      calls.push(toolCall('list_ports', {}));
    } else if (/磁盘|空间|disk|df/i.test(text)) {
      calls.push(toolCall('get_overview', {}));
      calls.push(toolCall('run_command', { command: 'df -h', purpose: '查看各分区磁盘占用' }));
    } else if (/状态|健康|概况|怎么样|检查/i.test(text)) {
      calls.push(toolCall('get_overview', {}));
      calls.push(toolCall('list_services', { status: 'running' }));
    } else if (/服务/.test(text)) {
      calls.push(toolCall('list_services', {}));
    } else {
      calls.push(toolCall('get_overview', {}));
    }

    return { text: '', toolCalls: calls, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  private plainSummary(question: string): string {
    if (/ok/i.test(question)) return 'ok';
    return [
      '服务器整体运行平稳。CPU 与内存处于正常区间，根分区空间充足，没有持续的资源压力。',
      '需要留意两处：fail2ban 处于 failed 状态（socket 目录权限问题），queue-worker 容器在 2 小时前退出。建议先查看这两个服务的日志，再决定是否重启或修复。',
      '其余服务运行正常，端口监听与预期一致。',
    ].join('');
  }

  private summarize(messages: ChatOptions['messages']): string {
    const toolResults = messages.filter((message) => message.role === 'tool').slice(-4);
    const joined = toolResults.map((item) => item.content).join('\n');

    if (/重启|restart|started|active/i.test(joined) && /restart|start|stop/i.test(joined)) {
      return [
        '操作已执行完成。',
        '',
        '根据执行结果：',
        toolResults.map((item) => `- ${truncate(item.content, 600)}`).join('\n'),
        '',
        '建议再观察 1-2 分钟，确认服务稳定、错误日志没有新增。如果需要，我可以继续帮你查看实时日志或端口监听情况。',
      ].join('\n');
    }

    const lines: string[] = ['已完成检查，下面是这台服务器的当前情况：', ''];
    for (const item of toolResults) {
      lines.push(truncate(item.content, 900));
      lines.push('');
    }
    lines.push('如果需要，我可以进一步查看具体服务的日志、配置文件，或帮你重启异常服务。');
    return lines.join('\n');
  }

  private async stream(text: string, onDelta?: (chunk: string) => void): Promise<void> {
    if (!onDelta) return;
    const chunks = text.match(/[\s\S]{1,24}/g) ?? [];
    for (const chunk of chunks) {
      onDelta(chunk);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
  }
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
