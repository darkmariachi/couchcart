import electronUpdater, { type ProgressInfo } from 'electron-updater';
import { log } from '../logging/logger';
import type { SelfUpdater } from './updateService';

/**
 * The self-updater for the installed Windows build and the AppImage. The update is
 * fetched from the GitHub release named in the app's bundled `app-update.yml`.
 */
export function createSelfUpdater(): SelfUpdater {
  const { autoUpdater } = electronUpdater;
  // The service decides when to download, so a check alone never fetches anything.
  autoUpdater.autoDownload = false;
  // A downloaded version that was not installed by hand goes in when the app closes.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message) => log.info(`Updater: ${String(message)}`),
    warn: (message) => log.warn(`Updater: ${String(message)}`),
    error: (message) => log.warn(`Updater: ${String(message)}`),
  };

  return {
    async latestVersion() {
      const result = await autoUpdater.checkForUpdates();
      if (!result) throw new Error('This copy of the app cannot check for updates.');
      return result.updateInfo.version;
    },
    async download(onProgress) {
      const report = (progress: ProgressInfo) => onProgress(progress.percent);
      autoUpdater.on('download-progress', report);
      try {
        await autoUpdater.downloadUpdate();
      } finally {
        autoUpdater.removeListener('download-progress', report);
      }
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall();
    },
  };
}
