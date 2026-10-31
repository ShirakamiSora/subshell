import type { MetricSample, MonitorEvent, MonitorSeverity, ServiceInfo } from '../../shared/types';

export interface DetectionInput {
  serverId: string;
  samples: MetricSample[];
  events: MonitorEvent[];
  cpuCores?: number;
  now?: number;
}

const COOLDOWN_MS = 10 * 60 * 1000;

function makeEvent(
  serverId: string,
  kind: MonitorEvent['kind'],
  severity: MonitorSeverity,
  title: string,
  detail: string,
  now: number,
): MonitorEvent {
  return {
    id: `evt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    serverId,
    ts: now,
    severity,
    kind,
    title,
    detail,
  };
}

function recentlyReported(events: MonitorEvent[], kind: MonitorEvent['kind'], now: number): boolean {
  return events.some((event) => event.kind === kind && now - event.ts < COOLDOWN_MS);
}

/** 基于最近样本与阈值生成资源类告警，并做同类告警冷却。 */
export function detectEvents(input: DetectionInput): MonitorEvent[] {
  const { serverId, samples, events, cpuCores = 0 } = input;
  const now = input.now ?? Date.now();
  const current = samples.at(-1);
  if (!current) return [];

  const result: MonitorEvent[] = [];
  const recent = samples.slice(-4);
  const sustained = (predicate: (sample: MetricSample) => boolean) =>
    recent.length >= 3 && recent.every(predicate);

  if (sustained((sample) => sample.cpuPercent >= 90) && !recentlyReported(events, 'cpu', now)) {
    const severity: MonitorSeverity = current.cpuPercent >= 97 ? 'critical' : 'warning';
    result.push(
      makeEvent(
        serverId,
        'cpu',
        severity,
        `CPU 使用率持续偏高（${current.cpuPercent}%）`,
        `最近 ${recent.length} 次采样均高于 90%，当前负载 ${current.load1.toFixed(2)}。可以让 AI 助手分析高占用进程。`,
        now,
      ),
    );
  }

  if (current.memUsedPercent >= 92 && !recentlyReported(events, 'memory', now)) {
    result.push(
      makeEvent(
        serverId,
        'memory',
        current.memUsedPercent >= 96 ? 'critical' : 'warning',
        `内存使用率 ${current.memUsedPercent}%`,
        `已用 ${(current.memUsedKb / 1024 / 1024).toFixed(1)} GB / ${(current.memTotalKb / 1024 / 1024).toFixed(1)} GB，Swap 使用 ${current.swapUsedPercent}%。`,
        now,
      ),
    );
  }

  if (current.diskUsedPercent >= 90 && !recentlyReported(events, 'disk', now)) {
    result.push(
      makeEvent(
        serverId,
        'disk',
        current.diskUsedPercent >= 95 ? 'critical' : 'warning',
        `根分区磁盘占用 ${current.diskUsedPercent}%`,
        `剩余 ${((current.diskTotalKb - current.diskUsedKb) / 1024 / 1024).toFixed(1)} GB。`,
        now,
      ),
    );
  }

  if (cpuCores > 0 && current.load1 > cpuCores * 2 && !recentlyReported(events, 'load', now)) {
    result.push(
      makeEvent(
        serverId,
        'load',
        'warning',
        `系统负载偏高（${current.load1.toFixed(2)}）`,
        `已超过 ${cpuCores} 核 CPU 的两倍，持续高负载可能导致响应变慢。`,
        now,
      ),
    );
  }

  return result;
}

/** 比较两次服务快照，生成服务状态变化事件。 */
export function detectServiceChanges(
  serverId: string,
  previous: ServiceInfo[],
  current: ServiceInfo[],
  now = Date.now(),
): MonitorEvent[] {
  if (!previous.length) return [];
  const result: MonitorEvent[] = [];
  const previousMap = new Map(previous.map((service) => [service.name, service]));
  for (const service of current) {
    const before = previousMap.get(service.name);
    if (!before) continue;
    if (before.state === 'running' && service.state === 'failed') {
      result.push(
        makeEvent(
          serverId,
          'service',
          'critical',
          `服务异常退出：${service.name}`,
          `${service.name} 从运行中变为 failed。可以让 AI 助手查看日志并决定是否重启。`,
          now,
        ),
      );
    } else if (before.state === 'running' && service.state === 'stopped') {
      result.push(
        makeEvent(serverId, 'service', 'warning', `服务停止：${service.name}`, `${service.name} 已停止运行。`, now),
      );
    }
  }
  return result;
}
