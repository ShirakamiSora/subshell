// 界面预览与截图脚本。
//
// 用法：
//   npm run build                       # 先构建出 out/renderer
//   node scripts/ui-preview.mjs         # 生成 docs/screenshots/*.png
//   node scripts/ui-preview.mjs --gif   # 额外合成演示 GIF
//
// 依赖本地 Edge/Chrome（playwright-core 不自带浏览器）。渲染层通过
// addInitScript 注入一份 window.subshell 假实现，因此不需要启动 Electron。

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const ROOT = 'out/renderer';
const PORT = Number(process.env.PREVIEW_PORT ?? 4399);
const OUT_DIR = 'docs/screenshots';
const WANT_GIF = process.argv.includes('--gif');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function findBrowser() {
  const candidates = [
    process.env.PREVIEW_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) ?? null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      try {
        let path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
        if (path === '/') path = '/index.html';
        const file = join(ROOT, normalize(path).replace(/^([/\\])+/, ''));
        const data = await readFile(file);
        response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        response.end(data);
      } catch {
        response.writeHead(404);
        response.end('not found');
      }
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

/** 注入到页面里的假后端：一份完整的演示数据与空操作。 */
function mockScript() {
  const now = Date.now();
  const servers = [
    {
      id: 'srv1',
      name: 'demo-web-01',
      host: '10.0.12.8',
      port: 22,
      username: 'ubuntu',
      authType: 'password',
      tags: ['production', 'web'],
      group: '生产环境',
      color: '#2dd4bf',
      demo: true,
      jump: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
    {
      id: 'srv2',
      name: 'demo-db-01',
      host: '10.0.12.9',
      port: 22,
      username: 'ubuntu',
      authType: 'key',
      tags: ['production', 'db'],
      group: '生产环境',
      color: '#60a5fa',
      demo: true,
      jump: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
  ];

  const samples = Array.from({ length: 60 }, (_, index) => {
    const wave = Math.sin(index / 6) * 12;
    return {
      ts: now - (60 - index) * 15_000,
      cpuPercent: Math.round((38 + wave + (index % 7)) * 10) / 10,
      memUsedPercent: Math.round((64 + Math.cos(index / 9) * 6) * 10) / 10,
      memUsedKb: 5_400_000,
      memTotalKb: 8_167_424,
      swapUsedPercent: 12,
      diskUsedPercent: 42,
      diskUsedKb: 35_232_153,
      diskTotalKb: 83_886_080,
      load1: Math.round((1.1 + wave / 20) * 100) / 100,
      load5: 0.98,
      load15: 0.87,
      netRxBytesPerSec: 420_000 + index * 1000,
      netTxBytesPerSec: 180_000,
      processCount: 168,
      uptimeSeconds: 1_036_800,
    };
  });

  const services = [
    { name: 'nginx.service', kind: 'systemd', state: 'running', subState: 'running', description: 'A high performance web server', ports: ['80/tcp', '443/tcp'], enabled: true },
    { name: 'mysql.service', kind: 'systemd', state: 'running', subState: 'running', description: 'MySQL Community Server', ports: ['3306/tcp'], enabled: true },
    { name: 'redis-server.service', kind: 'systemd', state: 'running', subState: 'running', description: 'Advanced key-value store', ports: ['6379/tcp'], enabled: true },
    { name: 'php8.1-fpm.service', kind: 'systemd', state: 'running', subState: 'running', description: 'PHP FastCGI Process Manager', ports: [], enabled: true },
    { name: 'docker.service', kind: 'systemd', state: 'running', subState: 'running', description: 'Docker Engine', ports: [], enabled: true },
    { name: 'fail2ban.service', kind: 'systemd', state: 'failed', subState: 'failed', description: 'Fail2Ban Service', ports: [], enabled: true },
    { name: 'web-app', kind: 'docker', state: 'running', subState: 'Up 3 days', description: 'ghcr.io/acme/web:2.4.1', ports: ['3000/tcp'], enabled: true },
  ];

  const profile = {
    serverId: 'srv1',
    schemaVersion: 2,
    scannedAt: new Date(now - 3_600_000).toISOString(),
    hostname: 'demo-web-01',
    os: { name: 'Ubuntu', version: '22.04.3 LTS', kernel: '5.15.0-91-generic', arch: 'x86_64', virtualization: 'kvm' },
    hardware: { cpuModel: 'Intel Xeon Platinum 8255C', cpuCores: 4, memTotalKb: 8_167_424, swapTotalKb: 2_097_148, diskTotalKb: 83_886_080, diskUsedKb: 35_232_153 },
    network: { interfaces: [{ name: 'eth0', addresses: ['10.0.12.8/24'] }], publicIp: '10.0.12.8' },
    role: 'Web 应用服务器',
    summary:
      '**demo-web-01** 是一台 Ubuntu 22.04 的 Web 应用服务器，Nginx 作为反向代理，后端为 Node.js 服务与 MySQL。运行 12 天，根分区使用 42%，无异常重启。',
    services,
    runtimes: [
      { name: 'node', version: 'v20.11.0' },
      { name: 'nginx', version: 'nginx/1.18.0' },
      { name: 'mysql', version: 'mysql Ver 8.0.35' },
    ],
    webSites: [{ domain: 'app.example.com', server: 'nginx' }],
    storage: [{ mount: '/', totalKb: 83_886_080, usedKb: 35_232_153, availableKb: 44_354_307, usedPercent: 42 }],
    securityInfo: { failedLogins: 148, upgradablePackages: 26, sudoUsers: ['ubuntu'] },
    health: { zombieProcesses: 1, oomKills: 0, journalErrors: 12, timeSynced: true, failedUnits: 1 },
    certificates: [{ port: 443, daysLeft: 21 }],
    risks: [
      { id: 'r1', level: 'critical', title: 'fail2ban.service 启动失败', detail: '服务处于 failed 状态。' },
      { id: 'r2', level: 'warning', title: 'SSH 失败登录 148 次', detail: '可能存在暴力破解尝试。' },
      { id: 'r3', level: 'warning', title: '端口 443 证书 21 天后过期', detail: '建议在到期前完成续期。' },
      { id: 'r4', level: 'info', title: '26 个软件包可升级', detail: '建议在维护窗口更新安全补丁。' },
    ],
    notes: '- 2026-10-28：应用部署在 /opt/web-app，pm2 守护；\n- 数据库连接串在 /etc/web-app/env，只有 ubuntu 可读。',
    checklist: [{ id: 'c1', text: '为 MySQL 配置每日备份', done: false }],
    lastUpdated: new Date(now).toISOString(),
  };

  const report = {
    serverId: 'srv1',
    generatedAt: now,
    score: { score: 72, grade: 'fair', critical: 1, warning: 2, info: 1 },
    issues: [
      { id: 'service:fail2ban.service', serverId: 'srv1', severity: 'critical', source: 'service', title: '服务启动失败：fail2ban.service', detail: 'Fail2Ban Service（systemd）', suggestion: '查看 fail2ban.service 的最近日志定位失败原因，修复后重启并验证状态。', service: 'fail2ban.service', status: 'open', updatedAt: now },
      { id: 'risk:r2', serverId: 'srv1', severity: 'warning', source: 'profile', title: 'SSH 失败登录 148 次', detail: '可能存在暴力破解尝试。', suggestion: '检查 /var/log/auth.log 的来源 IP，考虑启用 fail2ban、禁用密码登录。', status: 'open', updatedAt: now },
      { id: 'risk:r3', serverId: 'srv1', severity: 'warning', source: 'profile', title: '端口 443 证书 21 天后过期', detail: '建议在到期前完成续期。', suggestion: '确认证书到期时间，执行续期并重载 Web 服务。', status: 'open', updatedAt: now },
      { id: 'risk:r4', serverId: 'srv1', severity: 'info', source: 'profile', title: '26 个软件包可升级', detail: '建议在维护窗口更新安全补丁。', suggestion: '在维护窗口内评估并安装安全更新。', status: 'open', updatedAt: now },
      { id: 'check:c1', serverId: 'srv1', severity: 'info', source: 'checklist', title: '待办：为 MySQL 配置每日备份', detail: '这是档案中记录但尚未完成的检查项。', suggestion: '完成该项检查后，在服务器档案里勾选完成。', status: 'resolved', updatedAt: now },
    ],
  };

  const tickets = [
    { id: 't1', serverId: 'srv1', issueId: 'service:fail2ban.service', title: '查看服务 fail2ban.service', action: 'inspect_service', command: 'systemctl status fail2ban.service', ok: true, ts: now - 900_000 },
    { id: 't2', serverId: 'srv1', issueId: 'risk:r3', title: '重启 服务 nginx', action: 'service_action', command: 'systemctl restart nginx.service', ok: true, ts: now - 3_600_000 },
  ];

  const files = [
    { name: 'app', path: '/home/ubuntu/app', type: 'directory', size: 4096, mode: 0o040755, mtime: now - 86_400_000 },
    { name: 'logs', path: '/home/ubuntu/logs', type: 'directory', size: 4096, mode: 0o040755, mtime: now - 3_600_000 },
    { name: 'deploy.sh', path: '/home/ubuntu/deploy.sh', type: 'file', size: 2140, mode: 0o100755, mtime: now - 7_200_000 },
    { name: 'nginx.conf', path: '/home/ubuntu/nginx.conf', type: 'file', size: 5820, mode: 0o100644, mtime: now - 172_800_000 },
    { name: 'notes.md', path: '/home/ubuntu/notes.md', type: 'file', size: 940, mode: 0o100644, mtime: now - 900_000 },
  ];

  const settings = {
    activeProviderId: 'prov1',
    theme: 'dark',
    language: 'zh',
    approvalMode: 'smart',
    monitorIntervalSec: 15,
    autoRecon: true,
    autoApproveReadOnly: true,
    syncProfileToServer: false,
    aiAutoSummary: true,
    sampleRetention: 720,
    terminalFontSize: 14,
    auditEnabled: true,
    mcpEnabled: true,
    mcpPort: 3929,
    mcpAllowMutations: false,
    inputPricePerMTok: 2,
    outputPricePerMTok: 8,
  };

  const providers = [{ id: 'prov1', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hasApiKey: true, createdAt: '', updatedAt: '' }];

  const chat = [
    { id: 'm1', role: 'user', content: '磁盘怎么满了？帮我看看。', ts: now - 120_000 },
    {
      id: 'm2',
      role: 'assistant',
      content: '根分区 42%，并不紧张；真正占空间的是 `/var/log` 下的历史日志（约 6.2 GB）。建议先清理 30 天前的归档日志。',
      ts: now - 100_000,
      usage: { inputTokens: 8200, outputTokens: 320 },
      toolCalls: [
        { id: 'c1', name: 'get_overview', args: {}, status: 'done', risk: 'read', title: '读取系统概览', createdAt: now - 110_000, finishedAt: now - 109_000, stdout: 'CPU: 41%（4 核），负载 1.12 / 0.98 / 0.87' },
        { id: 'c2', name: 'run_command', args: { command: 'du -sh /var/log/* | sort -h | tail -5', purpose: '找出最大的日志目录' }, status: 'awaiting_approval', risk: 'medium', title: '执行命令', command: 'du -sh /var/log/* | sort -h | tail -5', impact: '修改服务器文件', createdAt: now - 108_000 },
      ],
    },
  ];

  const runtime = {
    serverId: 'srv1',
    connection: { serverId: 'srv1', state: 'connected', since: new Date(now - 3_600_000).toISOString(), latencyMs: 42 },
    profile,
    samples,
    events: [
      { id: 'e1', serverId: 'srv1', ts: now - 600_000, severity: 'critical', kind: 'service', title: '服务异常退出：fail2ban.service', detail: '从运行中变为 failed' },
      { id: 'e2', serverId: 'srv1', ts: now - 1_800_000, severity: 'warning', kind: 'cpu', title: 'CPU 使用率持续偏高（92%）', detail: '最近 3 次采样均高于 90%' },
      { id: 'e3', serverId: 'srv1', ts: now - 3_600_000, severity: 'info', kind: 'service', title: '发现新服务：web-app', detail: '监控期间检测到新的容器' },
    ],
    services,
    ports: [
      { protocol: 'tcp', address: '0.0.0.0', port: 22, process: 'sshd', pid: 812 },
      { protocol: 'tcp', address: '0.0.0.0', port: 80, process: 'nginx', pid: 3456 },
      { protocol: 'tcp', address: '0.0.0.0', port: 443, process: 'nginx', pid: 3456 },
      { protocol: 'tcp', address: '127.0.0.1', port: 3306, process: 'mysqld', pid: 1234 },
      { protocol: 'tcp', address: '127.0.0.1', port: 6379, process: 'redis-server', pid: 1789 },
    ],
    processes: [
      { pid: 1234, user: 'mysql', cpuPercent: 12.3, memPercent: 6.8, rssKb: 1_523_712, command: '/usr/sbin/mysqld --daemonize' },
      { pid: 2345, user: 'ubuntu', cpuPercent: 6.7, memPercent: 11.2, rssKb: 1_873_920, command: 'node /opt/web-app/server.js' },
      { pid: 3456, user: 'root', cpuPercent: 1.9, memPercent: 0.4, rssKb: 196_608, command: 'nginx: master process' },
    ],
    summary: { text: profile.summary, ts: now - 900_000 },
    monitoring: true,
  };

  const noop = async () => undefined;
  const api = {
    app: { info: async () => ({ version: '0.3.0', electron: '38.0.0', platform: 'win32', dataDir: 'C:/Users/demo/AppData/Roaming/subshell/data' }) },
    settings: { get: async () => settings, save: async (patch) => Object.assign(settings, patch) },
    servers: { list: async () => servers, create: async () => servers[0], update: async () => servers[0], remove: noop, test: async () => ({ ok: true, latencyMs: 42 }) },
    connection: { list: async () => servers.map((s) => ({ serverId: s.id, state: 'connected' })), connect: async (id) => ({ serverId: id, state: 'connected' }), disconnect: noop, resetHostKey: noop },
    terminal: { open: async () => 'term1', write: noop, resize: noop, close: noop },
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }),
    monitor: { snapshot: async () => runtime, start: noop, stop: noop, acknowledge: noop },
    profile: { get: async () => profile, rescan: async () => profile, save: async () => profile, summarize: async () => profile.summary, sync: async () => ({ ok: true, path: '~/.subshell/profile.md' }), export: async () => ({ ok: true, path: 'C:/demo/profile.md' }), markdown: async () => '## 基本信息\n\n- 系统：Ubuntu 22.04.3 LTS\n- 角色：Web 应用服务器\n- 配置：4 核 / 7.8 GB 内存 / 80 GB 磁盘\n\n## 服务\n\n- nginx.service（systemd）：running\n- mysql.service（systemd）：running\n- fail2ban.service（systemd）：failed\n\n## 风险\n\n- [critical] **fail2ban.service 启动失败**：服务处于 failed 状态。\n- [warning] **SSH 失败登录 148 次**：可能存在暴力破解尝试。' },
    ai: {
      providers: async () => providers,
      saveProvider: async () => providers[0],
      removeProvider: noop,
      testProvider: async () => ({ ok: true, latencyMs: 680, message: 'ok' }),
      send: async () => ({ messageId: 'm3' }),
      cancel: noop,
      decide: noop,
      history: async () => chat,
      clear: noop,
      status: async () => ({ serverId: 'srv1', state: 'awaiting_approval', round: 2 }),
      analyzeCommand: async () => ({ risk: 'medium', reasons: ['变更 systemd 服务状态'], explanation: '这条命令会重启 nginx，通常中断数秒。' }),
    },
    audit: { list: async () => [] },
    health: { report: async () => report, resolve: async () => report, tickets: async () => tickets },
    mcp: { info: async () => ({ running: true, port: 3929, token: 'demo-token-xxxxxxxx', mutationEnabled: false, endpoint: 'http://127.0.0.1:3929/mcp' }) },
    sftp: {
      home: async () => '/home/ubuntu',
      list: async () => files,
      preview: async () => ({ ok: true, content: '#!/usr/bin/env bash\nset -euo pipefail\n\necho "deploying web-app..."\nrsync -az --delete dist/ /var/www/app/\nsystemctl reload nginx\n' }),
      download: async () => ({ ok: true, path: 'C:/demo/deploy.sh' }),
      upload: async () => ({ ok: true, files: [] }),
      mkdir: noop,
      rename: noop,
      remove: noop,
    },
    tunnels: { list: async () => [{ id: 'tun1', serverId: 'srv1', label: '3306 → 127.0.0.1:3306', localPort: 3306, remoteHost: '127.0.0.1', remotePort: 3306, running: true, connections: 2, since: now - 600_000 }], save: async () => [], start: noop, stop: noop, remove: async () => [] },
    update: { check: async () => ({ current: '0.3.0', latest: '0.3.0', hasUpdate: false, url: '', checkedAt: now }), open: noop },
    events: { on: () => () => {} },
  };

  window.subshell = api;
}

async function main() {
  if (!existsSync(join(ROOT, 'index.html'))) {
    console.error(`缺少 ${ROOT}/index.html，请先运行 npm run build`);
    process.exit(1);
  }
  const browserPath = findBrowser();
  if (!browserPath) {
    console.error('没有找到 Edge/Chrome，可通过 PREVIEW_BROWSER 指定可执行文件路径');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('[pageerror]', error.message));
  await page.addInitScript(mockScript);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const shots = [
    ['welcome', async () => {}],
    ['overview', async () => clickNav(page, '概览')],
    ['health', async () => clickNav(page, '体检')],
    ['files', async () => {
      await clickNav(page, '文件');
      // 打开一个文本文件，展示预览面板
      const file = page.getByText('notes.md', { exact: true }).first();
      if (await file.count()) await file.click();
    }],
    ['terminal', async () => clickNav(page, '终端')],
    ['assistant', async () => clickNav(page, 'AI 助手')],
  ];

  const captured = [];
  for (const [name, prepare] of shots) {
    await prepare();
    await page.waitForTimeout(700);
    const file = join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: file });
    captured.push(file);
    console.log('saved', file);
  }

  await browser.close();
  server.close();

  if (WANT_GIF) {
    console.log('截图完成。合成 GIF：');
    console.log('  python scripts/make-gif.py');
    console.log(`  输入目录：${OUT_DIR}`);
  }
}

async function clickNav(page, label) {
  const button = page.locator(`button:has-text("${label}")`).first();
  if (await button.count()) {
    await button.click();
    return;
  }
  // 欢迎页没有导航时，先打开服务器
  const server = page.locator('button:has-text("demo-web-01")').first();
  if (await server.count()) {
    await server.click();
    await page.waitForTimeout(600);
    const tab = page.locator(`button:has-text("${label}")`).first();
    if (await tab.count()) await tab.click();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
