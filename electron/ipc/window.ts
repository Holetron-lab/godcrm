import { ipcMain, BrowserWindow } from 'electron';

type WindowGetter = () => BrowserWindow | null;

export function registerWindowHandlers(getWindow: WindowGetter): void {
  ipcMain.on('window:minimize', () => {
    getWindow()?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    getWindow()?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return getWindow()?.isMaximized() ?? false;
  });
}
