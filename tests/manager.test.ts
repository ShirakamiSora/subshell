import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

const { DemoServer } = await import('../src/main/demo/demo-server');
const { ServerStore } = await import('../src/main/store/servers');
const { SecretStore } = await import('../src/main/store/secrets');
const { KnownHostStore } = await import('../src/main/store/known-hosts');
const { SshManager } = await import('../src/main/ssh/manager');
const { reconCommand } = await import('../src/main/recon/script');

let dir = '';
let demo: InstanceType<typeof DemoServer>;
let manager: InstanceType<typeof SshManager>;
let serverId = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'subshell-manager-'));
  const servers = new ServerStore(dir);
  const secrets = new SecretStore(join(dir, 'secrets.json'));
  const knownHosts = new KnownHostStore(dir);
  manager = new SshManager(servers, secrets, knownHosts);

  demo = new DemoServer();
  const info = await demo.start();
  const server = servers.create({
    name: '演示服务器',
    host: info.host,
    port: info.port,
    username: 'ubuntu',
    authType: 'password',
    demo: true,
  });
  serverId = server.id;
  secrets.set(serverId, { password: 'demo' });
}, 20_000);

afterAll(() => {
  manager?.closeAll();
  demo?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('SshManager 连接池与终端', () => {
  it('连接、状态事件与命令执行', async () => {
    const states: string[] = [];
    manager.on('status', (info) => states.push(info.state));
    const result = await manager.connect(serverId);
    expect(result.state).toBe('connected');
    expect(states).toContain('connecting');
    expect(states).toContain('connected');

    const exec = await manager.exec(serverId, reconCommand(), { timeoutMs: 30_000 });
    expect(exec.exitCode).toBe(0);
    expect(exec.stdout).toContain('demo-web-01');
  }, 30_000);

  it('打开终端并收发数据', async () => {
    const sessionId = await manager.openTerminal(serverId, 120, 40);
    const chunks: string[] = [];
    const handler = (id: string, data: string) => {
      if (id === sessionId) chunks.push(data);
    };
    manager.on('terminalData', handler);
    await new Promise((resolve) => setTimeout(resolve, 250));
    manager.writeTerminal(sessionId, 'uname -r\r');
    await new Promise((resolve) => setTimeout(resolve, 600));
    manager.off('terminalData', handler);
    const output = chunks.join('');
    expect(output).toContain('Welcome to Ubuntu');
    expect(output.match(/5\.15\.0-91-generic/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    manager.resizeTerminal(sessionId, 100, 30);
    manager.closeTerminal(sessionId);
  }, 15_000);

  it('断开后状态为 disconnected', async () => {
    manager.disconnect(serverId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(manager.isConnected(serverId)).toBe(false);
    expect(manager.getState(serverId).state).toBe('disconnected');
  });
});
