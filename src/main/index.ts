import { existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, net, Notification, protocol, shell, Tray } from 'electron';
import { EVENTS } from '../shared/api';
import type { Settings } from '../shared/types';
import { registerIpc } from './ipc';
import { LiveSession } from './live';
import { RECORDER_SOURCE } from './recorderSource';
import { Repo, SAFE_ID, type RepoEvent } from './repo';
import { RunManager } from './runner';
import { Scheduler } from './scheduler';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const START_HIDDEN = process.argv.includes('--hidden');

protocol.registerSchemesAsPrivileged([{ scheme: 'xero-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.xero.browserautomation');
  Menu.setApplicationMenu(null);

  let win: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;
  let trayHintShown = false;

  const resourcesDir = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  const iconPath = join(resourcesDir, 'icon.png');

  const THEME = {
    dark: { bg: '#15181F', bar: '#15181F', symbol: '#C9CEDA' },
    light: { bg: '#F3F4F7', bar: '#F3F4F7', symbol: '#3A4150' },
  };

  const send = (channel: string, payload: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
  };

  const showWindow = () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    const repo = new Repo(process.env.XERO_DATA_DIR || join(app.getPath('userData'), 'data'));
    const settings = repo.settings();
    const resolvedTheme = (s: Settings): 'dark' | 'light' => (s.theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : s.theme);

    // Screenshots and other run artifacts: xero-asset://run/<runId>/<file>
    protocol.handle('xero-asset', (req) => {
      const url = new URL(req.url);
      const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
      if (url.hostname !== 'run' || parts.length !== 2 || !SAFE_ID.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) return new Response('Not found', { status: 404 });
      const base = normalize(repo.runs.artifactsDir(parts[0]));
      const file = normalize(join(base, parts[1]));
      if (!file.startsWith(base + sep) || !existsSync(file)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });

    const createWindow = () => {
      const t = THEME[resolvedTheme(repo.settings())];
      win = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1080,
        minHeight: 680,
        show: false,
        title: 'Xero Browser Automation',
        backgroundColor: t.bg,
        icon: existsSync(iconPath) ? iconPath : undefined,
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: t.bar, symbolColor: t.symbol, height: 44 },
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          spellcheck: false,
        },
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
      });
      win.webContents.on('will-navigate', (e, url) => {
        if (DEV_URL && url.startsWith(DEV_URL)) return;
        if (!url.startsWith('file:')) e.preventDefault();
      });
      win.webContents.on('before-input-event', (_e, input) => {
        if (DEV_URL && input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win?.webContents.toggleDevTools();
      });
      win.once('ready-to-show', () => {
        if (!START_HIDDEN) win?.show();
      });
      win.on('close', (e) => {
        if (quitting) return;
        if (repo.settings().closeToTray && tray) {
          e.preventDefault();
          win?.hide();
          if (!trayHintShown && Notification.isSupported()) {
            trayHintShown = true;
            new Notification({ title: 'Xero is still running', body: 'Schedules keep running in the background. Right-click the tray icon to quit.', icon: iconPath }).show();
          }
          return;
        }
        quitting = true;
        app.quit();
      });
      win.on('closed', () => (win = null));
      if (DEV_URL) void win.loadURL(DEV_URL);
      else void win.loadFile(join(__dirname, '../renderer/index.html'));
    };

    const live = new LiveSession({
      headless: process.env.XERO_LIVE_HEADLESS === '1',
      debugPort: process.env.XERO_LIVE_DEBUG_PORT ? Number(process.env.XERO_LIVE_DEBUG_PORT) : undefined,
      emit: (e) => send(EVENTS.live, e),
      settings: () => repo.settings(),
      sessionFile: (id) => repo.sessionFile(id),
      saveSession: (name, state) => repo.saveSession(name, state),
      chooseFiles: async (multiple) => {
        showWindow();
        const o: Electron.OpenDialogOptions = { title: 'Choose files to upload', properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'] };
        const res = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o);
        return res.canceled ? [] : res.filePaths;
      },
      askDialog: async ({ type, message, defaultValue }) => {
        showWindow();
        const kind = type === 'confirm' ? 'confirmation' : type === 'prompt' ? 'prompt' : 'alert';
        const o: Electron.MessageBoxOptions = {
          type: 'question',
          title: 'The page opened a dialog',
          message: `The page shows a ${kind}:\n\n“${message}”`,
          detail:
            type === 'prompt'
              ? `It will be answered with “${defaultValue}”. You can change the text afterwards in the step editor.`
              : 'Your choice is recorded as a step and repeated on every run.',
          buttons: type === 'alert' ? ['OK'] : ['Accept', 'Dismiss'],
          defaultId: 0,
          cancelId: type === 'alert' ? 0 : 1,
          noLink: true,
        };
        const res = win ? await dialog.showMessageBox(win, o) : await dialog.showMessageBox(o);
        return { accept: res.response === 0 };
      },
    });

    let scheduler: Scheduler;
    const runner = new RunManager({
      repo,
      recorderSource: RECORDER_SOURCE,
      emit: (e) => send(EVENTS.runs, e),
      onFinished: (run) => {
        scheduler?.onRunFinished(run.scheduleId, run.status);
        const s = repo.settings();
        if (!s.notifications || !Notification.isSupported()) return;
        if (win && win.isVisible() && win.isFocused()) return;
        const t = run.totals;
        const title = run.status === 'passed' ? `${run.flowName} passed` : run.status === 'stopped' ? `${run.flowName} stopped` : `${run.flowName} failed`;
        const n = new Notification({ title, body: `${t.passed} of ${t.total} iterations passed${t.failed ? `, ${t.failed} failed` : ''}.`, icon: iconPath });
        n.on('click', () => {
          showWindow();
          send(EVENTS.navigate, `/runs/${run.id}`);
        });
        n.show();
      },
    });
    scheduler = new Scheduler(
      repo,
      (flowId, options, scheduleId) => runner.start(flowId, options, 'schedule', scheduleId),
      (scheduleId) => runner.activeForSchedule(scheduleId),
    );

    repo.on('change', (what: RepoEvent) => {
      switch (what) {
        case 'flows':
          send(EVENTS.flows, repo.listFlows());
          break;
        case 'settings': {
          const s = repo.settings();
          send(EVENTS.settings, s);
          break;
        }
        case 'datasets':
          send(EVENTS.datasets, repo.listDatasets());
          break;
        case 'schedules':
          send(EVENTS.schedules, repo.listSchedules());
          break;
        case 'sessions':
          send(EVENTS.sessions, repo.listSessions());
          break;
      }
    });

    const applyTitleBar = (theme: 'dark' | 'light') => {
      const t = THEME[theme];
      if (!win || win.isDestroyed()) return;
      try {
        win.setTitleBarOverlay({ color: t.bar, symbolColor: t.symbol, height: 44 });
      } catch {
        /* not supported on this platform */
      }
      win.setBackgroundColor(t.bg);
    };
    const applyLoginItem = (s: Settings) => {
      if (!app.isPackaged) return;
      app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, args: ['--hidden'] });
    };

    registerIpc({ repo, live, runner, scheduler, window: () => win, send, resourcesDir, applyTitleBar, applyLoginItem });

    const buildTray = () => {
      const img = existsSync(iconPath) ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
      tray = new Tray(img);
      tray.setToolTip('Xero Browser Automation');
      const menu = Menu.buildFromTemplate([
        { label: 'Open Xero', click: () => showWindow() },
        {
          label: 'New recording',
          click: () => {
            showWindow();
            send(EVENTS.navigate, '/record');
          },
        },
        { type: 'separator' },
        {
          label: 'Stop all runs',
          click: () => void runner.stopAll(),
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]);
      tray.setContextMenu(menu);
      tray.on('click', () => showWindow());
    };

    buildTray();
    createWindow();
    scheduler.start();
    applyLoginItem(settings);

    nativeTheme.on('updated', () => {
      if (repo.settings().theme === 'system') applyTitleBar(resolvedTheme(repo.settings()));
    });

    let cleanedUp = false;
    app.on('before-quit', (e) => {
      quitting = true;
      if (cleanedUp) return;
      // Let runs save their final state and browsers close before the process exits.
      e.preventDefault();
      scheduler.stop();
      const timeout = new Promise((r) => setTimeout(r, 6000));
      void Promise.race([Promise.all([runner.stopAll(), live.close()]), timeout])
        .catch(() => undefined)
        .finally(() => {
          cleanedUp = true;
          app.quit();
        });
    });

    app.on('activate', () => {
      if (!win) createWindow();
      else showWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !tray) app.quit();
  });
}
