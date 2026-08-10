import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../src/shared/types/electron.types';

type EventCleanup = () => void;

function subscribe<T>(channel: string, callback: (payload: T) => void): EventCleanup {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ElectronAPI = {
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  getApiUrl: () => ipcRenderer.invoke('apiUrl:get'),
  setApiUrl: (url) => ipcRenderer.invoke('apiUrl:set', url),
  testApiConnection: (url) => ipcRenderer.invoke('apiUrl:test', url),

  setAuthToken: (token) => ipcRenderer.invoke('auth:setToken', token),

  openGoogleOAuth: () => ipcRenderer.invoke('oauth:google:open'),

  getAppInfo: () => ipcRenderer.invoke('app:info'),

  platform: process.platform as 'win32' | 'darwin' | 'linux',
  isDesktop: true,

  showContextMenu: (options) => ipcRenderer.send('app:contextMenu', options ?? {}),

  onOpenInNewTab: (cb) => subscribe<string>('app:openInNewTab', cb),
  onOpenSettings: (cb) => subscribe<void>('app:openSettings', () => cb()),
  onNavigate: (cb) => subscribe<string>('app:navigate', cb),

  // Remote loader — STUBS in v1 (renderer always loads from local file://, see ADR-0023 §4)
  // Surface kept so existing UI doesn't crash; real remote loader = future ADR.
  getAppUrl: () => ipcRenderer.invoke('loader:getAppUrl'),
  setAppUrl: (url) => ipcRenderer.invoke('loader:setAppUrl', url),
  getLoadMode: () => ipcRenderer.invoke('loader:getLoadMode'),
  setLoadMode: (mode) => ipcRenderer.invoke('loader:setLoadMode', mode),
  checkServerHealth: (url) => ipcRenderer.invoke('loader:checkServerHealth', url),
  reloadApp: () => ipcRenderer.invoke('loader:reload'),

  // Auto-updater — STUBS in v1 (real impl lands in ADR-0023 Phase 6)
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstall: () => ipcRenderer.send('updater:quitAndInstall'),
  onUpdateAvailable: (cb) => subscribe('updater:available', cb),
  onUpdateNotAvailable: (cb) => subscribe('updater:notAvailable', cb),
  onUpdateDownloadProgress: (cb) => subscribe('updater:progress', cb),
  onUpdateDownloaded: (cb) => subscribe('updater:downloaded', cb),
  onUpdateError: (cb) => subscribe('updater:error', cb),
};

contextBridge.exposeInMainWorld('electronAPI', api);
