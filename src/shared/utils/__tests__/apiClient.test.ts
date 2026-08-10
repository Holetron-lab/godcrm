import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../apiClient';

describe('apiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiClient.setAccessToken(null);
  });

  it('attaches bearer token to requests', async () => {
    apiClient.setAccessToken('token-123');
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer token-123');
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const response = await apiClient.request<{ data: { ok: boolean } }>('/ping');
    expect(response.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes token on 401', async () => {
    let call = 0;
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      call += 1;
      if (call === 1) {
        expect(input).toBe('/api/v3/secure');
        return new Response('', { status: 401 });
      }
      if (call === 2) {
        expect(input).toBe('/api/v3/auth/refresh');
        return new Response(JSON.stringify({ data: { accessToken: 'new-token' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      expect(input).toBe('/api/v3/secure');
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    apiClient.setAccessToken('expired');
    const response = await apiClient.request<{ data: { ok: boolean } }>('/secure');
    expect(response.data.ok).toBe(true);
    expect(apiClient.getAccessToken()).toBe('new-token');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
