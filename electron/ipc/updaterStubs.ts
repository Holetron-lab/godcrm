import { ipcMain, BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';

// ADR-0023 Phase 6: real auto-updater wiring (electron-updater + GitHub Releases per D1=B).
// Channel/event names match preload.ts subscriptions (updater:available/notAvailable/progress/downloaded/error).
// File name kept as updaterStubs.ts to minimize churn — content is no longer stubs.

let registered = false;

export function registerUpdaterStubs(getMainWindow: () => BrowserWindow | null): void {
  if (registered) return;
  registered = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const broadcast = (channel: string, payload?: unknown) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    broadcast('updater:available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    broadcast('updater:notAvailable', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    broadcast('updater:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    broadcast('updater:downloaded', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('error', (err: Error) => {
    broadcast('updater:error', { message: err?.message ?? String(err) });
  });

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        success: true,
        updateInfo: result?.updateInfo
          ? {
              version: result.updateInfo.version,
              releaseDate: result.updateInfo.releaseDate,
              releaseNotes: result.updateInfo.releaseNotes,
            }
          : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.on('updater:quitAndInstall', () => {
    autoUpdater.quitAndInstall();
  });
}
