import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../src/main/store/db';
import { CommandHistoryStore } from '../src/main/store/command-history';

let dir = '';
let store: CommandHistoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'subshell-history-'));
  store = new CommandHistoryStore(openDatabase(dir));
});

afterEach(() => {
  closeDatabase(dir);
  rmSync(dir, { recursive: true, force: true });
});

describe('命令历史存储', () => {
  it('记录、读取与删除命令', () => {
    const entry = store.append('srv1', {
      command: 'systemctl restart nginx',
      source: 'ai',
      risk: 'medium',
      ok: true,
      exitCode: 0,
      durationMs: 42,
      stdout: 'done',
      purpose: '重启网站服务',
    });
    expect(entry.id).toBeTruthy();
    expect(store.count('srv1')).toBe(1);

    const loaded = store.get('srv1', entry.id);
    expect(loaded?.command).toBe('systemctl restart nginx');
    expect(loaded?.purpose).toBe('重启网站服务');
    expect(loaded?.exitCode).toBe(0);

    store.remove('srv1', entry.id);
    expect(store.count('srv1')).toBe(0);
  });

  it('按时间倒序返回，并支持来源与关键字过滤', () => {
    store.append('srv1', { command: 'df -h', source: 'terminal', risk: 'read', ok: true, ts: 1 });
    store.append('srv1', { command: 'systemctl restart nginx', source: 'ai', risk: 'medium', ok: true, ts: 3 });
    store.append('srv1', { command: 'ls /var/log', source: 'terminal', risk: 'read', ok: true, ts: 2 });

    const all = store.list('srv1');
    expect(all.map((entry) => entry.ts)).toEqual([3, 2, 1]);

    const terminal = store.list('srv1', { source: 'terminal' });
    expect(terminal).toHaveLength(2);
    expect(terminal.every((entry) => entry.source === 'terminal')).toBe(true);

    const matched = store.list('srv1', { query: 'nginx' });
    expect(matched).toHaveLength(1);
    expect(matched[0]?.command).toContain('nginx');
  });

  it('保存命令分析与回退方案', () => {
    const entry = store.append('srv1', {
      command: 'rm -rf /var/log/nginx/old.log',
      source: 'manual',
      risk: 'high',
      ok: true,
    });
    store.setAnalysis('srv1', entry.id, {
      summary: '删除旧日志',
      impact: '释放少量空间',
      riskNotes: ['删除后无法恢复'],
      reversible: false,
      generatedAt: Date.now(),
    });
    store.setRollback('srv1', entry.id, {
      entryId: entry.id,
      summary: '从备份恢复日志',
      steps: [{ command: 'cp /backup/old.log /var/log/nginx/old.log', purpose: '恢复文件', risk: 'medium' }],
      predictions: ['可能覆盖同名文件'],
      conflicts: ['nginx 可能正在写入'],
      confidence: 'low',
      generatedAt: Date.now(),
      status: 'planned',
    });

    const loaded = store.get('srv1', entry.id);
    expect(loaded?.analysis?.summary).toBe('删除旧日志');
    expect(loaded?.analysis?.riskNotes).toContain('删除后无法恢复');
    expect(loaded?.rollback?.steps).toHaveLength(1);
    expect(loaded?.rollback?.confidence).toBe('low');

    store.markReverted('srv1', entry.id);
    expect(store.get('srv1', entry.id)?.reverted).toBe(true);
  });

  it('超过保留上限时裁剪最旧的记录', () => {
    for (let index = 0; index < 70; index += 1) {
      store.append(
        'srv1',
        {
          command: `echo ${index}`,
          source: 'terminal',
          risk: 'read',
          ok: true,
          ts: index,
        },
        50,
      );
    }
    expect(store.count('srv1')).toBe(50);
    const list = store.list('srv1', { limit: 100 });
    expect(list[0]?.command).toBe('echo 69');
    expect(list.at(-1)?.command).toBe('echo 20');
  });

  it('不同服务器的历史互相隔离', () => {
    store.append('srv1', { command: 'uptime', source: 'terminal', risk: 'read', ok: true });
    store.append('srv2', { command: 'free -m', source: 'terminal', risk: 'read', ok: true });
    expect(store.list('srv1')).toHaveLength(1);
    expect(store.list('srv2')).toHaveLength(1);
    store.clear('srv1');
    expect(store.list('srv1')).toHaveLength(0);
    expect(store.list('srv2')).toHaveLength(1);
  });
});
