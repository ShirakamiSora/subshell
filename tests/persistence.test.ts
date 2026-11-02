import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../src/main/store/db';
import { ServerStore } from '../src/main/store/servers';
import { SettingsStore } from '../src/main/store/settings';
import { ChatStore } from '../src/main/store/chat-store';
import { ProfileStore } from '../src/main/store/profile-store';

let dir = '';
let dataDir = '';

afterEach(() => {
  closeDatabase(dataDir);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'subshell-persist-'));
  dataDir = join(dir, 'data');
  return dataDir;
}

describe('数据持久化（SQLite）', () => {
  it('保存服务器后，关闭数据库再打开仍能读取', () => {
    const dirPath = tempDir();
    const first = new ServerStore(openDatabase(dirPath));
    first.create({ name: '腾讯云', host: '82.156.17.143', port: 37373, username: 'ubuntu', authType: 'password', tags: [] });

    // 模拟关闭应用后重新打开
    closeDatabase(dirPath);
    const second = new ServerStore(openDatabase(dirPath));
    const list = second.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.host).toBe('82.156.17.143');
    expect(list[0]?.name).toBe('腾讯云');
  });

  it('保存设置后，新实例能读取', () => {
    const dirPath = tempDir();
    new SettingsStore(openDatabase(dirPath)).save({ theme: 'light', approvalMode: 'smart', monitorIntervalSec: 30 });

    const reopened = new SettingsStore(openDatabase(dirPath)).get();
    expect(reopened.theme).toBe('light');
    expect(reopened.approvalMode).toBe('smart');
    expect(reopened.monitorIntervalSec).toBe(30);
  });

  it('保存对话后，新实例能读取', () => {
    const dirPath = tempDir();
    const first = new ChatStore(openDatabase(dirPath));
    first.append('srv1', { id: 'm1', role: 'user', content: '检查状态', ts: Date.now() });
    first.append('srv1', { id: 'm2', role: 'assistant', content: '一切正常', ts: Date.now() });

    const reopened = new ChatStore(openDatabase(dirPath));
    const messages = reopened.list('srv1');
    expect(messages).toHaveLength(2);
    expect(messages[1]?.content).toBe('一切正常');
  });

  it('旧 JSON 数据自动迁移到 SQLite 并保留备份', () => {
    const dirPath = tempDir();
    mkdirSync(dirPath, { recursive: true });
    // 0.3.6 及更早版本没有数据库，只有裸 JSON 文件。
    writeFileSync(
      join(dirPath, 'servers.json'),
      JSON.stringify([{ id: 'srv_old', host: '10.0.0.1', username: 'root', authType: 'password' }]),
      'utf8',
    );

    const list = new ServerStore(openDatabase(dirPath)).list();
    expect(list).toHaveLength(1);
    expect(list[0]?.tags).toEqual([]);
    expect(list[0]?.group).toBe('默认分组');
    expect(list[0]?.demo).toBe(false);
    expect(existsSync(join(dirPath, 'servers.json.migrated'))).toBe(true);
  });

  it('旧版本档案缺少字段时补成当前结构', () => {
    const dirPath = tempDir();
    const profileDir = join(dirPath, 'servers', 'srv1');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'profile.json'), JSON.stringify({ serverId: 'srv1', hostname: 'legacy' }), 'utf8');

    const profile = new ProfileStore(openDatabase(dirPath)).get('srv1');
    expect(profile?.hostname).toBe('legacy');
    expect(profile?.services).toEqual([]);
    expect(profile?.notes).toBe('');
    expect(profile?.schemaVersion).toBe(2);
  });

  it('保存服务器档案后，新实例能读取', () => {
    const dirPath = tempDir();
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
    new ProfileStore(openDatabase(dirPath)).save('srv1', profile);

    const reopened = new ProfileStore(openDatabase(dirPath)).get('srv1');
    expect(reopened?.hostname).toBe('demo');
  });
});
