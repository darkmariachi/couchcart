import { hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BrowserWindow,
  app,
  dialog,
  protocol,
  safeStorage,
  session,
  type IpcMainInvokeEvent,
} from 'electron';
import type { IpcEvents, LaunchState } from '../shared/ipc';
import { registerIpcHandlers } from './ipc/handlers';
import { LauncherApp } from './launcherApp';
import { COVER_SCHEME, createCoverHandler } from './library/coverProtocol';
import { log } from './logging/logger';
import type { Encryptor } from './romm/credentials';

// Set by electron-vite while developing; absent in a packaged build.
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const rendererFile = join(__dirname, '../renderer/index.html');
const rendererOrigin = devServerUrl ?? pathToFileURL(rendererFile).href;

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
    backgroundColor: '#150f26',
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

  const onLaunchStateChanged = (state: LaunchState) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const event: keyof IpcEvents = 'game:stateChanged';
    mainWindow.webContents.send(event, state);

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

    const launcher = new LauncherApp({
      dataDir: app.getPath('userData'),
      hostname: hostname(),
      appVersion: app.getVersion(),
      encryptor: osEncryptor,
      onLaunchStateChanged,
      shell: {
        chooseDirectory: async (startIn) => {
          if (!mainWindow) return null;
          const result = await dialog.showOpenDialog(mainWindow, {
            defaultPath: startIn,
            properties: ['openDirectory', 'createDirectory'],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        quit: () => app.quit(),
        toggleFullscreen: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()),
      },
    });

    protocol.handle(
      COVER_SCHEME,
      createCoverHandler(join(app.getPath('userData'), 'covers'), () => launcher.coverSource),
    );
    registerIpcHandlers(launcher, isTrustedSender);
    mainWindow = createWindow(shouldStartFullscreen(launcher.launcherFullscreen));
    log.info(`RomM Launcher ${app.getVersion()} started`);
  });
}
