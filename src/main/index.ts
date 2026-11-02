import { app, BrowserWindow, Menu, Notification, dialog, session, shell } from 'electron';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppContext } from './context';
import { registerIpc } from './ipc';
import { checkForUpdates, openDownloadPage } from './update/service';
import { createLogger } from './util/logger';

function prepareWritableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.write-probe');
    writeFileSync(probe, 'ok', 'utf8');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 选择 Electron 运行时目录（Chromium 缓存、Local Storage、单实例锁都写这里）。
 *
 * 默认使用 `%LOCALAPPDATA%\subshell`。旧版本优先使用程序同目录，
 * 当程序目录由管理员上下文创建时，其 ACL 会阻止 Chromium 的低完整性子进程写入，
 * 表现为「普通双击后界面卡死，管理员运行正常」。LocalAppData 是每个用户
 * 自己创建、权限正确的目录，也是 Electron/Chromium 的推荐位置。
 *
 * 只有显式传入 `--portable`（或设置 `SUBSHELL_PORTABLE=1`）时才把运行时放在程序目录。
 */
function configureUserData(): void {
  const portable = process.argv.includes('--portable') || process.env.SUBSHELL_PORTABLE === '1';
  if (portable) {
    const portableDir = join(dirname(app.getPath('exe')), 'subshell-runtime');
    if (prepareWritableDir(portableDir)) {
      app.setPath('userData', portableDir);
      return;
    }
  }

  const localAppData = process.env.LOCALAPPDATA || join(app.getPath('appData'));
  const preferred = join(localAppData, 'subshell');
  if (prepareWritableDir(preferred)) {
    app.setPath('userData', preferred);
    return;
  }

  // 最后保留 Electron 默认的 %APPDATA%\<name>，不要落到程序目录。
}

configureUserData();

/** 启动阶段文件日志：即使窗口没有出现，也能知道卡在哪一步。 */
const startupLogFile = (() => {
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    return join(dir, 'startup.log');
  } catch {
    return join(tmpdir(), 'subshell-startup.log');
  }
})();

function startupLog(message: string): void {
  try {
    appendFileSync(startupLogFile, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {
    // 日志失败不应影响启动
  }
}

process.on('uncaughtException', (error) => {
  startupLog(`uncaughtException: ${error.stack ?? error.message}`);
});
process.on('unhandledRejection', (reason) => {
  startupLog(`unhandledRejection: ${String(reason)}`);
});

const log = createLogger('main');
let mainWindow: BrowserWindow | null = null;
let context: AppContext | null = null;
let disposed = false;

startupLog(`main module loaded, electron=${process.versions.electron}, argv=${process.argv.join(' ')}`);
startupLog(`userData=${app.getPath('userData')}`);

// 注意：不要全局禁用硬件加速，否则渲染全部走软件路径，界面会明显卡顿。
// 如果个别机器 GPU 初始化失败，可在快捷方式里追加 --disable-gpu。

let hasLock = false;
try {
  hasLock = app.requestSingleInstanceLock();
} catch (error) {
  startupLog(`requestSingleInstanceLock failed: ${String(error)}`);
}
startupLog(`single instance lock: ${hasLock}`);

// 注意：即使拿不到锁（已有实例，或安全软件阻止创建锁文件），也继续启动。
// 之前的实现会直接 quit，导致用户看到“双击没反应”。
app.on('second-instance', () => {
  startupLog('second instance detected');
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app
  .whenReady()
  .then(() => {
    startupLog('app ready');
    app.setAppUserModelId('com.subshell.app');
    try {
      context = new AppContext(pickDataRoot());
      registerIpc(context);
      applyContentSecurityPolicy();
      setupMenu();
      mainWindow = createWindow();
      forwardEvents(context);
      scheduleUpdateCheck(context);
      startupLog(`window created, dataDir=${context.dataDir}`);
      log.info(`subshell 已启动，数据目录 ${context.dataDir}`);
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      startupLog(`startup error: ${message}`);
      dialog.showErrorBox('subshell 启动失败', message);
      app.quit();
      return;
    }

    if (process.argv.includes('--demo')) {
      mainWindow.once('ready-to-show', () => {
        setTimeout(() => {
          void context?.startDemo().catch((error) => log.error('演示服务器启动失败', error));
        }, 1200);
      });
    }
  })
  .catch((error) => {
    startupLog(`whenReady rejected: ${String(error)}`);
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }
});

app.on('window-all-closed', () => {
  context?.dispose();
  disposed = true;
  app.quit();
});

app.on('before-quit', () => {
  if (!disposed) {
    context?.dispose();
    disposed = true;
  }
});

/**
 * 选择可写的数据目录。默认 `userData/data`；
 * 如果新位置为空，会从旧版本的三个常见位置迁移一次数据：
 * - `%APPDATA%\subshell\data`（旧默认）
 * - 程序目录的 `subshell-runtime/data`（旧便携版）
 * - 程序目录的 `subshell-data`（旧回退位置）
 *
 * 迁移只复制数据文件，不复制 Chromium 缓存，也不会删除旧目录。
 */
function pickDataRoot(): string {
  const primary = join(app.getPath('userData'), 'data');
  migrateLegacyData(primary);

  const candidates = [
    primary,
    join(dirname(app.getPath('exe')), 'subshell-data'),
    join(tmpdir(), 'subshell-data'),
  ];
  for (const dir of candidates) {
    if (prepareWritableDir(dir)) {
      startupLog(`data root selected: ${dir}`);
      return dir;
    }
    startupLog(`data root rejected (${dir})`);
  }
  startupLog(`no writable data root, fallback to ${candidates[0]}`);
  return candidates[0]!;
}

function migrateLegacyData(primary: string): void {
  try {
    if (existsSync(primary) && readdirSync(primary).length > 0) return;
  } catch {
    return;
  }

  // 先合并最近使用的程序目录数据，再补充旧默认目录中缺失的文件（例如服务器列表）。
  // cpSync 使用 force:false，已存在的同名文件保留，多个来源可以互补而不互相覆盖。
  const legacyDirs = [
    join(dirname(app.getPath('exe')), 'subshell-runtime', 'data'),
    join(dirname(app.getPath('exe')), 'subshell-data'),
    join(app.getPath('appData'), 'subshell', 'data'),
  ];

  for (const legacy of legacyDirs) {
    try {
      if (legacy === primary || !existsSync(legacy)) continue;
      if (readdirSync(legacy).length === 0) continue;
      mkdirSync(primary, { recursive: true });
      cpSync(legacy, primary, { recursive: true, force: false, errorOnExist: false });
      startupLog(`legacy data merged: ${legacy} -> ${primary}`);
    } catch (error) {
      startupLog(`legacy data migration failed (${legacy}): ${String(error)}`);
    }
  }
}

function createWindow(): BrowserWindow {
  startupLog('createWindow start');
  const theme = context?.settings.get().theme ?? 'dark';
  const light = theme === 'light';
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 660,
    // 直接显示窗口，不依赖 ready-to-show；否则渲染失败时用户会看到“没反应”。
    show: true,
    backgroundColor: '#0b0e14',
    title: 'subshell',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: light ? '#f4f7fb' : '#11161e',
      symbolColor: light ? '#475569' : '#94a3b8',
      height: 44,
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 渲染进程不需要 Node 能力：开启 sandbox 后即使渲染层被 XSS 利用，
      // 也无法直接触达文件系统与 child_process，只能走白名单 IPC。
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => {
    startupLog('window ready-to-show');
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });

  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    startupLog(`did-fail-load code=${code} desc=${description} url=${url}`);
  });
  window.webContents.on('did-finish-load', () => {
    startupLog('did-finish-load');
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    startupLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  window.webContents.on('preload-error', (_event, path, error) => {
    startupLog(`preload-error path=${path} error=${String(error)}`);
  });
  // 渲染层无响应时记录，便于用户反馈「双击卡死」时定位是主进程还是渲染进程。
  window.on('unresponsive', () => startupLog('window unresponsive'));
  window.on('responsive', () => startupLog('window responsive'));

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html')).catch((error) => {
      startupLog(`loadFile failed: ${String(error)}`);
    });
  }

  window.on('closed', () => {
    startupLog('window closed');
  });

  return window;
}

/**
 * 生产构建注入 CSP。开发模式跳过：Vite HMR 需要内联脚本与 ws 连接，
 * 强行收紧会让 `npm run dev` 直接白屏。
 */
function applyContentSecurityPolicy(): void {
  if (process.env.ELECTRON_RENDERER_URL) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        ],
      },
    });
  });
}

/**
 * 启动后延迟检查新版本。只查询 GitHub Releases，不上报任何数据；
 * 用户可在设置里关闭。发现新版本时同时给出系统通知与应用内提示。
 */
function scheduleUpdateCheck(ctx: AppContext): void {
  if (!ctx.settings.get().autoCheckUpdate) return;
  const timer = setTimeout(() => {
    void (async () => {
      const info = await checkForUpdates();
      if (!info.hasUpdate || !info.url) return;
      const zh = ctx.settings.get().language === 'zh';
      try {
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: zh ? `Subshell ${info.latest} 已发布` : `Subshell ${info.latest} is available`,
            body: zh ? '点击查看更新内容' : 'Click to view the release',
          });
          notification.on('click', () => openDownloadPage(info.url));
          notification.show();
        }
      } catch {
        // 系统通知不可用时，仍然给应用内提示
      }
      const send = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.send.bind(mainWindow.webContents) : null;
      send?.('app:notice', {
        level: 'info',
        message: zh
          ? `发现新版本 ${info.latest}，可在「设置 → 关于」中查看`
          : `Version ${info.latest} is available — see Settings → About`,
      });
    })();
  }, 20_000);
  timer.unref?.();
}

function setupMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function forwardEvents(ctx: AppContext): void {
  const send = (channel: string, payload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  ctx.ssh.on('status', (info) => send('connection:update', info));
  ctx.ssh.on('terminalData', (sessionId: string, data: string) => send('terminal:data', { sessionId, data }));
  ctx.ssh.on('terminalExit', (sessionId: string) => send('terminal:exit', { sessionId }));
  ctx.monitor.on('sample', (serverId: string, sample) => send('monitor:sample', { serverId, sample }));
  ctx.monitor.on('events', (serverId: string, events) => send('monitor:events', { serverId, events }));
  ctx.monitor.on('status', (serverId: string, payload) => send('monitor:status', { serverId, ...payload }));
  ctx.monitor.on('error', (serverId: string, message: string) =>
    send('app:notice', { level: 'warning', message: `监控采集失败（${serverId}）：${message}` }),
  );
  ctx.recon.on('profile', (profile) => send('profile:update', profile));
  ctx.agent.on('event', (event) => send('agent:event', event));
  ctx.health.on('update', (serverId: string, report) => send('health:update', report));
  ctx.commands.on('update', (serverId: string, entry) => send('command:update', { serverId, entry }));
  ctx.security.on('update', (serverId: string, report) => send('security:update', report));
  ctx.cluster.on('update', (run) => send('cluster:update', run));
}
