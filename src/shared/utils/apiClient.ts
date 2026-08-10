// ✅ v3 API - чистая архитектура без legacy
import { logger } from './logger';
// Support for both web and desktop (Electron) modes
import { isDesktopApp } from '../types/electron.types';

// Default BASE_URL for web mode (relative path)
const DEFAULT_WEB_URL = '/api/v3';

// Default BASE_URL for desktop mode (absolute URL)
const DEFAULT_DESKTOP_URL = 'https://crm.hltrn.cc/api/v3';

// Cached API URL for desktop mode
let cachedApiUrl: string | null = null;

// Flag to track if we're initialized
let isInitialized = false;

// Ensure the URL ends with /api/v3 — guards against legacy settings.json
// values that pre-date the desktop default alignment fix.
const normalizeApiUrl = (url: string): string => {
  const trimmed = url.replace(/\/+$/, '');
  return /\/api\/v3$/i.test(trimmed) ? trimmed : `${trimmed}/api/v3`;
};

/**
 * Get the API base URL
 * - In web mode: returns '/api/v3'
 * - In desktop mode: returns URL from electron store or default
 */
const getBaseUrl = async (): Promise<string> => {
  if (isDesktopApp() && window.electronAPI) {
    if (!cachedApiUrl) {
      cachedApiUrl = normalizeApiUrl(await window.electronAPI.getApiUrl());
    }
    return cachedApiUrl;
  }
  return DEFAULT_WEB_URL;
};

/**
 * Get base URL synchronously
 * IMPORTANT: For desktop app, always returns a valid HTTPS URL
 */
export const getBaseUrlSync = (): string => {
  // Desktop app - use cached URL or default HTTPS URL
  if (isDesktopApp()) {
    return cachedApiUrl || DEFAULT_DESKTOP_URL;
  }
  // Web app - use relative path
  return DEFAULT_WEB_URL;
};

/**
 * Update cached API URL (called from settings)
 */
export const setApiBaseUrl = (url: string): void => {
  cachedApiUrl = normalizeApiUrl(url);
  isInitialized = true;
};

/**
 * Initialize API URL cache (call on app start in desktop mode)
 */
export const initApiUrl = async (): Promise<string> => {
  if (isDesktopApp() && window.electronAPI) {
    cachedApiUrl = normalizeApiUrl(await window.electronAPI.getApiUrl());
    isInitialized = true;
    logger.debug('[apiClient] Initialized with URL:', cachedApiUrl);
    // If auth-store hydration ran before main was ready to receive the token, repush now.
    if (accessToken) pushTokenToElectron(accessToken);
  }
  return getBaseUrlSync();
};

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

const pushTokenToElectron = (token: string | null): void => {
  if (typeof window === 'undefined') return;
  const api = window.electronAPI;
  if (!api?.setAuthToken) return;
  // Fire-and-forget: <img> auth bridge is best-effort, never block login/refresh on it.
  api.setAuthToken(token).catch(() => {
    /* main process unavailable — fall through */
  });
};

const parseResponse = async <T>(response: Response): Promise<T> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  // @ts-expect-error - allow returning null when no JSON body
  return null;
};

const requestRefreshToken = async (): Promise<string | null> => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      // ✅ v3 auth - use dynamic base URL
      const baseUrl = getBaseUrlSync();
      const response = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!response.ok) {
        refreshPromise = null;
        return null;
      }
      const data = await parseResponse<{ data?: { accessToken: string } }>(response);
      const token = data?.data?.accessToken ?? null;
      refreshPromise = null;
      return token;
    })();
  }
  return refreshPromise;
};

const buildHeaders = (initHeaders?: HeadersInit) => {
  const headers = new Headers(initHeaders);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
};

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  retry?: boolean;
}

const internalFetch = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const { skipAuth = false, retry = true, ...init } = options;
  const headers = buildHeaders(init.headers);

  if (!skipAuth && accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  // Use dynamic base URL for desktop app support
  const baseUrl = getBaseUrlSync();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    credentials: init.credentials ?? 'include'
  });

  if (response.status === 401 && !skipAuth && retry) {
    const newToken = await requestRefreshToken();
    if (newToken) {
      setAccessToken(newToken);
      return internalFetch<T>(path, { ...options, retry: false });
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    const sanitizedError = contentType.includes('text/html')
      ? `Request failed (${response.status})`
      : errorText;
    throw new Error(sanitizedError || 'Request failed');
  }

  if (response.status === 204) {
    // @ts-expect-error allow undefined body for no-content responses
    return null;
  }

  return parseResponse<T>(response);
};

/**
 * Get the current access token
 * Exported for use by other modules that need auth (e.g., MindWorkflow)
 */
export const getAccessToken = (): string | null => accessToken;

/**
 * Set the access token
 * Exported for use by auth modules
 */
export const setAccessToken = (token: string | null): void => {
  accessToken = token;
  pushTokenToElectron(token);
};

const apiClient = {
  setAccessToken,
  getAccessToken,
  request: internalFetch,
  
  // Convenience methods
  get: <T>(path: string, options?: RequestOptions) => 
    internalFetch<T>(path, { ...options, method: 'GET' }),
    
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => 
    internalFetch<T>(path, { 
      ...options, 
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    }),
    
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => 
    internalFetch<T>(path, { 
      ...options, 
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined
    }),
    
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => 
    internalFetch<T>(path, { 
      ...options, 
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined
    }),
    
  delete: <T>(path: string, options?: RequestOptions) =>
    internalFetch<T>(path, { ...options, method: 'DELETE' }),
};

export { apiClient };
export default apiClient;
