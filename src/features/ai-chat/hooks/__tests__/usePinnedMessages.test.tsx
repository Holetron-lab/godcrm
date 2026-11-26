import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProvidersWrapper, createTestQueryClient } from '@/tests/renderWithProviders';
import { apiClient } from '@/shared/utils/apiClient';
import type { ChatMessage } from '../../types';
import { usePinnedMessages } from '../usePinnedMessages';
import { usePinMessage } from '../usePinMessage';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));

const message = (id: number, pinned_at: string | null): ChatMessage =>
  ({ id: String(id), role: 'user', content: `message ${id}`, timestamp: new Date('2026-01-01T10:00:00.000Z'), pinned_at });

const setup = (loaded: ChatMessage[]) => {
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <ProvidersWrapper queryClient={client}>{children}</ProvidersWrapper>;
  return renderHook(
    ({ messages }) => ({ pinned: usePinnedMessages(7, messages), mutation: usePinMessage(7) }),
    { wrapper, initialProps: { messages: loaded } },
  );
};

describe('usePinnedMessages', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.delete).mockReset();
  });

  it('lists a pinned message that is older than the loaded history pages', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { messages: [message(3, '2026-09-01T10:00:00.000Z')] } });

    const { result } = setup([message(90, null), message(91, '2026-09-02T10:00:00.000Z')]);

    await waitFor(() => expect(result.current.pinned.map(m => Number(m.id)).sort()).toEqual([3, 91]));
    expect(apiClient.get).toHaveBeenCalledWith('/chat/conversations/7/pinned-messages');
  });

  it('shows a loaded pin once, from the loaded copy', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { messages: [{ ...message(91, '2026-09-02T10:00:00.000Z'), content: 'server copy' }] } });

    const { result } = setup([message(91, '2026-09-02T10:00:00.000Z')]);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    await waitFor(() => expect(result.current.pinned).toHaveLength(1));
    expect(result.current.pinned[0].content).toBe('message 91');
  });

  it('drops an unloaded pin from the list as soon as it is unpinned', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { messages: [message(3, '2026-09-01T10:00:00.000Z')] } });
    let finishUnpin: (value: unknown) => void = () => {};
    vi.mocked(apiClient.delete).mockReturnValue(new Promise(resolve => { finishUnpin = resolve; }));

    const { result } = setup([message(90, null)]);
    await waitFor(() => expect(result.current.pinned).toHaveLength(1));

    let unpinning: Promise<void> = Promise.resolve();
    act(() => { unpinning = result.current.mutation.unpin(3); });
    await waitFor(() => expect(result.current.pinned).toHaveLength(0));

    vi.mocked(apiClient.get).mockResolvedValue({ data: { messages: [] } });
    await act(async () => { finishUnpin({ success: true, data: { id: 3, pinned_at: null } }); await unpinning; });
    expect(result.current.pinned).toHaveLength(0);
  });

  it('restores the unloaded pin when the unpin request fails', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { messages: [message(3, '2026-09-01T10:00:00.000Z')] } });
    vi.mocked(apiClient.delete).mockRejectedValue(new Error('500'));

    const { result } = setup([message(90, null)]);
    await waitFor(() => expect(result.current.pinned).toHaveLength(1));

    await act(async () => { await result.current.mutation.unpin(3).catch(() => {}); });
    await waitFor(() => expect(result.current.pinned.map(m => Number(m.id))).toEqual([3]));
  });
});
