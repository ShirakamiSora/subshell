import { create } from 'zustand';
import type {
  AgentRunStatus,
  AgentStreamEvent,
  AppInfo,
  AppSettings,
  ChatMessage,
  ConnectionInfo,
  HealthReport,
  IssueStatus,
  MetricSample,
  MonitorEvent,
  PortInfo,
  ProcessInfo,
  ProviderConfig,
  ProviderInput,
  ServerConfig,
  ServerProfile,
  ServerRuntime,
  ServiceInfo,
  TicketRecord,
} from '@shared/types';
import type { ServerInput } from '@shared/api';
import { api } from '../lib/api';
import { translate } from '../lib/i18n';

export type WorkspaceView = 'overview' | 'health' | 'file' | 'terminal' | 'assistant';
export type DialogName = 'server' | 'settings' | 'provider' | 'audit' | 'profile' | 'tunnel';

interface Toast {
  id: number;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface AppState {
  ready: boolean;
  info: AppInfo | null;
  settings: AppSettings | null;
  providers: ProviderConfig[];
  servers: ServerConfig[];
  connections: Record<string, ConnectionInfo>;
  profiles: Record<string, ServerProfile | null>;
  runtimes: Record<string, ServerRuntime>;
  chats: Record<string, ChatMessage[]>;
  agents: Record<string, AgentRunStatus>;
  reports: Record<string, HealthReport>;
  tickets: Record<string, TicketRecord[]>;
  activeServerId: string | null;
  openTabs: string[];
  view: WorkspaceView;
  toast: Toast | null;
  dialog: DialogName | null;
  editingServer: ServerConfig | null;

  bootstrap(): Promise<void>;
  notify(level: Toast['level'], message: string): void;
  dismissToast(): void;

  refreshServers(): Promise<void>;
  openServer(id: string): Promise<void>;
  activate(id: string): void;
  closeTab(id: string): void;
  setView(view: WorkspaceView): void;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  resetHostKey(id: string): Promise<void>;
  refreshRuntime(id: string): Promise<void>;
  rescan(id: string): Promise<void>;
  syncProfile(id: string): Promise<void>;
  exportProfile(id: string): Promise<void>;
  saveProfileNotes(id: string, notes: string): Promise<void>;
  summarize(id: string): Promise<void>;
  refreshHealth(id: string): Promise<void>;
  resolveIssue(id: string, issueId: string, status: IssueStatus): Promise<void>;

  handleConnection(info: ConnectionInfo): void;
  handleProfile(profile: ServerProfile): void;
  handleSample(serverId: string, sample: MetricSample): void;
  handleEvents(serverId: string, events: MonitorEvent[]): void;
  handleStatus(serverId: string, payload: {
    services?: ServiceInfo[];
    ports?: PortInfo[];
    processes?: ProcessInfo[];
  }): void;
  handleAgentEvent(event: AgentStreamEvent): void;
  handleHealth(report: HealthReport): void;
  handleNotice(notice: { level: 'info' | 'warning' | 'error'; message: string }): void;

  sendMessage(id: string, text: string, issueId?: string): Promise<void>;
  decide(id: string, callId: string, approved: boolean, always?: boolean): Promise<void>;
  cancel(id: string): Promise<void>;
  clearChat(id: string): Promise<void>;

  setDialog(dialog: DialogName | null, editing?: ServerConfig | null): void;
  saveServer(input: ServerInput, editingId?: string): Promise<boolean>;
  deleteServer(id: string): Promise<void>;
  startDemo(): Promise<void>;

  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  saveProvider(input: ProviderInput): Promise<boolean>;
  removeProvider(id: string): Promise<void>;
  setActiveProvider(id: string): Promise<void>;
}

// 流式输出节流：把高频 token 合并成 50ms 一次的状态更新，避免每个分片都重渲染整个界面。
let pendingDelta: { serverId: string; messageId: string; text: string } | null = null;
let deltaTimer: ReturnType<typeof setTimeout> | null = null;

function flushDelta(): void {
  deltaTimer = null;
  if (!pendingDelta) return;
  const { serverId, messageId, text } = pendingDelta;
  pendingDelta = null;
  useApp.setState((state) => {
    const chats = state.chats[serverId] ?? [];
    const index = chats.findIndex((message) => message.id === messageId);
    let next: ChatMessage[];
    if (index === -1) {
      next = [...chats, { id: messageId, role: 'assistant', content: text, ts: Date.now() }];
    } else {
      next = [...chats];
      const existing = next[index]!;
      next[index] = { ...existing, content: existing.content + text };
    }
    return { chats: { ...state.chats, [serverId]: next } };
  });
}

function emptyRuntime(serverId: string): ServerRuntime {
  return {
    serverId,
    connection: { serverId, state: 'idle' },
    profile: null,
    samples: [],
    events: [],
    services: [],
    ports: [],
    processes: [],
    monitoring: false,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  return String(error);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  info: null,
  settings: null,
  providers: [],
  servers: [],
  connections: {},
  profiles: {},
  runtimes: {},
  chats: {},
  agents: {},
  reports: {},
  tickets: {},
  activeServerId: null,
  openTabs: [],
  view: 'overview',
  toast: null,
  dialog: null,
  editingServer: null,

  async bootstrap() {
    try {
      const [info, settings, providers, servers, connections] = await Promise.all([
        api.app.info(),
        api.settings.get(),
        api.ai.providers(),
        api.servers.list(),
        api.connection.list(),
      ]);
      const connectionMap: Record<string, ConnectionInfo> = {};
      for (const connection of connections) connectionMap[connection.serverId] = connection;
      set({ info, settings, providers, servers, connections: connectionMap, ready: true });
    } catch (error) {
      set({ ready: true });
      get().notify('error', tr('toast.initFailed', { error: errorMessage(error) }));
    }
  },

  notify(level, message) {
    const id = Date.now();
    set({ toast: { id, level, message } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 4200);
  },

  dismissToast() {
    set({ toast: null });
  },

  async refreshServers() {
    const servers = await api.servers.list();
    set({ servers });
  },

  async openServer(id) {
    const state = get();
    const openTabs = state.openTabs.includes(id) ? state.openTabs : [...state.openTabs, id];
    set({ activeServerId: id, openTabs });
    try {
      const [runtime, profile, chat, status, report, tickets] = await Promise.all([
        api.monitor.snapshot(id),
        api.profile.get(id),
        api.ai.history(id),
        api.ai.status(id),
        api.health.report(id),
        api.health.tickets(id),
      ]);
      set((current) => ({
        runtimes: { ...current.runtimes, [id]: runtime },
        profiles: { ...current.profiles, [id]: profile },
        chats: { ...current.chats, [id]: chat },
        agents: { ...current.agents, [id]: status },
        reports: { ...current.reports, [id]: report },
        tickets: { ...current.tickets, [id]: tickets },
      }));
    } catch (error) {
      get().notify('error', tr('toast.loadServerFailed', { error: errorMessage(error) }));
    }
    const connection = get().connections[id];
    if (!connection || (connection.state !== 'connected' && connection.state !== 'connecting')) {
      void get().connect(id);
    }
  },

  activate(id) {
    const state = get();
    if (state.activeServerId === id) return;
    if (!state.runtimes[id]) {
      void get().openServer(id);
      return;
    }
    set({ activeServerId: id });
  },

  closeTab(id) {
    const state = get();
    const openTabs = state.openTabs.filter((item) => item !== id);
    let activeServerId = state.activeServerId;
    if (activeServerId === id) activeServerId = openTabs.at(-1) ?? null;
    set({ openTabs, activeServerId });
  },

  setView(view) {
    set({ view });
  },

  async connect(id) {
    const current = get().connections[id];
    set({
      connections: {
        ...get().connections,
        [id]: { serverId: id, state: 'connecting', since: current?.since },
      },
    });
    try {
      await api.connection.connect(id);
    } catch (error) {
      get().notify('error', tr('toast.connectFailed', { error: errorMessage(error) }));
    }
  },

  async disconnect(id) {
    await api.connection.disconnect(id);
    await get().refreshRuntime(id);
  },

  async resetHostKey(id) {
    await api.connection.resetHostKey(id);
    get().notify('success', tr('toast.hostKeyReset'));
  },

  async refreshRuntime(id) {
    try {
      const runtime = await api.monitor.snapshot(id);
      set((state) => ({ runtimes: { ...state.runtimes, [id]: runtime } }));
    } catch {
      // 忽略刷新失败
    }
  },

  async rescan(id) {
    try {
      const profile = await api.profile.rescan(id);
      set((state) => ({ profiles: { ...state.profiles, [id]: profile } }));
      await get().refreshRuntime(id);
      get().notify('success', tr('toast.reconDone'));
    } catch (error) {
      get().notify('error', tr('toast.reconFailed', { error: errorMessage(error) }));
    }
  },

  async syncProfile(id) {
    const result = await api.profile.sync(id);
    if (result.ok) get().notify('success', tr('toast.profileSynced', { path: result.path ?? '' }));
    else get().notify('error', tr('toast.syncFailed', { error: result.error ?? '' }));
  },

  async saveProfileNotes(id, notes) {
    try {
      const profile = await api.profile.save(id, { notes });
      set((state) => ({ profiles: { ...state.profiles, [id]: profile } }));
      get().notify('success', tr('toast.notesSaved'));
    } catch (error) {
      get().notify('error', tr('toast.notesFailed', { error: errorMessage(error) }));
    }
  },

  async exportProfile(id) {
    const result = await api.profile.export(id);
    if (result.ok) get().notify('success', tr('toast.exported', { path: result.path ?? '' }));
    else if (!result.canceled) get().notify('error', tr('toast.exportFailed', { error: result.error ?? '' }));
  },

  async summarize(id) {
    get().notify('info', tr('toast.summarizing'));
    const text = await api.profile.summarize(id);
    if (text) {
      await get().refreshRuntime(id);
      get().notify('success', tr('toast.summaryUpdated'));
    } else {
      get().notify('warning', tr('toast.summaryFailed'));
    }
  },

  async refreshHealth(id) {
    try {
      const [report, tickets] = await Promise.all([api.health.report(id), api.health.tickets(id)]);
      set((state) => ({
        reports: { ...state.reports, [id]: report },
        tickets: { ...state.tickets, [id]: tickets },
      }));
    } catch {
      // 体检报告是辅助信息，读取失败不打断主流程
    }
  },

  async resolveIssue(id, issueId, status) {
    try {
      const report = await api.health.resolve(id, issueId, status);
      set((state) => ({ reports: { ...state.reports, [id]: report } }));
    } catch (error) {
      get().notify('error', tr('toast.issueFailed', { error: errorMessage(error) }));
    }
  },

  handleConnection(info) {
    set((state) => ({
      connections: { ...state.connections, [info.serverId]: info },
    }));
  },

  handleProfile(profile) {
    set((state) => ({
      profiles: { ...state.profiles, [profile.serverId]: profile },
      runtimes: {
        ...state.runtimes,
        [profile.serverId]: {
          ...(state.runtimes[profile.serverId] ?? emptyRuntime(profile.serverId)),
          profile,
          services: state.runtimes[profile.serverId]?.services.length
            ? state.runtimes[profile.serverId]!.services
            : profile.services,
        },
      },
    }));
  },

  handleSample(serverId, sample) {
    set((state) => {
      const runtime = state.runtimes[serverId] ?? emptyRuntime(serverId);
      const samples = [...runtime.samples, sample];
      if (samples.length > 2000) samples.splice(0, samples.length - 2000);
      return {
        runtimes: {
          ...state.runtimes,
          [serverId]: { ...runtime, samples, monitoring: true },
        },
      };
    });
  },

  handleEvents(serverId, events) {
    set((state) => {
      const runtime = state.runtimes[serverId] ?? emptyRuntime(serverId);
      const seen = new Set(runtime.events.map((event) => event.id));
      const merged = [...events.filter((event) => !seen.has(event.id)), ...runtime.events].slice(0, 300);
      return { runtimes: { ...state.runtimes, [serverId]: { ...runtime, events: merged } } };
    });
  },

  handleStatus(serverId, payload) {
    set((state) => {
      const runtime = state.runtimes[serverId] ?? emptyRuntime(serverId);
      return {
        runtimes: {
          ...state.runtimes,
          [serverId]: {
            ...runtime,
            services: payload.services ?? runtime.services,
            ports: payload.ports ?? runtime.ports,
            processes: payload.processes ?? runtime.processes,
          },
        },
      };
    });
  },

  handleAgentEvent(event) {
    if (event.type === 'run') {
      set((state) => ({
        agents: { ...state.agents, [event.payload.serverId]: event.payload },
      }));
      return;
    }
    if (event.type === 'delta') {
      if (
        pendingDelta &&
        pendingDelta.serverId === event.serverId &&
        pendingDelta.messageId === event.messageId
      ) {
        pendingDelta.text += event.text;
      } else {
        if (pendingDelta) flushDelta();
        pendingDelta = { serverId: event.serverId, messageId: event.messageId, text: event.text };
      }
      if (!deltaTimer) deltaTimer = setTimeout(flushDelta, 50);
      return;
    }
    if (event.type === 'message') {
      // 完整消息到达前先把挂起的流式内容刷掉，保证顺序正确。
      if (pendingDelta) flushDelta();
      set((state) => {
        const chats = state.chats[event.serverId] ?? [];
        const index = chats.findIndex((message) => message.id === event.message.id);
        const next = [...chats];
        if (index === -1) next.push(event.message);
        else next[index] = event.message;
        return { chats: { ...state.chats, [event.serverId]: next } };
      });
      return;
    }
    if (event.type === 'summary') {
      set((state) => {
        const runtime = state.runtimes[event.serverId] ?? emptyRuntime(event.serverId);
        return {
          runtimes: {
            ...state.runtimes,
            [event.serverId]: { ...runtime, summary: { text: event.text, ts: event.ts } },
          },
        };
      });
      return;
    }
    if (event.type === 'tool') {
      set((state) => {
        const chats = state.chats[event.serverId] ?? [];
        let changed = false;
        const next = chats.map((message) => {
          if (!message.toolCalls?.some((call) => call.id === event.call.id)) return message;
          changed = true;
          return {
            ...message,
            toolCalls: message.toolCalls.map((call) => (call.id === event.call.id ? event.call : call)),
          };
        });
        if (!changed) return {};
        return { chats: { ...state.chats, [event.serverId]: next } };
      });
    }
  },

  handleNotice(notice) {
    get().notify(notice.level === 'error' ? 'error' : notice.level, notice.message);
  },

  handleHealth(report) {
    set((state) => ({ reports: { ...state.reports, [report.serverId]: report } }));
    // 工单会在修复执行后变化，随报告一起刷新。
    void api.health
      .tickets(report.serverId)
      .then((tickets) => set((state) => ({ tickets: { ...state.tickets, [report.serverId]: tickets } })))
      .catch(() => undefined);
  },

  async sendMessage(id, text, issueId) {
    try {
      await api.ai.send(id, text, issueId);
    } catch (error) {
      get().notify('error', errorMessage(error));
    }
  },

  async decide(id, callId, approved, always = false) {
    await api.ai.decide(id, { callId, approved, always });
  },

  async cancel(id) {
    await api.ai.cancel(id);
  },

  async clearChat(id) {
    await api.ai.clear(id);
    set((state) => ({ chats: { ...state.chats, [id]: [] } }));
  },

  setDialog(dialog, editing = null) {
    set({ dialog, editingServer: editing });
  },

  async saveServer(input, editingId) {
    try {
      if (editingId) {
        await api.servers.update(editingId, input);
        await get().refreshServers();
        set({ dialog: null, editingServer: null });
        get().notify('success', tr('toast.serverUpdated'));
        return true;
      }
      const server = await api.servers.create(input);
      await get().refreshServers();
      set({ dialog: null, editingServer: null });
      await get().openServer(server.id);
      return true;
    } catch (error) {
      get().notify('error', tr('toast.saveFailed', { error: errorMessage(error) }));
      return false;
    }
  },

  async deleteServer(id) {
    try {
      await api.servers.remove(id);
      const state = get();
      const openTabs = state.openTabs.filter((item) => item !== id);
      const activeServerId = state.activeServerId === id ? (openTabs.at(-1) ?? null) : state.activeServerId;
      set({ openTabs, activeServerId });
      await get().refreshServers();
      get().notify('success', tr('toast.serverDeleted'));
    } catch (error) {
      get().notify('error', tr('toast.deleteFailed', { error: errorMessage(error) }));
    }
  },

  async startDemo() {
    try {
      const result = await api.demo.start();
      await get().refreshServers();
      await get().openServer(result.serverId);
      get().notify('success', tr('toast.demoStarted'));
    } catch (error) {
      get().notify('error', tr('toast.demoFailed', { error: errorMessage(error) }));
    }
  },

  async saveSettings(patch) {
    try {
      const settings = await api.settings.save(patch);
      set({ settings });
    } catch (error) {
      get().notify('error', tr('toast.settingsFailed', { error: errorMessage(error) }));
    }
  },

  async saveProvider(input) {
    try {
      await api.ai.saveProvider(input);
      const [providers, settings] = await Promise.all([api.ai.providers(), api.settings.get()]);
      set({ providers, settings });
      get().notify('success', tr('toast.providerSaved'));
      return true;
    } catch (error) {
      get().notify('error', tr('toast.saveFailed', { error: errorMessage(error) }));
      return false;
    }
  },

  async removeProvider(id) {
    try {
      await api.ai.removeProvider(id);
      const [providers, settings] = await Promise.all([api.ai.providers(), api.settings.get()]);
      set({ providers, settings });
    } catch (error) {
      get().notify('error', tr('toast.deleteFailed', { error: errorMessage(error) }));
    }
  },

  async setActiveProvider(id) {
    await get().saveSettings({ activeProviderId: id });
  },
}));

/** store 里没有 React 上下文，用当前语言直接翻译 toast 文案。 */
function tr(key: string, vars?: Record<string, string | number>): string {
  return translate(useApp.getState().settings?.language ?? 'zh', key, vars);
}

export function selectRuntime(state: AppState, serverId: string | null): ServerRuntime | null {
  if (!serverId) return null;
  return state.runtimes[serverId] ?? null;
}
