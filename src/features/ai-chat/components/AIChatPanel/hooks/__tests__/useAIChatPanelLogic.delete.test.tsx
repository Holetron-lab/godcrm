// Deleting the open direct/group chat must switch the panel away from it —
// otherwise it keeps polling the deleted conversation and shows "Connection lost".
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { useAIChatPanelLogic } from '../useAIChatPanelLogic';

const context = vi.hoisted(() => ({
  currentConversationId: null as number | null,
  setCurrentConversationId: vi.fn(), loadConversations: vi.fn(), isOpen: true,
  currentAgent: null, conversations: [], agents: [], mentionAgents: [], messages: [],
  selectConversation: vi.fn(), openChat: vi.fn(),
  deleteConversation: vi.fn(async () => true),
}));
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => context }));
vi.mock('../useDataQueries', () => ({ useDataQueries: () => ({ inboxConversations: [] }) }));
vi.mock('../useChatAgentSettings', () => ({ useChatAgentSettings: () => ({}) }));
vi.mock('../useChatMutations', () => ({ useChatMutations: () => ({}) }));
vi.mock('../useDataSourceConfig', () => ({ useDataSourceConfig: () => ({}) }));
vi.mock('../useSyncEffects', () => ({ useSyncEffects: vi.fn() }));
vi.mock('../useScrollManagement', () => ({ useScrollManagement: () => ({}) }));
vi.mock('../useResizeHandlers', () => ({ useResizeHandlers: () => ({}) }));
vi.mock('../usePanelContentWiring', () => ({ usePanelContentWiring: () => ({}) }));
vi.mock('../useScheduledMessages', () => ({ useScheduledMessages: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useVoiceNote', () => ({ useVoiceNote: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useConversationMessages', () => ({ useConversationMessages: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useConversationSSE', () => ({ useConversationSSE: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useInflightAgents', () => ({
  FEATURE_MULTI_AGENT_PRESENCE_V2: false, useInflightAgents: () => ({ agents: [] }),
}));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(async () => ({ data: null })), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: '1' } }) }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  context.deleteConversation.mockResolvedValue(true);
  localStorage.clear();
});

function setup(type: 'user' | 'group', partnerId: number) {
  const hook = renderHook(() => useAIChatPanelLogic(), { wrapper: ProvidersWrapper });
  act(() => {
    hook.result.current.setChatPartner({ type, id: partnerId, name: 'Marketer' });
    hook.result.current.setUserConversationId(201);
  });
  return hook;
}

it('deleting the open direct chat closes it but keeps the partner for a fresh chat', async () => {
  const { result } = setup('user', 7);
  await act(() => result.current.deleteConversation(201));
  expect(context.deleteConversation).toHaveBeenCalledExactlyOnceWith(201);
  expect(result.current.userConversationId).toBeNull();
  expect(result.current.chatPartner).toMatchObject({ type: 'user', id: 7 });
});

it('deleting the open group chat also drops the group partner (its id is the chat)', async () => {
  const { result } = setup('group', 201);
  await act(() => result.current.deleteConversation(201));
  expect(result.current.userConversationId).toBeNull();
  expect(result.current.chatPartner).toBeNull();
  expect(result.current.chatParticipants).toEqual([]);
});

it('deleting another chat leaves the open one untouched', async () => {
  const { result } = setup('user', 7);
  await act(() => result.current.deleteConversation(202));
  expect(result.current.userConversationId).toBe(201);
});

it('keeps the open chat when the backend delete fails', async () => {
  context.deleteConversation.mockResolvedValue(false);
  const { result } = setup('user', 7);
  await act(() => result.current.deleteConversation(201));
  expect(result.current.userConversationId).toBe(201);
});
