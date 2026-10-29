import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { useAIChatPanelLogic } from '../useAIChatPanelLogic';
import { InboxPanelContent } from '../usePanelContent/InboxPanelContent';
import type { PanelContentDeps } from '../usePanelContent/PanelContentTypes';
import { useAuthStore } from '@/features/auth/store/authStore';

const context = vi.hoisted(() => ({
  currentConversationId: 201 as number | null,
  conversations: [{ id: 201, title: 'Chat A' }, { id: 202, title: 'Chat B' }],
  agents: [], mentionAgents: [], messages: [], selectConversation: vi.fn(), openChat: vi.fn(),
}));
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => context }));
// Keep real panel selection, draft state and title computation; isolate unrelated I/O.
vi.mock('../useDataQueries', () => ({ useDataQueries: () => ({ inboxConversations: [{ id: 203, title: 'Inbox C' }] }) }));
vi.mock('../useChatAgentSettings', () => ({ useChatAgentSettings: () => ({}) }));
vi.mock('../useChatMutations', () => ({ useChatMutations: () => ({}) }));
vi.mock('../useDataSourceConfig', () => ({ useDataSourceConfig: () => ({}) }));
vi.mock('../useSyncEffects', () => ({ useSyncEffects: vi.fn() }));
vi.mock('../useScrollManagement', () => ({ useScrollManagement: () => ({}) }));
vi.mock('../useResizeHandlers', () => ({ useResizeHandlers: () => ({}) }));
vi.mock('../useEventHandlers', () => ({ useEventHandlers: () => ({}) }));
vi.mock('../usePanelContentWiring', () => ({ usePanelContentWiring: () => ({}) }));
vi.mock('../useScheduledMessages', () => ({ useScheduledMessages: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useVoiceNote', () => ({ useVoiceNote: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useConversationMessages', () => ({ useConversationMessages: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useConversationSSE', () => ({ useConversationSSE: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useInflightAgents', () => ({
  FEATURE_MULTI_AGENT_PRESENCE_V2: false, useInflightAgents: () => ({ agents: [] }),
}));

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  });
  localStorage.clear();
  localStorage.setItem('god-crm-chat-input-mode', 'per-chat');
  context.currentConversationId = 201;
  context.selectConversation.mockReset();
  context.openChat.mockReset();
  window.history.replaceState({}, '', '/');
});
afterEach(() => vi.unstubAllGlobals());

it.each(['user', 'group', 'agent'] as const)('keeps %s identity and drafts aligned after a deep link and Inbox selection', async type => {
  window.history.replaceState({}, '', '/?chat=201');
  context.selectConversation.mockResolvedValue({ title: 'Chat A' });
  const { result } = renderHook(() => useAIChatPanelLogic(), { wrapper: ProvidersWrapper });
  await act(async () => {});
  act(() => result.current.setInputValue('Private A'));
  act(() => {
    result.current.setChatPartner({ type, id: 7, name: 'Same partner' });
    if (type === 'agent') context.currentConversationId = 202;
    else result.current.setUserConversationId(202);
  });
  expect(result.current.resolvedConvTitle).toBe('Chat B');
  expect(result.current.currentConversationId ?? result.current.userConversationId).toBe(202);
  expect(result.current.userConversationId ?? result.current.currentConversationId).toBe(202);
  expect(result.current.inputValue).toBe('');
  act(() => result.current.setInputValue('Private B'));
  act(() => {
    result.current.setChatPartner({ type: 'group', id: 201, name: 'Chat A' });
    result.current.setUserConversationId(201);
  });
  expect(result.current.resolvedConvTitle).toBe('Chat A');
  expect(result.current.inputValue).toBe('Private A');
});

it('does not expose the previous agent chat to a new human draft', () => {
  const { result } = renderHook(() => useAIChatPanelLogic(), { wrapper: ProvidersWrapper });
  act(() => result.current.setChatPartner({ type: 'user', id: 7, name: 'New person' }));
  expect(result.current.currentConversationId ?? result.current.userConversationId).toBeNull();
  expect(result.current.resolvedConvTitle).toBeNull();
});

it.each(['direct', 'group', 'agent', 'agent-participant', 'same-title'] as const)('selects the actual Inbox destination: %s', async variant => {
  useAuthStore.setState({ user: { id: '1', name: 'Owner' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']> });
  window.history.replaceState({}, '', '/?chat=201');
  context.selectConversation.mockImplementation(async (id: number) => {
    context.currentConversationId = id;
    return { title: id === 201 ? 'Chat A' : 'Chat B' };
  });
  const { result } = renderHook(() => useAIChatPanelLogic(), { wrapper: ProvidersWrapper });
  await act(async () => {});
  const participants = variant === 'agent' ? [] : [{ user_id: 2, name: 'Partner', user_type: 'human' }];
  if (variant === 'group') participants.push({ user_id: 3, name: 'Other partner', user_type: 'human' });
  const destination = {
    id: 202, title: variant === 'same-title' ? 'Chat A' : 'Chat B', participants,
    agent_id: variant.startsWith('agent') ? 7 : null, unread_count: 0,
  };
  const inbox = render(<InboxPanelContent {...{
    ...result.current, safeAgents: [{ id: 7, name: 'Agent' }],
    inboxTypeFilter: 'all', inboxConversations: [destination], selectAgent: vi.fn(),
    markAsReadMutation: { mutate: vi.fn() },
  } as unknown as PanelContentDeps} />, { wrapper: ProvidersWrapper });
  await act(async () => fireEvent.click(inbox.getAllByRole('button', { name: destination.title })[0]));
  expect(result.current.currentConversationId ?? result.current.userConversationId).toBe(202);
  expect(result.current.userConversationId ?? result.current.currentConversationId).toBe(202);
  expect(result.current.chatPartner?.type).toBe(variant === 'agent' ? 'agent' : variant === 'group' ? 'group' : 'user');
});

it('opens a linked conversation once without replaying a message', async () => {
  window.history.replaceState({}, '', '/?chat=3497');
  context.selectConversation.mockResolvedValue({title:'Одна темка интересная'});
  const {result,rerender} = renderHook(() => useAIChatPanelLogic(), {wrapper:ProvidersWrapper});
  await act(async () => {});
  rerender();
  expect(context.selectConversation).toHaveBeenCalledTimes(1);
  expect(context.selectConversation).toHaveBeenCalledWith(3497);
  expect(context.openChat).toHaveBeenCalledTimes(1);
  expect(result.current.chatPartner).toEqual({type:'group',id:3497,name:'Одна темка интересная'});
  expect(result.current.chatMode).toBe('people');
  expect(result.current.activePanel).toBe('none');
});

it.each(['bad','-1','1.5','9007199254740992'])('ignores invalid conversation link %s', value => {
  window.history.replaceState({}, '', `/?chat=${value}`);
  renderHook(() => useAIChatPanelLogic(), {wrapper:ProvidersWrapper});
  expect(context.selectConversation).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject', 'reselect'] as const)('keeps title and draft aligned when selection will %s', async outcome => {
  const { result } = renderHook(() => useAIChatPanelLogic(), { wrapper: ProvidersWrapper });
  act(() => result.current.setChatPartner({ type: 'agent', id: 7, name: 'Agent' }));
  act(() => result.current.setInputValue('Private A'));
  let finish!: () => void;
  context.selectConversation.mockImplementation((id: number) => new Promise<void>((resolve, reject) => {
    finish = () => {
      if (outcome === 'reject') reject(new Error('Selection failed'));
      else { context.currentConversationId = id; resolve(); }
    };
  }));
  const targetId = outcome === 'reselect' ? 201 : 202;
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.selectConversation(targetId).catch(error => error); });
  expect(result.current.resolvedConvTitle).toBe(outcome === 'reselect' ? 'Chat A' : 'Chat B');
  expect(result.current.inputValue).toBe(outcome === 'reselect' ? 'Private A' : '');
  await act(async () => { finish(); await pending; });
  expect(result.current.resolvedConvTitle).toBe(outcome === 'resolve' ? 'Chat B' : 'Chat A');
  expect(result.current.inputValue).toBe(outcome === 'resolve' ? '' : 'Private A');
});

it('uses the pending inbox title and never falls back to the previous conversation for an unknown target', async () => {
  const { result } = renderHook(() => useAIChatPanelLogic(), { wrapper: ProvidersWrapper });
  act(() => result.current.setChatPartner({ type: 'agent', id: 7, name: 'Agent' }));
  for (const [id, title] of [[203, 'Inbox C'], [204, null]] as const) {
    let finish!: () => void;
    context.selectConversation.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.selectConversation(id); });
    expect(result.current.resolvedConvTitle).toBe(title);
    await act(async () => { finish(); await pending; });
    expect(result.current.resolvedConvTitle).toBe('Chat A');
  }
});

it('opens a forwarded source only after the server grants access', async () => {
  const { result } = renderHook(() => useAIChatPanelLogic(), { wrapper: ProvidersWrapper });
  act(() => result.current.setChatPartner({ type: 'group', id: 201, name: 'Chat A' }));
  let grant!: (conversation: { title: string }) => void;
  context.selectConversation.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
  act(() => window.dispatchEvent(new CustomEvent('navigate-to-chat-message', { detail: { chatId: '202' } })));
  expect(result.current.chatPartner?.id).toBe(201);
  await act(async () => { grant({ title: 'Source chat' }); });
  expect(result.current.chatPartner).toEqual({ type: 'group', id: 202, name: 'Source chat' });
  expect(result.current.userConversationId).toBe(202);
  expect(result.current.chatMode).toBe('people');
  expect(result.current.activePanel).toBe('none');
});

it('preserves the current chat when access to a forwarded source is denied', async () => {
  context.selectConversation.mockResolvedValue(undefined);
  const { result } = renderHook(() => useAIChatPanelLogic(), { wrapper: ProvidersWrapper });
  act(() => result.current.setChatPartner({ type: 'group', id: 201, name: 'Chat A' }));
  await act(async () => window.dispatchEvent(new CustomEvent('navigate-to-chat-message', { detail: { chatId: '202' } })));
  expect(result.current.chatPartner?.id).toBe(201);
  expect(result.current.userConversationId).not.toBe(202);
});

it('shows a forwarded-source load error without switching chats', async () => {
  context.selectConversation.mockRejectedValue(new Error('Access denied'));
  const { result } = renderHook(() => useAIChatPanelLogic(), { wrapper: ProvidersWrapper });
  act(() => result.current.setChatPartner({ type: 'group', id: 201, name: 'Chat A' }));
  await act(async () => window.dispatchEvent(new CustomEvent('navigate-to-chat-message', { detail: { chatId: '202' } })));
  expect(result.current.chatPartner?.id).toBe(201);
  expect(result.current.localError).toBe('Access denied');
});
