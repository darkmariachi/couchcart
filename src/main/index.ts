import { existsSync, renameSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BrowserWindow,
  app,
  clipboard,
  dialog,
  protocol,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { APP_ID, APP_NAME, LEGACY_APP_ID } from '../shared/app';
import type { IpcEvents, LaunchState } from '../shared/ipc';
import { registerIpcHandlers } from './ipc/handlers';
import { LauncherApp } from './launcherApp';
import { COVER_SCHEME, createCoverHandler } from './library/coverProtocol';
import { enableFileLogging, log } from './logging/logger';
import type { Encryptor } from './romm/credentials';

// Set by electron-vite while developing; absent in a packaged build.
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const rendererFile = join(__dirname, '../renderer/index.html');
const rendererOrigin = devServerUrl ?? pathToFileURL(rendererFile).href;

// The data folder is fixed by name, so the installed app, the portable build and a
// development run all share one library, session and set of saves.
if (!process.argv.some((argument) => argument.startsWith('--user-data-dir'))) {
  app.setPath('userData', resolveDataDir(app.getPath('appData')));
}

/**
 * The app's data folder. A folder from before the app was renamed is taken over, so an
 * upgrade keeps the session, library and saves; if it cannot be moved (another copy of
 * the app has it open), it is used where it is.
 */
function resolveDataDir(appData: string): string {
  const current = join(appData, APP_ID);
  const legacy = join(appData, LEGACY_APP_ID);
  if (existsSync(current) || !existsSync(legacy)) return current;
  try {
    renameSync(legacy, current);
    return current;
  } catch {
    return legacy;
  }
}

// Must happen before the app is ready. "standard" gives the scheme normal URL parsing and
// "secure" lets a page with a strict CSP load images from it.
protocol.registerSchemesAsPrivileged([
  { scheme: COVER_SCHEME, privileges: { standard: true, secure: true } },
]);

const osEncryptor: Encryptor = {
  // On Linux without a keyring, safeStorage silently falls back to a hard-coded key
  // ("basic_text"), which is no better than plain text, so it counts as unavailable.
  isAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encrypt: (plainText) => safeStorage.encryptString(plainText),
  decrypt: (cipherText) => safeStorage.decryptString(cipherText),
};

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(rendererOrigin) ?? false;
}

/** `--fullscreen` and `--windowed` on the command line win over the saved setting. */
function shouldStartFullscreen(setting: boolean): boolean {
  if (process.argv.includes('--windowed')) return false;
  if (process.argv.includes('--fullscreen')) return true;
  return setting;
}

function createWindow(fullscreen: boolean): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen,
    // No title bar: the app draws its own header, which doubles as the drag handle.
    frame: false,
    backgroundColor: '#07070f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The UI is a single bundled page: it never leaves its origin and never opens windows.
  // Same-origin navigation stays allowed so Vite can reload the page during development.
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererOrigin)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadFile(rendererFile);
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;

  /** Pushes an event to the UI, if there is a window to receive it. */
  const send = <E extends keyof IpcEvents>(event: E, payload: IpcEvents[E]) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
  };

  const onLaunchStateChanged = (state: LaunchState) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    send('game:stateChanged', state);

    // Get out of the way while the game runs, and take the screen back when it ends.
    if (state.phase === 'running') mainWindow.hide();
    const gameEnded = state.phase === 'syncing' && state.stage === 'after-exit';
    if (gameEnded && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };

  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });

  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );

    enableFileLogging(join(app.getPath('userData'), 'logs', 'launcher.log'));

    const launcher = new LauncherApp({
      dataDir: app.getPath('userData'),
      hostname: hostname(),
      appVersion: app.getVersion(),
      encryptor: osEncryptor,
      onLaunchStateChanged,
      onDownloadsChanged: (jobs) => send('downloads:changed', jobs),
      onOnlineChanged: (online) => send('app:onlineChanged', online),
      shell: {
        choosePath: async (kind, startIn) => {
          if (!mainWindow) return null;
          const result = await dialog.showOpenDialog(mainWindow, {
            defaultPath: startIn,
            properties: kind === 'file' ? ['openFile'] : ['openDirectory', 'createDirectory'],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        quit: () => app.quit(),
        toggleFullscreen: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()),
        copyText: (text) => clipboard.writeText(text),
        openFolder: (path) => void shell.openPath(path),
        openExternal: (url) => void shell.openExternal(url),
      },
    });

    protocol.handle(
      COVER_SCHEME,
      createCoverHandler(join(app.getPath('userData'), 'covers'), () => launcher.coverSource),
    );
    registerIpcHandlers(launcher, isTrustedSender);
    launcher.start();
    app.on('before-quit', () => launcher.stop());
    mainWindow = createWindow(shouldStartFullscreen(launcher.launcherFullscreen));
    log.info(`${APP_NAME} ${app.getVersion()} started`);
  });
}
