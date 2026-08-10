import { ipcMain, session } from 'electron';

let cachedToken: string | null = null;
let currentApiOrigin: string | null = null;
let listenerInstalled = false;

const UPLOAD_PATH_RE = /^\/(?:uploads|downloads)\//;
const SNAPSHOT_PATH_RE = /^\/api\/v3\/documents\/snapshot/;

function shouldInject(rawUrl: string): boolean {
  if (!currentApiOrigin) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.origin !== currentApiOrigin) return false;
  return UPLOAD_PATH_RE.test(parsed.pathname) || SNAPSHOT_PATH_RE.test(parsed.pathname);
}

function installListenerOnce(): void {
  if (listenerInstalled) return;
  // Single permanent listener — we filter by currentApiOrigin inside.
  // Electron has no clean removal API for webRequest listeners, so rebinding to a new
  // origin (devcrm ↔ crm) just updates currentApiOrigin and the same listener picks up.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!cachedToken || !shouldInject(details.url)) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    const headers = { ...details.requestHeaders };
    const hasAuth = Object.keys(headers).some((k) => k.toLowerCase() === 'authorization');
    if (!hasAuth) {
      headers['Authorization'] = `Bearer ${cachedToken}`;
    }
    callback({ requestHeaders: headers });
  });
  listenerInstalled = true;
}

export function bindUploadsAuth(apiBaseUrl: string): void {
  try {
    currentApiOrigin = new URL(apiBaseUrl).origin;
  } catch {
    currentApiOrigin = null;
  }
  installListenerOnce();
}

export function unbindUploadsAuth(): void {
  currentApiOrigin = null;
}

export function getCachedToken(): string | null {
  return cachedToken;
}

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:setToken', (_e, token: unknown) => {
    cachedToken = typeof token === 'string' && token.length > 0 ? token : null;
  });
}
