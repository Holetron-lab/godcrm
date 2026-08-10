import { ipcMain, app, BrowserWindow } from 'electron';

type WindowGetter = () => BrowserWindow | null;

export function registerAppHandlers(_getWindow: WindowGetter): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
  }));
}
