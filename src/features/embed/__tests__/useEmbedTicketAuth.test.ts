// @vitest-environment-options {"url":"https://app.godcrm.ai/embed/chat?auth=ticket&client_id=level&space=11"}
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { getTicketEmbedConfig, isTicketEmbedRequest, useEmbedTicketAuth } from '../useEmbedTicketAuth';

const parentOrigin = 'https://admin.sixtynine.ru';
const user = { id: '77', email: 'admin@example.test', name: 'Admin', role: 'admin' as const };

function redemptionResponse(accessToken: string, spaceId = 35) {
  return new Response(JSON.stringify({
    data: { accessToken, expiresIn: 900, user, space_id: spaceId },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function bootstrap(ticket: string, options: { origin?: string; source?: Window | null } = {}) {
  window.dispatchEvent(new MessageEvent('message', {
    origin: options.origin ?? parentOrigin,
    source: (options.source === undefined ? window.parent : options.source) as MessageEventSource | null,
    data: { type: 'godcrm-embed:bootstrap', version: 1, ticket },
  }));
}

describe('ADR-210 iframe ticket session', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/embed/chat?auth=ticket&client_id=level&space=11');
    Object.defineProperty(document, 'referrer', { configurable: true, get: () => `${parentOrigin}/admin` });
    useAuthStore.setState({ user: null, token: null, loading: false, error: null, initialized: false });
    apiClient.setAccessToken(null);
    apiClient.setEmbedReauthHandler(null);
    window.localStorage.clear();
    vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    apiClient.setEmbedReauthHandler(null);
    apiClient.setAccessToken(null);
    vi.restoreAllMocks();
  });

  it('redeems only an exact-origin parent bootstrap into non-persisted Space 35 auth', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(redemptionResponse('embed-token'));
    const { result, unmount } = renderHook(() => useEmbedTicketAuth(getTicketEmbedConfig()));

    expect(isTicketEmbedRequest()).toBe(true);
    expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: 'godcrm-embed:ready', version: 1, client_id: 'level',
    }, parentOrigin);

    bootstrap('wrong-origin', { origin: 'https://evil.example' });
    bootstrap('wrong-source', { source: null });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => bootstrap('one-time-ticket'));
    await vi.waitFor(() => expect(result.current.session?.spaceId).toBe(35));
    expect(fetchMock).toHaveBeenCalledWith('/api/v3/embed/session', expect.objectContaining({
      method: 'POST', credentials: 'omit', cache: 'no-store',
    }));
    expect(apiClient.getAccessToken()).toBe('embed-token');
    expect(useAuthStore.getState()).toMatchObject({ user, token: null, initialized: true });
    expect(window.localStorage.getItem('god-crm-auth')).toBeNull();
    expect(window.location.href).not.toContain('one-time-ticket');
    unmount();
    expect(apiClient.getAccessToken()).toBeNull();
  });

  it('uses a fresh ticket on API 401 without cookie refresh and retries with the new Bearer', async () => {
    let secureCalls = 0;
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/v3/embed/session') {
        return redemptionResponse(fetchMock.mock.calls.length === 1 ? 'expired-token' : 'renewed-token');
      }
      if (url === '/api/v3/secure') {
        secureCalls += 1;
        return secureCalls === 1
          ? new Response('', { status: 401 })
          : new Response(JSON.stringify({ data: { ok: true } }), {
              status: 200, headers: { 'content-type': 'application/json' },
            });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useEmbedTicketAuth(getTicketEmbedConfig()));
    await act(async () => bootstrap('initial-ticket'));
    await vi.waitFor(() => expect(result.current.session).not.toBeNull());

    let request!: Promise<{ data: { ok: boolean } }>;
    act(() => { request = apiClient.request('/secure'); });
    await vi.waitFor(() => expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: 'godcrm-embed:reauth', version: 1, client_id: 'level',
    }, parentOrigin));
    await act(async () => bootstrap('fresh-ticket'));
    await act(async () => { await expect(request).resolves.toEqual({ data: { ok: true } }); });

    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain('/api/v3/auth/refresh');
    expect(apiClient.getAccessToken()).toBe('renewed-token');
    const retryInit = fetchMock.mock.calls.at(-1)?.[1];
    expect(new Headers(retryInit?.headers).get('Authorization')).toBe('Bearer renewed-token');
    expect(window.localStorage.getItem('god-crm-auth')).toBeNull();
  });

  it('keeps the ready workspace mounted while renewing a ticket after API 401', async () => {
    let redemptionCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/v3/embed/session') {
        redemptionCalls += 1;
        return redemptionResponse(redemptionCalls === 1 ? 'initial-token' : 'renewed-token');
      }
      if (url === '/api/v3/secure') return new Response('', { status: 401 });
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useEmbedTicketAuth(getTicketEmbedConfig()));
    await act(async () => bootstrap('initial-ticket'));
    await vi.waitFor(() => expect(result.current.status).toBe('ready'));

    let request!: Promise<unknown>;
    act(() => { request = apiClient.request('/secure'); });
    const rejection = expect(request).rejects.toThrow();
    await vi.waitFor(() => expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: 'godcrm-embed:reauth', version: 1, client_id: 'level',
    }, parentOrigin));

    expect(result.current.status).toBe('ready');
    expect(result.current.session).not.toBeNull();
    await act(async () => bootstrap('fresh-ticket'));
    await rejection;
    expect(result.current.status).toBe('ready');
    expect(apiClient.getAccessToken()).toBe('renewed-token');
  });

  it('fails closed when membership revocation rejects fresh-ticket renewal', async () => {
    let redemptionCalls = 0;
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/v3/embed/session') {
        redemptionCalls += 1;
        return redemptionCalls === 1 ? redemptionResponse('initial-token') : new Response('', { status: 401 });
      }
      if (url === '/api/v3/secure') return new Response('', { status: 401 });
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useEmbedTicketAuth(getTicketEmbedConfig()));
    await act(async () => bootstrap('initial-ticket'));
    await vi.waitFor(() => expect(result.current.session).not.toBeNull());

    let request!: Promise<unknown>;
    act(() => { request = apiClient.request('/secure'); });
    const rejection = expect(request).rejects.toThrow();
    await vi.waitFor(() => expect(window.parent.postMessage).toHaveBeenCalledWith({
      type: 'godcrm-embed:reauth', version: 1, client_id: 'level',
    }, parentOrigin));
    await act(async () => bootstrap('revoked-membership-ticket'));
    await rejection;

    expect(result.current.status).toBe('error');
    expect(result.current.session).toBeNull();
    expect(apiClient.getAccessToken()).toBeNull();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain('/api/v3/auth/refresh');
  });

  it.each([
    ['replayed', 401],
    ['expired', 401],
    ['malformed', 400],
  ])('shows a controlled error for a %s ticket without a login redirect', async (label, status) => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status }));
    const { result } = renderHook(() => useEmbedTicketAuth(getTicketEmbedConfig()));
    await act(async () => bootstrap(`${label}-ticket`));
    await vi.waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.session).toBeNull();
    expect(apiClient.getAccessToken()).toBeNull();
    expect(window.location.pathname).toBe('/embed/chat');
  });

  it('rejects redemption that attempts to switch away from Space 35', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(redemptionResponse('wrong-space-token', 11));
    const { result } = renderHook(() => useEmbedTicketAuth(getTicketEmbedConfig()));
    await act(async () => bootstrap('space-tampering-ticket'));
    await vi.waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.session).toBeNull();
    expect(apiClient.getAccessToken()).toBeNull();
  });
});
