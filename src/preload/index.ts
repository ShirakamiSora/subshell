import { contextBridge, ipcRenderer } from 'electron';
import type { SubshellApi, EventMap, EventChannel } from '../shared/api';

const api: SubshellApi = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
  },
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    create: (input) => ipcRenderer.invoke('servers:create', input),
    update: (id, input) => ipcRenderer.invoke('servers:update', id, input),
    remove: (id) => ipcRenderer.invoke('servers:remove', id),
    test: (input) => ipcRenderer.invoke('servers:test', input),
  },
  connection: {
    connect: (serverId) => ipcRenderer.invoke('connection:connect', serverId),
    disconnect: (serverId) => ipcRenderer.invoke('connection:disconnect', serverId),
    list: () => ipcRenderer.invoke('connection:list'),
    resetHostKey: (serverId) => ipcRenderer.invoke('connection:resetHostKey', serverId),
  },
  terminal: {
    open: (serverId, cols, rows) => ipcRenderer.invoke('terminal:open', serverId, cols, rows),
    write: (sessionId, data) => ipcRenderer.invoke('terminal:write', sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    close: (sessionId) => ipcRenderer.invoke('terminal:close', sessionId),
  },
  exec: (serverId, command, options) => ipcRenderer.invoke('exec', serverId, command, options),
  monitor: {
    snapshot: (serverId) => ipcRenderer.invoke('monitor:snapshot', serverId),
    start: (serverId) => ipcRenderer.invoke('monitor:start', serverId),
    stop: (serverId) => ipcRenderer.invoke('monitor:stop', serverId),
    acknowledge: (serverId, eventId) => ipcRenderer.invoke('monitor:acknowledge', serverId, eventId),
  },
  profile: {
    get: (serverId) => ipcRenderer.invoke('profile:get', serverId),
    rescan: (serverId) => ipcRenderer.invoke('profile:rescan', serverId),
    save: (serverId, patch) => ipcRenderer.invoke('profile:save', serverId, patch),
    summarize: (serverId) => ipcRenderer.invoke('profile:summarize', serverId),
    sync: (serverId) => ipcRenderer.invoke('profile:sync', serverId),
    export: (serverId) => ipcRenderer.invoke('profile:export', serverId),
    markdown: (serverId) => ipcRenderer.invoke('profile:markdown', serverId),
  },
  ai: {
    providers: () => ipcRenderer.invoke('ai:providers'),
    saveProvider: (input) => ipcRenderer.invoke('ai:saveProvider', input),
    removeProvider: (id) => ipcRenderer.invoke('ai:removeProvider', id),
    testProvider: (input) => ipcRenderer.invoke('ai:testProvider', input),
    send: (serverId, text, issueId) => ipcRenderer.invoke('ai:send', serverId, text, issueId),
    cancel: (serverId) => ipcRenderer.invoke('ai:cancel', serverId),
    decide: (serverId, decision) => ipcRenderer.invoke('ai:decide', serverId, decision),
    history: (serverId) => ipcRenderer.invoke('ai:history', serverId),
    clear: (serverId) => ipcRenderer.invoke('ai:clear', serverId),
    status: (serverId) => ipcRenderer.invoke('ai:status', serverId),
    analyzeCommand: (serverId, command) => ipcRenderer.invoke('ai:analyzeCommand', serverId, command),
  },
  audit: {
    list: (serverId, limit) => ipcRenderer.invoke('audit:list', serverId, limit),
  },
  health: {
    report: (serverId) => ipcRenderer.invoke('health:report', serverId),
    resolve: (serverId, issueId, status) => ipcRenderer.invoke('health:resolve', serverId, issueId, status),
    tickets: (serverId) => ipcRenderer.invoke('health:tickets', serverId),
  },
  mcp: {
    info: () => ipcRenderer.invoke('mcp:info'),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    open: (url) => ipcRenderer.invoke('update:open', url),
  },
  sftp: {
    home: (serverId) => ipcRenderer.invoke('sftp:home', serverId),
    list: (serverId, path) => ipcRenderer.invoke('sftp:list', serverId, path),
    preview: (serverId, path) => ipcRenderer.invoke('sftp:preview', serverId, path),
    download: (serverId, path) => ipcRenderer.invoke('sftp:download', serverId, path),
    upload: (serverId, dir) => ipcRenderer.invoke('sftp:upload', serverId, dir),
    mkdir: (serverId, path) => ipcRenderer.invoke('sftp:mkdir', serverId, path),
    rename: (serverId, from, to) => ipcRenderer.invoke('sftp:rename', serverId, from, to),
    remove: (serverId, path, isDir) => ipcRenderer.invoke('sftp:remove', serverId, path, isDir),
  },
  tunnels: {
    list: (serverId) => ipcRenderer.invoke('tunnel:list', serverId),
    save: (serverId, input) => ipcRenderer.invoke('tunnel:save', serverId, input),
    start: (id) => ipcRenderer.invoke('tunnel:start', id),
    stop: (id) => ipcRenderer.invoke('tunnel:stop', id),
    remove: (serverId, id) => ipcRenderer.invoke('tunnel:remove', serverId, id),
  },
  usage: {
    summary: () => ipcRenderer.invoke('usage:summary'),
  },
  demo: {
    start: () => ipcRenderer.invoke('demo:start'),
    stop: () => ipcRenderer.invoke('demo:stop'),
    status: () => ipcRenderer.invoke('demo:status'),
  },
  events: {
    on: <K extends EventChannel>(channel: K, handler: (payload: EventMap[K]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: EventMap[K]) => handler(payload);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.removeListener(channel, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('subshell', api);
