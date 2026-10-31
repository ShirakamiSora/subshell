import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerStore } from '../src/main/store/servers';
import { SettingsStore } from '../src/main/store/settings';
import { ChatStore } from '../src/main/store/chat-store';
import { ProfileStore } from '../src/main/store/profile-store';

let dir = '';

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'subshell-persist-'));
  return dir;
}

describe('数据持久化', () => {
  it('保存服务器后，新实例能读取', () => {
    const dataDir = join(tempDir(), 'data');
    const first = new ServerStore(dataDir);
    first.create({ name: '腾讯云', host: '82.156.17.143', port: 37373, username: 'ubuntu', authType: 'password', tags: [] });

    // 模拟关闭应用后重新打开
    const second = new ServerStore(dataDir);
    const list = second.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.host).toBe('82.156.17.143');
    expect(list[0]?.name).toBe('腾讯云');
  });

  it('保存设置后，新实例能读取', () => {
    const dataDir = join(tempDir(), 'data');
    new SettingsStore(dataDir).save({ theme: 'light', approvalMode: 'smart', monitorIntervalSec: 30 });

    const reopened = new SettingsStore(dataDir).get();
    expect(reopened.theme).toBe('light');
    expect(reopened.approvalMode).toBe('smart');
    expect(reopened.monitorIntervalSec).toBe(30);
  });

  it('保存对话后，新实例能读取', () => {
    const dataDir = join(tempDir(), 'data');
    const first = new ChatStore(dataDir);
    first.append('srv1', { id: 'm1', role: 'user', content: '检查状态', ts: Date.now() });
    first.append('srv1', { id: 'm2', role: 'assistant', content: '一切正常', ts: Date.now() });

    const reopened = new ChatStore(dataDir);
    const messages = reopened.list('srv1');
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toBe('一切正常');
  });

  it('保存服务器档案后，新实例能读取', () => {
    const dataDir = join(tempDir(), 'data');
    const profile = {
      serverId: 'srv1',
      scannedAt: new Date().toISOString(),
      hostname: 'demo',
      os: { name: 'Ubuntu', version: '22.04', kernel: '5.15', arch: 'x64' },
      hardware: { cpuModel: 'Xeon', cpuCores: 4, memTotalKb: 1, swapTotalKb: 0, diskTotalKb: 1, diskUsedKb: 0 },
      network: { interfaces: [] },
      role: 'Web',
      summary: '',
      services: [],
      runtimes: [],
      webSites: [],
      risks: [],
      notes: '',
      checklist: [],
      lastUpdated: new Date().toISOString(),
    };
    new ProfileStore(dataDir).save('srv1', profile);

    const reopened = new ProfileStore(dataDir).get('srv1');
    expect(reopened?.hostname).toBe('demo');
  });
});
