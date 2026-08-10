import { app, BrowserWindow, ipcMain, Menu, shell, session, screen } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { autoUpdater } from 'electron-updater';
import { registerWindowHandlers } from './ipc/window';
import { registerApiUrlHandlers, getCurrentApiUrl } from './ipc/apiUrl';
import { registerAppHandlers } from './ipc/app';
import { registerOAuthStub } from './ipc/oauthStub';
import { registerLoaderStubs } from './ipc/loaderStubs';
import { registerUpdaterStubs } from './ipc/updaterStubs';
import { registerContextMenuHandler } from './ipc/contextMenu';
import { registerAuthHandlers, bindUploadsAuth } from './ipc/auth';

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const width = Math.min(1400, workAreaSize.width);
  const height = Math.min(900, workAreaSize.height);
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 480,
    minHeight: 600,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    show: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  Menu.setApplicationMenu(null);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
  const indexFileUrl = pathToFileURL(indexPath).toString();

  win.webContents.on('will-navigate', (event, url) => {
    const isViteDev = !!process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL);
    if (isViteDev) return;

    if (url.startsWith('file://')) {
      // Allow only the bundle's own index.html (with optional ?query or #hash). Stray
      // file:// navigations like file:///dashboard come from <a href="/x"> or
      // window.location.href = '/x' that bypass HashRouter — re-route them through it.
      if (url === indexFileUrl || url.startsWith(indexFileUrl + '#') || url.startsWith(indexFileUrl + '?')) {
        return;
      }
      event.preventDefault();
      try {
        const targetPath = new URL(url).pathname || '/';
        win.loadURL(`${indexFileUrl}#${targetPath}`);
      } catch {
        win.loadURL(indexFileUrl);
      }
      return;
    }

    event.preventDefault();
    shell.openExternal(url);
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(indexPath);
  }

  win.once('ready-to-show', () => win.show());

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: wss:",
        ],
      },
    });
  });

  mainWindow = createWindow();

  registerWindowHandlers(() => mainWindow);
  registerApiUrlHandlers();
  registerAuthHandlers();
  getCurrentApiUrl().then(bindUploadsAuth);
  registerAppHandlers(() => mainWindow);
  registerOAuthStub();
  registerLoaderStubs();
  registerUpdaterStubs(() => mainWindow);
  registerContextMenuHandler(() => mainWindow);

  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Silent fail — offline / no release / GH unreachable. UpdateNotification stays in idle state.
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

ipcMain.on('app:reload', () => {
  if (mainWindow) mainWindow.reload();
});
