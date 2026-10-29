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

describe('apiClient HTTP errors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiClient.setAccessToken(null);
  });

  it.each([
    [409, { success: false, error: { code: 'CONFLICT', message: "Slug 'taken' is already used by another agent in this table" }, timestamp: '2026-09-30' }, "Slug 'taken' is already used by another agent in this table"],
    [403, { error: { code: 'FORBIDDEN', message: 'Permission denied' } }, 'Permission denied'],
    [422, { error: 'Invalid name' }, 'Invalid name'],
    [400, { message: 'Invalid request' }, 'Invalid request'],
    [400, { error: { message: 123 }, message: 'Invalid request' }, 'Invalid request'],
    [500, { error: { code: 'INTERNAL', message: '' }, debug: 'private detail' }, 'Request failed (500)'],
    [500, null, 'Request failed (500)'],
    [500, ['private detail'], 'Request failed (500)'],
  ])('extracts a readable message for HTTP %s: %j', async (status, body, message) => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    }));
    await expect(apiClient.put('/ai/agents/12/configuration', { data: { slug: 'taken' } })).rejects.toThrow(new Error(message));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['text/html', '<html>Internal proxy detail</html>', 'Request failed (502)'],
    ['text/plain', 'Service unavailable', 'Service unavailable'],
    ['application/json', '{invalid json', '{invalid json'],
    ['text/plain', '', 'Request failed'],
  ])('preserves the fallback for %s: %s', async (contentType, body, message) => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(body, {
      status: 502, headers: { 'content-type': contentType },
    }));
    await expect(apiClient.get('/unavailable')).rejects.toThrow(new Error(message));
  });
});
