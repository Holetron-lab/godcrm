import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { useConversationMessages } from '../useConversationMessages';
import { apiClient } from '@/shared/utils/apiClient';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
it('refreshes metadata on a new persisted message, but not streaming updates to the same message', async () => {
  let participants = [{ user_id: 1, name: 'Owner' }];
  vi.mocked(apiClient.get).mockImplementation(async (url) => ({ data: url.includes('/messages')
    ? { messages: [{ id: '1', content: 'Initial' }], hasMore: false }
    : { id: 10, participants } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => useConversationMessages(10), { wrapper });
  await waitFor(() => expect(result.current.conversation?.participants).toHaveLength(1));
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  participants = [...participants, { user_id: 2, name: 'Architect' }];
  act(() => client.setQueryData(['conversation-messages', 10], { pages: [{ messages: [{ id: '2', content: 'Working' }], hasMore: false }], pageParams: [null] }));
  await waitFor(() => expect(result.current.conversation?.participants).toHaveLength(2));
  const calls = vi.mocked(apiClient.get).mock.calls.length;
  act(() => client.setQueryData(['conversation-messages', 10], { pages: [{ messages: [{ id: '2', content: 'Working more' }], hasMore: false }], pageParams: [null] }));
  await waitFor(() => expect(result.current.messages[0].content).toBe('Working more'));
  expect(apiClient.get).toHaveBeenCalledTimes(calls);
  unmount(); client.clear();
});
