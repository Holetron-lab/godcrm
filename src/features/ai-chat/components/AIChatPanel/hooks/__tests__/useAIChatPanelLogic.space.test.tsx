import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { useAIChatPanelLogic } from '../useAIChatPanelLogic';

const context = vi.hoisted(() => ({
  currentConversationId: 201 as number | null,
  setCurrentConversationId: vi.fn((id: number) => { context.currentConversationId = id; }),
  loadConversations: vi.fn(), isOpen: true,
  currentAgent: { id: 7, name: 'Agent' },
  conversations: [{ id: 201, title: 'Chat A' }, { id: 202, title: 'Chat B' }],
  agents: [], mentionAgents: [], messages: [], selectConversation: vi.fn(), openChat: vi.fn(),
}));
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => context }));
// Keep real panel selection, draft state and title computation; isolate unrelated I/O.
vi.mock('../useDataQueries', () => ({ useDataQueries: () => ({ inboxConversations: [{ id: 203, title: 'Inbox C' }] }) }));
vi.mock('../useChatAgentSettings', () => ({ useChatAgentSettings: () => ({}) }));
const send = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 1 }));
vi.mock('../useChatMutations', () => ({ useChatMutations: () => ({ sendUserMessageMutation: { mutateAsync: send } }) }));
vi.mock('../useDataSourceConfig', () => ({ useDataSourceConfig: () => ({}) }));
vi.mock('../useSyncEffects', () => ({ useSyncEffects: vi.fn() }));
vi.mock('../useScrollManagement', () => ({ useScrollManagement: () => ({}) }));
vi.mock('../useResizeHandlers', () => ({ useResizeHandlers: () => ({}) }));
vi.mock('../usePanelContentWiring', () => ({ usePanelContentWiring: () => ({}) }));
vi.mock('../useScheduledMessages', () => ({ useScheduledMessages: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useVoiceNote', () => ({ useVoiceNote: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useConversationMessages', () => ({ useConversationMessages: () => ({ sendMessage: send }) }));
vi.mock('@/features/ai-chat/hooks/useConversationSSE', () => ({ useConversationSSE: () => ({}) }));
vi.mock('@/features/ai-chat/hooks/useInflightAgents', () => ({
  FEATURE_MULTI_AGENT_PRESENCE_V2: false, useInflightAgents: () => ({ agents: [] }),
}));


import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: '1' } }) }));
const file = new File(['file'], 'draft.txt', { type: 'text/plain' });
let space: number | null;
const uploaded = { id: 'file1', name: file.name, originalName: file.name, mimeType: file.type, size: file.size, url: '/uploads/file1' };
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  space = null;
  context.currentConversationId = 201;
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.mocked(apiClient.get).mockImplementation(async () => ({ data: { id: 201, created_by: 1, space_id: space, type: 'chat' } }));
  vi.mocked(apiClient.patch).mockImplementation(async () => { space = 11; return { success: true }; });
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { id: 201 } });
  vi.mocked(filesApi.upload).mockResolvedValue(uploaded);
});
function setup(type: 'agent' | 'user' | 'group' = 'group', fillContainer = false) {
  const hook = renderHook(() => useAIChatPanelLogic({ fillContainer }), { wrapper: ProvidersWrapper });
  act(() => {
    hook.result.current.setChatPartner({ type, id: 7, name: 'Same title' });
    if (type !== 'agent') hook.result.current.setUserConversationId(201);
  });
  act(() => hook.result.current.setInputValue('Retain this text'));
  return hook;
}
it.each(['picker', 'drop', 'paste'] as const)('opens on %s without uploading or sending; cancellation preserves draft', async path => {
  const { result } = setup();
  act(() => {
    if (path === 'picker') result.current.events.handleFileSelect({ target: { files: [file], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>);
    if (path === 'drop') result.current.events.handleDrop({ preventDefault: vi.fn(), dataTransfer: { files: [file] } } as unknown as React.DragEvent);
    if (path === 'paste') result.current.setAttachments(previous => [...previous, file]);
  });
  await waitFor(() => expect(result.current.conversationSpace.dialogOpen).toBe(true));
  act(() => result.current.conversationSpace.cancel());
  expect(result.current.attachments).toEqual([file]);
  expect(result.current.inputValue).toBe('Retain this text');
  expect(filesApi.upload).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it.each(['agent', 'user', 'group'] as const)('resumes %s send once after successful binding (main/embed shared hook)', async type => {
  const { result } = setup(type, type === 'agent');
  act(() => result.current.setAttachments([file]));
  await waitFor(() => expect(result.current.conversationSpace.dialogOpen).toBe(true));
  let sending!: Promise<void>;
  act(() => { sending = result.current.events.handleSubmit(); void result.current.events.handleSubmit(); });
  await act(() => result.current.conversationSpace.save(11));
  await act(() => sending);
  expect(filesApi.upload).toHaveBeenCalledExactlyOnceWith([file], { spaceId: 11 });
  expect(send).toHaveBeenCalledOnce();
  expect(result.current.attachments).toEqual([]);
});
it('preserves a draft after cancel then sends on explicit retry', async () => {
  const { result } = setup();
  act(() => result.current.setAttachments([file]));
  await waitFor(() => expect(result.current.conversationSpace.dialogOpen).toBe(true));
  let sending!: Promise<void>;
  act(() => { sending = result.current.events.handleSubmit(); });
  await act(async () => {});
  act(() => result.current.conversationSpace.cancel());
  await act(() => sending);
  expect(result.current.attachments).toEqual([file]);
  expect(send).not.toHaveBeenCalled();
  act(() => { sending = result.current.events.handleSubmit(); });
  await waitFor(() => expect(result.current.conversationSpace.dialogOpen).toBe(true));
  await act(() => result.current.conversationSpace.save(11));
  await act(() => sending);
  expect(send).toHaveBeenCalledOnce();
});
it('never sends a completed upload into a newly selected chat', async () => {
  space = 11;
  let finish!: () => void;
  vi.mocked(filesApi.upload).mockImplementation(() => new Promise(resolve => { finish = () => resolve(uploaded); }));
  const { result } = setup();
  act(() => result.current.setAttachments([file]));
  let sending!: Promise<void>;
  act(() => { sending = result.current.events.handleSubmit(); });
  await waitFor(() => expect(filesApi.upload).toHaveBeenCalledOnce());
  act(() => result.current.setUserConversationId(202));
  await act(async () => { finish(); await sending; });
  expect(send).not.toHaveBeenCalled();
});
it.each(['agent', 'user'] as const)('creates a single %s conversation and keeps its ID after cancelled first upload', async type => {
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { id: 301 } });
  const { result, rerender } = setup(type);
  act(() => {
    if (type === 'agent') context.currentConversationId = null;
    else result.current.setUserConversationId(null);
  });
  rerender(); // The mocked agent context does not notify React on its own.
  // The file picker belongs to the newly rendered conversation, not the old one.
  act(() => result.current.setAttachments([file]));
  await waitFor(() => expect(result.current.conversationSpace.dialogOpen).toBe(true));
  act(() => result.current.conversationSpace.cancel());
  await act(async () => {});
  let sending!: Promise<void>;
  act(() => { sending = result.current.events.handleSubmit(); });
  await waitFor(() => expect(result.current.conversationSpace.dialogOpen).toBe(true));
  await act(() => result.current.conversationSpace.save(11));
  await act(() => sending);
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations', expect.objectContaining({ type: 'chat' }));
  expect(send).toHaveBeenCalledOnce();
});
it('keys retries by File and persisted Space, without reusing an A upload after binding B', async () => {
  space = 11;
  send.mockRejectedValueOnce(new Error('send failed'));
  const { result } = setup();
  act(() => result.current.setAttachments([file]));
  await act(() => result.current.events.handleSubmit());
  expect(result.current.attachments).toEqual([file]);
  space = 12;
  await act(() => result.current.events.handleSubmit());
  expect(filesApi.upload).toHaveBeenNthCalledWith(1, [file], { spaceId: 11 });
  expect(filesApi.upload).toHaveBeenNthCalledWith(2, [file], { spaceId: 12 });
});
