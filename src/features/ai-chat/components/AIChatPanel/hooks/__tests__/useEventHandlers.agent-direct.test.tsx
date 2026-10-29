import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { useEventHandlers } from '../useEventHandlers';

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function params(): Parameters<typeof useEventHandlers>[0] {
  return {
    inputValue: 'Продолжай', attachments: [], mentionedUsers: [], messageBoundRows: [], boundRows: [],
    chatPartner: { type: 'agent', id: 110507, name: 'Agent Smith' },
    currentAgent: { id: 110507, name: 'Agent Smith', description: '', model: '', system_prompt: '', provider: 'codex', is_active: true },
    userConversationId: null, currentConversationId: null, effectiveSpaceId: 11, currentSpaceId: 11,
    agentMode: 'agent', thinkingEnabled: false, availableSlashAgents: [], availableMentionUsers: [],
    setInputValue: vi.fn(), setAttachments: vi.fn(), setMentionedUsers: vi.fn(), setMessageBoundRows: vi.fn(),
    setLocalError: vi.fn(), setDragOver: vi.fn(), setUserConversationId: vi.fn(), setCurrentConversationId: vi.fn(),
    sendUserMessageMutation: { mutateAsync: vi.fn() }, aiSendMessage: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(), selectAgent: vi.fn(), setChatMode: vi.fn(), setChatPartner: vi.fn(),
    setChatParticipants: vi.fn(), setBoundRows: vi.fn(), setShowBoundRowsBar: vi.fn(), setActivePanel: vi.fn(),
    setVectorSearchResults: vi.fn(),
  };
}

it('includes the selected agent when creating a chat before the first unmentioned message', async () => {
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { id: 44 } });
  const p = params();
  const { result } = renderHook(() => useEventHandlers(p), { wrapper: LanguageProvider });
  await act(() => result.current.handleSubmit());
  expect(apiClient.post).toHaveBeenCalledWith('/chat/conversations', expect.objectContaining({ sub_agents: [110507], space_id: 11 }));
  expect(p.aiSendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Продолжай', overrideConversationId: 44 }));
});

it('keeps an existing conversation when sending to its agent', async () => {
  const p = { ...params(), currentConversationId: 44 };
  const { result } = renderHook(() => useEventHandlers(p), { wrapper: LanguageProvider });
  await act(() => result.current.handleSubmit());
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(p.aiSendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Продолжай' }));
});

it('preserves the draft and does not send if chat creation fails', async () => {
  vi.mocked(apiClient.post).mockRejectedValue(new Error('Creation failed'));
  const p = params();
  const { result } = renderHook(() => useEventHandlers(p), { wrapper: LanguageProvider });
  await act(() => result.current.handleSubmit());
  expect(p.aiSendMessage).not.toHaveBeenCalled();
  expect(p.setInputValue).not.toHaveBeenCalled();
  expect(p.setLocalError).toHaveBeenLastCalledWith('Creation failed');
});
