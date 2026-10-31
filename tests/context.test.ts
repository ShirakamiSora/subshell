import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.SUBSHELL_TEST_DATA ?? tmpdir(),
    getVersion: () => '0.2.0',
    requestSingleInstanceLock: () => true,
    whenReady: async () => undefined,
    on: vi.fn(),
    quit: vi.fn(),
    setAppUserModelId: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^enc:/, ''),
  },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

const { AppContext } = await import('../src/main/context');
const { registerIpc } = await import('../src/main/ipc');

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'subshell-test-'));
  process.env.SUBSHELL_TEST_DATA = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('应用上下文组装', () => {
  it('初始化存储、默认演示模型与数据目录', () => {
    const dataDir = join(dir, 'data');
    const context = new AppContext(dataDir);
    expect(context.dataDir).toBe(dataDir);
    expect(context.settings.get().monitorIntervalSec).toBe(15);
    expect(context.settings.get().autoApproveReadOnly).toBe(true);

    const providers = context.providers.list();
    expect(providers).toHaveLength(1);
    expect(providers[0]?.kind).toBe('mock');
    expect(context.settings.get().activeProviderId).toBe(providers[0]?.id);

    // 凭据通过 safeStorage 加密保存
    context.secrets.set('srv1', { password: 'secret-pass' });
    expect(context.secrets.get('srv1')?.password).toBe('secret-pass');
    expect(context.secrets.has('srv1')).toBe(true);
    context.dispose();
  });

  it('注册全部 IPC 命令且不抛错', () => {
    handlers.clear();
    const context = new AppContext(join(dir, 'data'));
    expect(() => registerIpc(context)).not.toThrow();
    for (const channel of [
      'app:info',
      'settings:get',
      'servers:list',
      'connection:list',
      'profile:get',
      'ai:providers',
      'demo:status',
    ]) {
      expect(handlers.has(channel), channel).toBe(true);
    }
    expect(handlers.get('settings:get')!()).toMatchObject({ monitorIntervalSec: 15 });
    expect(handlers.get('demo:status')!()).toEqual({ running: false });
    context.dispose();
  });
});
