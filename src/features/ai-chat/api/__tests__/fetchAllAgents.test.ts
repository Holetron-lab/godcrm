import { describe, expect, it, vi } from 'vitest';
import { fetchAllAgents } from '../fetchAllAgents';

const get = vi.fn();
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: (...args: unknown[]) => get(...args) } }));

describe('fetchAllAgents', () => {
  it('walks every page until the server total is reached', async () => {
    const page = (ids: number[], total: number) => ({ success: true, data: { agents: ids.map(id => ({ id })), total } });
    get.mockReset()
      .mockResolvedValueOnce(page([1, 2], 3))
      .mockResolvedValueOnce(page([3], 3));
    const agents = await fetchAllAgents<{ id: number }>('/ai/agents/11');
    expect(agents.map(a => a.id)).toEqual([1, 2, 3]);
    expect(get.mock.calls.map(call => call[0])).toEqual(['/ai/agents/11?limit=200&offset=0', '/ai/agents/11?limit=200&offset=200']);
  });

  it('stops on an empty page even when the total is stale', async () => {
    get.mockReset()
      .mockResolvedValueOnce({ success: true, data: { agents: [{ id: 1 }], total: 5 } })
      .mockResolvedValueOnce({ success: true, data: { agents: [], total: 5 } });
    await expect(fetchAllAgents('/ai/agents')).resolves.toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rejects when the server reports failure', async () => {
    get.mockReset().mockResolvedValueOnce({ success: false });
    await expect(fetchAllAgents('/ai/agents')).rejects.toThrow('Unable to load agents');
  });
});
