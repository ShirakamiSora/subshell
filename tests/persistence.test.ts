import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('旧格式数据在升级后自动迁移并写回版本号', () => {
    const dataDir = join(tempDir(), 'data');
    mkdirSync(dataDir, { recursive: true });
    // 0.2 时代没有版本号，也没有 tags/jump/demo 等字段。
    writeFileSync(
      join(dataDir, 'servers.json'),
      JSON.stringify([{ id: 'srv_old', host: '10.0.0.1', username: 'root', authType: 'password' }]),
      'utf8',
    );

    const list = new ServerStore(dataDir).list();
    expect(list).toHaveLength(1);
    expect(list[0]?.tags).toEqual([]);
    expect(list[0]?.group).toBe('默认分组');
    expect(list[0]?.demo).toBe(false);

    const raw = JSON.parse(readFileSync(join(dataDir, 'servers.json'), 'utf8')) as {
      __version: number;
      data: unknown[];
    };
    expect(raw.__version).toBe(2);
    expect(raw.data).toHaveLength(1);
  });

  it('旧版本档案缺少字段时补成当前结构', () => {
    const dataDir = join(tempDir(), 'data');
    const dir = join(dataDir, 'servers', 'srv1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'profile.json'), JSON.stringify({ serverId: 'srv1', hostname: 'legacy' }), 'utf8');

    const profile = new ProfileStore(dataDir).get('srv1');
    expect(profile?.hostname).toBe('legacy');
    expect(profile?.services).toEqual([]);
    expect(profile?.notes).toBe('');
    expect(profile?.schemaVersion).toBe(2);
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
