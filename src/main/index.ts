import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppContext } from './context';
import { registerIpc } from './ipc';
import { createLogger } from './util/logger';

/**
 * 选择 Electron 运行时目录（缓存、Local Storage、单实例锁都写这里）。
 * 优先程序同目录：便携版最稳，也避开部分安全软件/受限令牌对 AppData 的拦截。
 */
function configureUserData(): void {
  const candidates = [
    join(dirname(app.getPath('exe')), 'subshell-runtime'),
    join(app.getPath('appData'), 'subshell'),
    join(tmpdir(), 'subshell-runtime'),
  ];
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      const probe = join(dir, '.write-probe');
      writeFileSync(probe, 'ok', 'utf8');
      rmSync(probe, { force: true });
      app.setPath('userData', dir);
      return;
    } catch {
      // 尝试下一个候选目录
    }
  }
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
      setupMenu();
      mainWindow = createWindow();
      forwardEvents(context);
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
 * 选择可写的数据目录。优先 %APPDATA%，被安全软件或受限令牌拒绝时，
 * 回退到程序同目录，最后回退到系统临时目录，避免“保存失败”。
 */
function pickDataRoot(): string {
  const candidates = [
    join(app.getPath('userData'), 'data'),
    join(dirname(app.getPath('exe')), 'subshell-data'),
    join(tmpdir(), 'subshell-data'),
  ];
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      const probe = join(dir, '.write-probe');
      writeFileSync(probe, 'ok', 'utf8');
      rmSync(probe, { force: true });
      startupLog(`data root selected: ${dir}`);
      return dir;
    } catch (error) {
      startupLog(`data root rejected (${dir}): ${String(error)}`);
    }
  }
  startupLog(`no writable data root, fallback to ${candidates[0]}`);
  return candidates[0]!;
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
      sandbox: false,
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
  window.webContents.on('render-process-gone', (_event, details) => {
    startupLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  window.webContents.on('preload-error', (_event, path, error) => {
    startupLog(`preload-error path=${path} error=${String(error)}`);
  });

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
}
