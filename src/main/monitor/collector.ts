import { EventEmitter } from 'node:events';
import type {
  MetricSample,
  MonitorEvent,
  PortInfo,
  ProcessInfo,
  ServiceInfo,
} from '../../shared/types';
import type { SshManager } from '../ssh/manager';
import type { RuntimeStore } from '../store/runtime-store';
import type { SettingsStore } from '../store/settings';
import type { ProfileStore } from '../store/profile-store';
import type { ServerStore } from '../store/servers';
import {
  buildSample,
  parseCpuTimes,
  parseMetricOutput,
  type CpuTimes,
} from './metrics';
import { detectEvents, detectServiceChanges } from './detector';
import {
  parseContainers,
  parsePorts,
  parseProcesses,
  parseUnits,
  dockerState,
  splitSections,
  systemdState,
} from '../recon/parse';
import { createLogger } from '../util/logger';

const log = createLogger('monitor');

export const METRIC_SCRIPT = `set +e
export LC_ALL=C LANG=C LANGUAGE=C
printf 'CPU=%s\\n' "$(awk '/^cpu /{print $2,$3,$4,$5,$6,$7,$8,$9}' /proc/stat 2>/dev/null)"
printf 'MEM_TOTAL=%s\\n' "$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)"
printf 'MEM_AVAILABLE=%s\\n' "$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null)"
printf 'SWAP_TOTAL=%s\\n' "$(awk '/^SwapTotal:/{print $2}' /proc/meminfo 2>/dev/null)"
printf 'SWAP_FREE=%s\\n' "$(awk '/^SwapFree:/{print $2}' /proc/meminfo 2>/dev/null)"
printf 'LOAD=%s\\n' "$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
printf 'UPTIME=%s\\n' "$(awk '{print $1}' /proc/uptime 2>/dev/null)"
printf 'DISK=%s\\n' "$(df -Pk / 2>/dev/null | tail -1 | awk '{print $2, $3}')"
printf 'NET=%s\\n' "$(awk -F'[: ]+' 'NR>2 && $1!="lo"{rx+=$3; tx+=$11} END{printf "%d %d", rx+0, tx+0}' /proc/net/dev 2>/dev/null)"
printf 'PROCS=%s\\n' "$(ps -e --no-headers 2>/dev/null | wc -l | tr -d ' ')"`;

export const STATUS_SCRIPT = `set +e
export LC_ALL=C LANG=C LANGUAGE=C
printf '\\n##SECTION:systemd\\n'
if command -v systemctl >/dev/null 2>&1; then systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null | head -300; fi
printf '\\n##SECTION:failed\\n'
if command -v systemctl >/dev/null 2>&1; then systemctl --failed --no-legend --no-pager --plain 2>/dev/null | head -40; fi
printf '\\n##SECTION:docker\\n'
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null | head -80; fi
printf '\\n##SECTION:ports\\n'
if command -v ss >/dev/null 2>&1; then ss -tulpnH 2>/dev/null | head -200; elif command -v netstat >/dev/null 2>&1; then netstat -tulpn 2>/dev/null | head -200; fi
printf '\\n##SECTION:processes\\n'
ps -eo pid=,user=,%cpu=,%mem=,rss=,args= --sort=-%cpu 2>/dev/null | head -15`;

interface ServerRuntimeState {
  timer: NodeJS.Timeout | null;
  cpu: CpuTimes | null;
  net: { rx: number; tx: number; ts: number } | null;
  failures: number;
  lastStatusAt: number;
}

export interface MonitorEvents {
  sample: (serverId: string, sample: MetricSample) => void;
  events: (serverId: string, events: MonitorEvent[]) => void;
  status: (serverId: string, payload: {
    services?: ServiceInfo[];
    ports?: PortInfo[];
    processes?: ProcessInfo[];
  }) => void;
  error: (serverId: string, message: string) => void;
}

/** 后台监控服务：按服务器维护采样定时器、CPU/网络差分与告警检测。 */
export class MonitorService extends EventEmitter {
  private states = new Map<string, ServerRuntimeState>();

  constructor(
    private readonly ssh: SshManager,
    private readonly runtime: RuntimeStore,
    private readonly settings: SettingsStore,
    private readonly profiles: ProfileStore,
    private readonly servers: ServerStore,
  ) {
    super();
  }

  isMonitoring(serverId: string): boolean {
    return this.states.has(serverId);
  }

  monitoringServers(): string[] {
    return [...this.states.keys()];
  }

  start(serverId: string): void {
    if (this.states.has(serverId)) return;
    const settings = this.settings.get();
    const state: ServerRuntimeState = {
      timer: null,
      cpu: null,
      net: null,
      failures: 0,
      lastStatusAt: 0,
    };
    this.states.set(serverId, state);
    this.runtime.setMonitoring(serverId, true);
    const tick = () => void this.tick(serverId);
    state.timer = setInterval(tick, Math.max(5, settings.monitorIntervalSec) * 1000);
    state.timer.unref?.();
    void tick();
  }

  stop(serverId: string): void {
    const state = this.states.get(serverId);
    if (!state) return;
    if (state.timer) clearInterval(state.timer);
    this.states.delete(serverId);
    this.runtime.setMonitoring(serverId, false);
  }

  stopAll(): void {
    for (const serverId of [...this.states.keys()]) this.stop(serverId);
  }

  private async tick(serverId: string): Promise<void> {
    const state = this.states.get(serverId);
    if (!state) return;
    try {
      await this.collect(serverId, state);
      state.failures = 0;
    } catch (error) {
      state.failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', serverId, message);
      if (state.failures >= 3) {
        log.warn(`监控连续失败，尝试重连: ${serverId}`);
        try {
          await this.ssh.ensureConnected(serverId);
        } catch {
          // 连接失败时保持定时器，等待下次重试
        }
      }
    }
  }

  /** 执行一次采样（也用于连接后立即出数）。 */
  async sampleOnce(serverId: string): Promise<MetricSample> {
    const state = this.states.get(serverId) ?? {
      timer: null,
      cpu: null,
      net: null,
      failures: 0,
      lastStatusAt: 0,
    };
    const result = await this.ssh.exec(serverId, METRIC_SCRIPT, { timeoutMs: 15_000 });
    const values = parseMetricOutput(result.stdout);
    const cpu = parseCpuTimes(values.CPU ?? '');
    if (!cpu) throw new Error(result.stderr || '无法读取 /proc/stat');
    const sample = buildSample({
      values,
      cpu,
      previousCpu: state.cpu,
      previousNet: state.net,
      ts: Date.now(),
    });
    state.cpu = cpu;
    state.net = {
      rx: Number.parseFloat((values.NET ?? '0 0').split(/\s+/)[0] ?? '0') || 0,
      tx: Number.parseFloat((values.NET ?? '0 0').split(/\s+/)[1] ?? '0') || 0,
      ts: sample.ts,
    };
    return sample;
  }

  private async collect(serverId: string, state: ServerRuntimeState): Promise<void> {
    const settings = this.settings.get();
    const sample = await this.sampleOnce(serverId);
    this.runtime.appendSample(serverId, sample, settings.sampleRetention);
    this.emit('sample', serverId, sample);

    const data = this.runtime.get(serverId);
    const profile = this.profiles.get(serverId);
    const newEvents = detectEvents({
      serverId,
      samples: data.samples,
      events: data.events,
      cpuCores: profile?.hardware.cpuCores,
    });
    if (newEvents.length) {
      for (const event of newEvents) this.runtime.appendEvent(serverId, event);
      this.emit('events', serverId, newEvents);
    }

    const now = Date.now();
    if (now - state.lastStatusAt > 60_000) {
      state.lastStatusAt = now;
      await this.refreshStatus(serverId);
    }
  }

  /** 刷新服务、端口与进程快照；同时发现监控期间新增的服务。 */
  async refreshStatus(serverId: string): Promise<void> {
    const result = await this.ssh.exec(serverId, STATUS_SCRIPT, { timeoutMs: 25_000 });
    const sections = splitSections(result.stdout);
    const units = parseUnits(sections.systemd ?? '');
    const unitByName = new Map(units.map((unit) => [unit.unit, unit]));
    const failed = parseUnits(sections.failed ?? '');
    const failedSet = new Set(failed.map((unit) => unit.unit));
    const containers = parseContainers(sections.docker ?? '');
    const ports = parsePorts(sections.ports ?? '');
    const processes = parseProcesses(sections.processes ?? '');

    const profile = this.profiles.get(serverId);
    const current = this.runtime.get(serverId).services;
    const baseServices = current.length ? current : (profile?.services ?? []);
    const merged: ServiceInfo[] = baseServices
      .filter((service) => service.kind === 'systemd')
      .map((service) => {
        const unit = unitByName.get(service.name);
        return {
          ...service,
          state: unit ? systemdState(unit) : failedSet.has(service.name) ? 'failed' : service.state,
          subState: unit?.sub ?? service.subState,
          description: service.description || unit?.description,
        };
      });

    // 监控期间新安装/启用的服务：加入列表并记录事件，后续状态变化也会被追踪。
    const knownNames = new Set(baseServices.map((service) => service.name));
    const discovered = units.filter((unit) => !knownNames.has(unit.unit));
    if (knownNames.size > 0 && discovered.length > 0) {
      for (const unit of discovered.slice(0, 10)) {
        merged.push({
          name: unit.unit,
          kind: 'systemd',
          state: systemdState(unit),
          subState: unit.sub,
          enabled: false,
          description: unit.description,
          ports: [],
        });
        this.runtime.appendEvent(serverId, {
          id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          serverId,
          ts: Date.now(),
          severity: 'info',
          kind: 'service',
          title: `发现新服务：${unit.unit}`,
          detail: '监控期间检测到新的 systemd 服务，已加入服务列表并开始跟踪状态。',
        });
      }
    }

    for (const container of containers) {
      const existing = merged.find((service) => service.name === container.name);
      const next: ServiceInfo = {
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
      };
      if (existing) Object.assign(existing, next);
      else merged.push(next);
    }

    const before = this.runtime.get(serverId).services;
    const changes = detectServiceChanges(serverId, before, merged);
    if (changes.length) {
      for (const event of changes) this.runtime.appendEvent(serverId, event);
      this.emit('events', serverId, changes);
    }

    this.runtime.setServices(serverId, merged);
    this.runtime.setPorts(serverId, ports);
    this.runtime.setProcesses(serverId, processes);
    this.emit('status', serverId, { services: merged, ports, processes });
  }

  dispose(): void {
    this.stopAll();
  }
}
