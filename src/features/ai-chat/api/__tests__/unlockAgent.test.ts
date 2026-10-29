import { describe, expect, it, vi } from 'vitest';
import { unlockAgent } from '../unlockAgent';

const post = vi.fn();
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: (...args: unknown[]) => post(...args) } }));

describe('unlockAgent', () => {
  it('posts to the space-scoped unlock route', async () => {
    post.mockReset().mockResolvedValueOnce({ success: true });
    await unlockAgent(11, 31114);
    expect(post).toHaveBeenCalledWith('/ai/agents/11/31114/unlock');
  });

  it('rejects when the server reports failure', async () => {
    post.mockReset().mockResolvedValueOnce({ success: false });
    await expect(unlockAgent(11, 31114)).rejects.toThrow('Unable to unlock agent');
  });
});
