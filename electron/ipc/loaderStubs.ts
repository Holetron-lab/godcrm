import { ipcMain, BrowserWindow } from 'electron';

// Remote-loader stubs — see ADR-0023 Decision §4 + Out of scope.
// In v1 the renderer ALWAYS loads from local file:// bundle. These IPC channels exist
// only so the existing UI components (DesktopSettingsModal, LoadModeIndicator) don't crash.
// Real remote-loader = future ADR.
export function registerLoaderStubs(): void {
  ipcMain.handle('loader:getAppUrl', () => '');
  ipcMain.handle('loader:setAppUrl', () => false);
  ipcMain.handle('loader:getLoadMode', () => 'local' as const);
  ipcMain.handle('loader:setLoadMode', () => false);
  ipcMain.handle('loader:checkServerHealth', () => false);

  ipcMain.handle('loader:reload', () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return false;
    win.reload();
    return true;
  });
}
