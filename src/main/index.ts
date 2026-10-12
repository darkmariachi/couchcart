import { hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, app, safeStorage, session, type IpcMainInvokeEvent } from 'electron';
import type { IpcEvents } from '../shared/ipc';
import { registerIpcHandlers } from './ipc/handlers';
import { LauncherApp } from './launcherApp';
import { log } from './logging/logger';
import type { Encryptor } from './romm/credentials';

// Set by electron-vite while developing; absent in a packaged build.
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const rendererFile = join(__dirname, '../renderer/index.html');
const rendererOrigin = devServerUrl ?? pathToFileURL(rendererFile).href;

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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
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
      onLaunchStateChanged: (state) => {
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
      },
    });
    registerIpcHandlers(launcher, isTrustedSender);
    mainWindow = createWindow();
    log.info(`RomM Launcher ${app.getVersion()} started`);
  });
}
