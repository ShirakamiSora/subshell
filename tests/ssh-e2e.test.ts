import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DemoServer } from '../src/main/demo/demo-server';
import { SshConnection } from '../src/main/ssh/connection';
import { reconCommand } from '../src/main/recon/script';
import { parseRecon } from '../src/main/recon/parse';
import { buildProfile } from '../src/main/recon/build-profile';
import { METRIC_SCRIPT } from '../src/main/monitor/collector';
import { buildSample, parseCpuTimes, parseMetricOutput } from '../src/main/monitor/metrics';
import type { ServerConfig } from '../src/shared/types';

let demo: DemoServer;
let connection: SshConnection;
let server: ServerConfig;

beforeAll(async () => {
  demo = new DemoServer();
  const info = await demo.start();
  server = {
    id: 'srv_demo_test',
    name: 'demo-web-01',
    host: info.host,
    port: info.port,
    username: 'ubuntu',
    authType: 'password',
    group: 'demo',
    tags: [],
    createdAt: '',
    updatedAt: '',
  };
  connection = new SshConnection({
    server,
    secret: { password: 'demo' },
    verifyHostKey: () => true,
  });
  await connection.connect();
}, 20_000);

afterAll(() => {
  connection?.disconnect();
  demo?.stop();
});

describe('SSH 连接与命令执行', () => {
  it('建立连接并执行基础命令', async () => {
    const result = await connection.exec('echo hello');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(connection.fingerprint).toMatch(/^SHA256:/);
  });

  it('执行失败命令返回退出码', async () => {
    const result = await connection.exec('this-command-does-not-exist');
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('command not found');
  });

  it('只读侦察返回完整信息', async () => {
    const result = await connection.exec(reconCommand(), { timeoutMs: 30_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('##SECTION:base');
    expect(result.stdout).toContain('demo-web-01');

    const recon = parseRecon(result.stdout);
    const profile = buildProfile(recon, server, null);
    expect(profile.hostname).toBe('demo-web-01');
    expect(profile.os.name).toContain('Ubuntu');
    expect(profile.hardware.cpuCores).toBe(4);
    expect(profile.role).toBe('Web 应用服务器');
    expect(profile.services.some((service) => service.name === 'nginx.service')).toBe(true);
    expect(profile.services.some((service) => service.kind === 'docker' && service.name === 'web-app')).toBe(true);
    expect(profile.risks.some((risk) => risk.id === 'failed-units' && risk.detail.includes('fail2ban'))).toBe(true);

    // 扩展侦察项：存储、健康、安全、证书
    expect(recon.storage.length).toBeGreaterThanOrEqual(2);
    expect(profile.storage?.some((volume) => volume.mount === '/data')).toBe(true);
    expect(profile.health?.zombieProcesses).toBe(2);
    expect(profile.health?.oomKills).toBe(2);
    expect(profile.securityInfo?.failedLogins).toBe(128);
    expect(profile.certificates?.[0]?.port).toBe(443);
  });
});

describe('监控采样', () => {
  it('连续两次采样可计算 CPU 与网络速率', async () => {
    const first = parseMetricOutput((await connection.exec(METRIC_SCRIPT)).stdout);
    const firstCpu = parseCpuTimes(first.CPU ?? '');
    expect(firstCpu).not.toBeNull();
    const firstSample = buildSample({
      values: first,
      cpu: firstCpu!,
      previousCpu: null,
      previousNet: null,
      ts: Date.now(),
    });
    expect(firstSample.cpuPercent).toBe(0);
    expect(firstSample.memTotalKb).toBe(8167424);

    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = parseMetricOutput((await connection.exec(METRIC_SCRIPT)).stdout);
    const secondCpu = parseCpuTimes(second.CPU ?? '');
    const secondSample = buildSample({
      values: second,
      cpu: secondCpu!,
      previousCpu: firstCpu,
      previousNet: { rx: Number(first.NET?.split(/\s+/)[0] ?? 0), tx: 0, ts: Date.now() - 500 },
      ts: Date.now(),
    });
    expect(secondSample.cpuPercent).toBeGreaterThan(0);
    expect(secondSample.cpuPercent).toBeLessThan(60);
    expect(secondSample.diskUsedPercent).toBeCloseTo(42, 0);
    expect(secondSample.netRxBytesPerSec).toBeGreaterThan(0);
  });
});

describe('服务操作与验证', () => {
  it('重启 nginx 后 is-active 返回 active', async () => {
    const restart = await connection.exec('systemctl restart nginx.service');
    expect(restart.exitCode).toBe(0);
    const active = await connection.exec('systemctl is-active nginx.service');
    expect(active.stdout.trim()).toBe('active');
  });

  it('停止服务后状态变为 inactive', async () => {
    const stop = await connection.exec('systemctl stop nginx.service');
    expect(stop.exitCode).toBe(0);
    const active = await connection.exec('systemctl is-active nginx.service');
    expect(active.stdout.trim()).toBe('inactive');
    expect(active.exitCode).toBe(3);
    await connection.exec('systemctl start nginx.service');
    const restored = await connection.exec('systemctl is-active nginx.service');
    expect(restored.stdout.trim()).toBe('active');
  });

  it('读取服务日志', async () => {
    const logs = await connection.exec('journalctl -u fail2ban.service -n 5 --no-pager -o short-iso');
    expect(logs.stdout).toContain('fail2ban');
  });
});

describe('交互式终端', () => {
  it('打开 shell 并执行命令', async () => {
    const shell = await connection.openShell(120, 40);
    const output = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      let sent = false;
      const timer = setTimeout(() => reject(new Error(`shell 无响应: ${buffer.slice(-200)}`)), 6000);
      shell.stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (!sent && buffer.includes('ubuntu@demo-web-01')) {
          sent = true;
          shell.write('uname -r\r');
        }
        const matches = buffer.match(/5\.15\.0-91-generic/g)?.length ?? 0;
        if (sent && matches >= 2) {
          clearTimeout(timer);
          resolve(buffer);
        }
      });
    });
    expect(output).toContain('demo-web-01');
    expect(output).toContain('5.15.0-91-generic');
    shell.close();
  }, 10_000);
});
