// deleteConversation reports whether the backend confirmed the delete.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { useConversationActions } from '../useConversationActions';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() } }));

const noop = vi.fn();
function setup() {
  return renderHook(() => useConversationActions({
    historyAgentFilter: null, labId: null, agents: [], currentAgent: null,
    setCurrentAgent: noop, setMessages: noop, setError: noop, setIsLoading: noop,
    setIsAgentProcessing: noop, setProcessingAgentName: noop, setProcessingStartedAt: noop,
    currentConversationIdRef: { current: null },
  }));
}

beforeEach(() => vi.clearAllMocks());

it('resolves true after the backend accepted the delete', async () => {
  vi.mocked(apiClient.delete).mockResolvedValue({ success: true });
  const { result } = setup();
  let deleted!: boolean;
  await act(async () => { deleted = await result.current.deleteConversation(201); });
  expect(apiClient.delete).toHaveBeenCalledExactlyOnceWith('/chat/conversations/201');
  expect(deleted).toBe(true);
});

it('resolves false and does not throw when the backend rejects the delete', async () => {
  vi.mocked(apiClient.delete).mockRejectedValue(new Error('404'));
  const { result } = setup();
  let deleted!: boolean;
  await act(async () => { deleted = await result.current.deleteConversation(201); });
  expect(deleted).toBe(false);
});
