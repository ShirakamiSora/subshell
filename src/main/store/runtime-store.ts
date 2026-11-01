import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MetricSample, MonitorEvent, PortInfo, ProcessInfo, ServiceInfo } from '../../shared/types';

export interface RuntimeData {
  samples: MetricSample[];
  events: MonitorEvent[];
  services: ServiceInfo[];
  ports: PortInfo[];
  processes: ProcessInfo[];
  summary?: { text: string; ts: number };
  monitoring: boolean;
  updatedAt: number;
}

const empty = (): RuntimeData => ({
  samples: [],
  events: [],
  services: [],
  ports: [],
  processes: [],
  monitoring: false,
  updatedAt: 0,
});

/**
 * 监控运行时数据。样本高频更新，因此内存为主、磁盘按节流写入，
 * 避免每 15 秒重写整个文件。
 */
export class RuntimeStore {
  private cache = new Map<string, RuntimeData>();
  private dirty = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly limits = { samples: 720, events: 300 },
  ) {
    this.timer = setInterval(() => this.flush(), 30_000);
    this.timer.unref?.();
  }

  private file(serverId: string): string {
    return join(this.dataDir, 'servers', serverId, 'runtime.json');
  }

  get(serverId: string): RuntimeData {
    const cached = this.cache.get(serverId);
    if (cached) return cached;
    let data = empty();
    const file = this.file(serverId);
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<RuntimeData>;
        data = { ...empty(), ...parsed };
        // 旧版本文件可能缺字段或类型不一致，统一规范成数组，避免渲染层崩溃。
        data.samples = Array.isArray(data.samples) ? data.samples : [];
        data.events = Array.isArray(data.events) ? data.events : [];
        data.services = Array.isArray(data.services) ? data.services : [];
        data.ports = Array.isArray(data.ports) ? data.ports : [];
        data.processes = Array.isArray(data.processes) ? data.processes : [];
        data.monitoring = false;
      } catch {
        // 损坏时从空数据开始
      }
    }
    this.cache.set(serverId, data);
    return data;
  }

  /** 追加样本并裁剪到保留上限。 */
  appendSample(serverId: string, sample: MetricSample, retention: number): RuntimeData {
    const data = this.get(serverId);
    const samples = [...data.samples, sample];
    const max = Math.max(60, Math.min(retention, 5000));
    data.samples = samples.length > max ? samples.slice(samples.length - max) : samples;
    data.updatedAt = Date.now();
    this.dirty.add(serverId);
    return data;
  }

  appendEvent(serverId: string, event: MonitorEvent): RuntimeData {
    const data = this.get(serverId);
    data.events = [event, ...data.events].slice(0, this.limits.events);
    data.updatedAt = Date.now();
    this.dirty.add(serverId);
    return data;
  }

  acknowledgeEvent(serverId: string, eventId: string): void {
    const data = this.get(serverId);
    data.events = data.events.map((item) => (item.id === eventId ? { ...item, acknowledged: true } : item));
    this.dirty.add(serverId);
  }

  setServices(serverId: string, services: ServiceInfo[]): RuntimeData {
    const data = this.get(serverId);
    data.services = services;
    data.updatedAt = Date.now();
    this.dirty.add(serverId);
    return data;
  }

  setPorts(serverId: string, ports: PortInfo[]): RuntimeData {
    const data = this.get(serverId);
    data.ports = ports;
    data.updatedAt = Date.now();
    this.dirty.add(serverId);
    return data;
  }

  setProcesses(serverId: string, processes: ProcessInfo[]): RuntimeData {
    const data = this.get(serverId);
    data.processes = processes;
    data.updatedAt = Date.now();
    this.dirty.add(serverId);
    return data;
  }

  setSummary(serverId: string, text: string): RuntimeData {
    const data = this.get(serverId);
    data.summary = { text, ts: Date.now() };
    data.updatedAt = Date.now();
    this.dirty.add(serverId);
    return data;
  }

  setMonitoring(serverId: string, monitoring: boolean): void {
    const data = this.get(serverId);
    data.monitoring = monitoring;
    this.dirty.add(serverId);
  }

  flush(): void {
    for (const serverId of this.dirty) {
      const data = this.cache.get(serverId);
      if (!data) continue;
      try {
        const file = this.file(serverId);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, JSON.stringify(data), 'utf8');
      } catch {
        // 保留 dirty，下次重试
        continue;
      }
      this.dirty.delete(serverId);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
  }
}
