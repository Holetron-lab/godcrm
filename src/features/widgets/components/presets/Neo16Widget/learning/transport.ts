/**
 * Neo16 W2-S5 — HTTP transport for `/api/v3/neo16/*`.
 *
 * Not `apiClient.post`: that helper collapses every non-2xx reply into a plain
 * `Error(message)`, and this panel must branch on the HTTP status and the error
 * `code` (409 stale vs 409 binding, 502 retryable). It reuses the client's token
 * and base URL so desktop and web modes keep working.
 */
import { getAccessToken, getBaseUrlSync } from '@/shared/utils/apiClient';
import {
  Neo16ApiError,
  type CommandResult,
  type Neo16Transport,
  type SessionState,
  type StartResult,
} from './types';

interface ErrorBody { success?: false; error?: { code?: string; message?: string; details?: unknown } }

export async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${getBaseUrlSync()}/neo16${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let parsed: unknown = null;
  const text = await response.text();
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  }

  // `stale` is a RESULT the router sends with HTTP 409 inside the success envelope
  // (`{ success: true, data: { status: 'stale' } }`), not an error body.
  const envelope = parsed as { success?: boolean; data?: unknown } | null;
  if (!response.ok && !(envelope?.success === true && envelope.data !== undefined)) {
    const err = (parsed as ErrorBody | null)?.error;
    throw new Neo16ApiError(
      response.status,
      err?.code ?? `HTTP_${response.status}`,
      err?.message ?? `Request failed (${response.status})`,
      err?.details,
    );
  }
  const data = parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)
    ? (parsed as { data: T }).data
    : (parsed as T);
  return { status: response.status, body: data };
}

export function createHttpTransport(): Neo16Transport {
  return {
    startSession: (env) => call<StartResult>('POST', '/sessions', { data: env }),
    sendCommand: (sessionId, env) => call<CommandResult>('POST', `/sessions/${sessionId}/commands`, { data: env }),
    getState: async (sessionId, widgetId) =>
      (await call<SessionState>('GET', `/sessions/${sessionId}/state?widget_id=${widgetId}`)).body,
  };
}
