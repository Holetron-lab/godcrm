import { ipcMain, shell, net, BrowserWindow } from 'electron';
import { getCurrentApiUrl } from './apiUrl';

export const OAUTH_PROTOCOL = 'god-crm';

interface OAuthSuccess {
  success: true;
  token: string;
  refreshToken?: string;
  email?: string;
  name?: string;
}

interface OAuthFailure {
  success: false;
  error: string;
}

type OAuthResult = OAuthSuccess | OAuthFailure;

interface PendingFlow {
  resolve: (result: OAuthResult) => void;
  timer: NodeJS.Timeout;
}

let pending: PendingFlow | null = null;

const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url });
    let body = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body) as T);
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${(err as Error).message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function settle(result: OAuthResult): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  const resolve = pending.resolve;
  pending = null;
  resolve(result);
}

export function handleProtocolUrl(url: string): boolean {
  if (!url.startsWith(`${OAUTH_PROTOCOL}://`)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    settle({ success: false, error: 'Malformed callback URL' });
    return true;
  }

  // Path can be `auth/callback` (host=auth, pathname=/callback) or just `auth` — accept both.
  const isAuthCallback =
    parsed.host === 'auth' &&
    (parsed.pathname === '/callback' || parsed.pathname === '/' || parsed.pathname === '');
  if (!isAuthCallback) {
    return true;
  }

  const error = parsed.searchParams.get('error');
  if (error) {
    settle({ success: false, error });
    return true;
  }

  const token = parsed.searchParams.get('token');
  if (!token) {
    settle({ success: false, error: 'No token in callback' });
    return true;
  }

  settle({
    success: true,
    token,
    refreshToken: parsed.searchParams.get('refresh_token') ?? undefined,
    email: parsed.searchParams.get('email') ?? undefined,
    name: parsed.searchParams.get('name') ?? undefined,
  });
  return true;
}

export function registerGoogleOAuth(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('oauth:google:open', async (): Promise<OAuthResult> => {
    if (pending) {
      return { success: false, error: 'Another sign-in is already in progress' };
    }

    let authUrl: string;
    try {
      const apiUrl = await getCurrentApiUrl();
      const endpoint = `${apiUrl.replace(/\/$/, '')}/auth/google/mobile-auth-url?app_scheme=${encodeURIComponent(OAUTH_PROTOCOL)}`;
      const response = await fetchJson<{ success?: boolean; data?: { url?: string }; url?: string; error?: { message?: string } }>(endpoint);
      const url = response.data?.url ?? response.url;
      if (!url) {
        return { success: false, error: response.error?.message ?? 'Backend did not return auth URL' };
      }
      authUrl = url;
    } catch (err) {
      return { success: false, error: `Failed to start Google sign-in: ${(err as Error).message}` };
    }

    const result = await new Promise<OAuthResult>((resolve) => {
      const timer = setTimeout(() => {
        settle({ success: false, error: 'Google sign-in timed out — please retry' });
      }, FLOW_TIMEOUT_MS);
      pending = { resolve, timer };
      shell.openExternal(authUrl).catch((err) => {
        settle({ success: false, error: `Failed to open browser: ${(err as Error).message}` });
      });
    });

    if (result.success) {
      const win = getMainWindow();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    }
    return result;
  });
}

export function cancelPendingOAuth(reason = 'Cancelled'): void {
  if (pending) settle({ success: false, error: reason });
}
