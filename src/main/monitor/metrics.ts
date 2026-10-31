import type { MetricSample } from '../../shared/types';

export interface CpuTimes {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
  total: number;
  idleTotal: number;
}

/** 解析 `/proc/stat` 中 `cpu` 行的数值。 */
export function parseCpuTimes(raw: string): CpuTimes | null {
  const parts = raw.trim().split(/\s+/).map(Number);
  if (parts.length < 8 || parts.some((value) => !Number.isFinite(value))) return null;
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return {
    user,
    nice,
    system,
    idle,
    iowait,
    irq,
    softirq,
    steal,
    total,
    idleTotal: idle + iowait,
  };
}

/** 用两次 CPU 累计值计算使用率（0-100）。 */
export function cpuUsage(previous: CpuTimes | null, current: CpuTimes): number {
  if (!previous) return 0;
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idleTotal - previous.idleTotal;
  if (totalDelta <= 0) return 0;
  const usage = 100 * (1 - idleDelta / totalDelta);
  return Math.min(100, Math.max(0, Math.round(usage * 10) / 10));
}

/** 解析一次采集脚本的键值输出。 */
export function parseMetricOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

export interface RawMetricInput {
  values: Record<string, string>;
  cpu: CpuTimes;
  previousCpu: CpuTimes | null;
  previousNet: { rx: number; tx: number; ts: number } | null;
  ts: number;
}

/** 把原始采集值转换为标准指标样本。 */
export function buildSample(input: RawMetricInput): MetricSample {
  const { values, cpu, previousCpu, previousNet, ts } = input;
  const num = (key: string): number => {
    const parsed = Number.parseFloat(values[key] ?? '0');
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const memoryTotal = num('MEM_TOTAL');
  const memoryAvailable = num('MEM_AVAILABLE');
  const swapTotal = num('SWAP_TOTAL');
  const swapFree = num('SWAP_FREE');
  const [diskTotal = 0, diskUsed = 0] = (values.DISK ?? '').split(/\s+/).map(Number);
  const [load1 = 0, load5 = 0, load15 = 0] = (values.LOAD ?? '').split(/\s+/).map(Number);
  const [rx = 0, tx = 0] = (values.NET ?? '').split(/\s+/).map(Number);

  const elapsed = previousNet ? Math.max(1, (ts - previousNet.ts) / 1000) : 0;
  const rxRate = previousNet ? Math.max(0, (rx - previousNet.rx) / elapsed) : 0;
  const txRate = previousNet ? Math.max(0, (tx - previousNet.tx) / elapsed) : 0;

  const memoryUsed = Math.max(0, memoryTotal - memoryAvailable);

  return {
    ts,
    cpuPercent: cpuUsage(previousCpu, cpu),
    memUsedPercent: memoryTotal > 0 ? Math.round((memoryUsed / memoryTotal) * 1000) / 10 : 0,
    memUsedKb: memoryUsed,
    memTotalKb: memoryTotal,
    swapUsedPercent: swapTotal > 0 ? Math.round(((swapTotal - swapFree) / swapTotal) * 1000) / 10 : 0,
    diskUsedPercent: diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 1000) / 10 : 0,
    diskUsedKb: diskUsed,
    diskTotalKb: diskTotal,
    load1: Number.isFinite(load1) ? load1 : 0,
    load5: Number.isFinite(load5) ? load5 : 0,
    load15: Number.isFinite(load15) ? load15 : 0,
    netRxBytesPerSec: Math.round(rxRate),
    netTxBytesPerSec: Math.round(txRate),
    processCount: Math.round(num('PROCS')),
    uptimeSeconds: Math.round(num('UPTIME')),
  };
}
