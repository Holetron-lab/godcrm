import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/shared/utils/apiClient';
import { showChatToast } from '@/shared/hooks/useToast';
import { playNotificationSound } from '@/shared/services/notificationSoundService';
import { CHAT_UNREAD_SUMMARY_QUERY_KEY, type UnreadSummary } from '@/shared/hooks/useChatUnreadSummary';
import { ChatNotificationOrchestrator } from '../chatNotificationOrchestrator';

vi.mock('@/features/ai-chat', () => ({ useAIChat: () => ({ isOpen: false, currentConversationId: null }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ showChatToast: vi.fn(), setChatToastClickHandler: vi.fn() }));
vi.mock('@/shared/services/notificationSoundService', () => ({ playNotificationSound: vi.fn() }));

const summary = (count: number): UnreadSummary => ({
  total: count,
  by_conversation: count ? [{ conversation_id: 901, unread_count: count }] : [],
});
let client: QueryClient;
let rejectSummary: (reason: Error) => void;
let resolveSummary: (value: { data: UnreadSummary }) => void;

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
function mount() {
  return render(<QueryClientProvider client={client}><ChatNotificationOrchestrator /></QueryClientProvider>);
}
async function receive(count: number) {
  await act(async () => { resolveSummary({ data: summary(count) }); });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/chat/unread-summary') return new Promise((resolve, reject) => { resolveSummary = resolve; rejectSummary = reject; });
    if (url.startsWith('/chat/notification-prefs/')) return { data: { prefs: {
      enabled: true, sound_enabled: true, sound_volume: 1,
      humans: { sound: true, popup: true, badge: true },
      agents: { sound: true, popup: true, badge: true },
    } } };
    return { data: { messages: [{ id: 101, content: 'Incoming message', senderType: 'human' }] } };
  });
});
afterEach(() => { cleanup(); client.clear(); });

describe('chat notification baseline', () => {
  it('does not replay existing unread messages on a cold mount or navigation remount', async () => {
    const first = mount();
    await receive(3);
    expect(showChatToast).not.toHaveBeenCalled();
    expect(playNotificationSound).not.toHaveBeenCalled();
    first.unmount();
    client.clear();
    mount();
    await receive(3);
    expect(showChatToast).not.toHaveBeenCalled();
    expect(playNotificationSound).not.toHaveBeenCalled();
  });

  it('does not replay existing messages after an initial request failure', async () => {
    mount();
    await act(async () => { rejectSummary(new Error('Offline')); });
    await settle();
    expect(client.getQueryState(CHAT_UNREAD_SUMMARY_QUERY_KEY)?.status).toBe('error');
    act(() => { void client.refetchQueries({ queryKey: CHAT_UNREAD_SUMMARY_QUERY_KEY }); });
    await receive(3);
    expect(showChatToast).not.toHaveBeenCalled();
    expect(playNotificationSound).not.toHaveBeenCalled();
  });

  it('keeps the baseline while the query is reset during navigation', async () => {
    mount();
    await receive(3);
    vi.mocked(showChatToast).mockClear();
    vi.mocked(playNotificationSound).mockClear();
    act(() => { void client.resetQueries({ queryKey: CHAT_UNREAD_SUMMARY_QUERY_KEY }); });
    await settle();
    await receive(3);
    expect(showChatToast).not.toHaveBeenCalled();
    expect(playNotificationSound).not.toHaveBeenCalled();
  });

  it('does not replay a cached snapshot when the shell remounts', async () => {
    const first = mount();
    await receive(3);
    vi.mocked(showChatToast).mockClear();
    first.unmount();
    mount();
    await settle();
    expect(showChatToast).not.toHaveBeenCalled();
  });

  it.each([0, 3])('notifies once for new messages after a loaded baseline of %i', async (count) => {
    mount();
    await receive(count);
    vi.mocked(showChatToast).mockClear();
    vi.mocked(playNotificationSound).mockClear();
    act(() => { client.setQueryData(CHAT_UNREAD_SUMMARY_QUERY_KEY, summary(count + 1)); });
    await settle();
    expect(showChatToast).toHaveBeenCalledTimes(1);
    expect(playNotificationSound).toHaveBeenCalledTimes(1);
    act(() => { client.setQueryData(CHAT_UNREAD_SUMMARY_QUERY_KEY, summary(count + 1)); });
    await settle();
    expect(showChatToast).toHaveBeenCalledTimes(1);
  });
});
