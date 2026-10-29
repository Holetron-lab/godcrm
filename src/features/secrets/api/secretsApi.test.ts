import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { secretsApi } from './secretsApi';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: {
  get: vi.fn().mockResolvedValue({ data: { secrets: [] } }),
  post: vi.fn().mockResolvedValue({ data: { secret: {}, plaintext: 'test' } }),
  put: vi.fn().mockResolvedValue({ data: { secret: {} } }),
  delete: vi.fn().mockResolvedValue({ data: {} }),
} }));

describe('scoped secret operations', () => {
  it('includes the selected space on every request', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { secrets: [], table_id: 4242 } });
    expect(await secretsApi.list(773)).toEqual({ secrets: [], table_id: 4242 });
    expect(apiClient.get).toHaveBeenCalledWith('/secrets?space_id=773');
    const body = { key: 'test_key', plaintext: 'test', description: '' };
    await secretsApi.create(773, body);
    expect(apiClient.post).toHaveBeenCalledWith('/secrets?space_id=773', body);
    await secretsApi.update(773, 'test_key', { description: 'note' });
    expect(apiClient.put).toHaveBeenCalledWith('/secrets/test_key?space_id=773', { description: 'note' });
    await secretsApi.reveal(773, 'test_key');
    expect(apiClient.post).toHaveBeenCalledWith('/secrets/test_key/reveal?space_id=773');
    await secretsApi.remove(773, 'test_key');
    expect(apiClient.delete).toHaveBeenCalledWith('/secrets/test_key?space_id=773');
  });
});
