import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { useChatState } from '../useChatState';
import { useEventHandlers } from '../useEventHandlers';

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

it.each(['user', 'agent'] as const)('keeps the %s first-send draft on failure and clears it after retry', async type => {
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, data: { id: 301 } });
  const send = vi.fn().mockRejectedValueOnce(new Error('Send failed')).mockResolvedValue(undefined);
  const { result } = renderHook(() => {
    const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
    const chat = useChatState({ currentConversationId });
    const { state, actions } = chat;
    const events = useEventHandlers({
      inputValue: state.inputValue, setInputValue: actions.setInputValue,
      bindDraftToConversation: chat.bindDraftToConversation,
      attachments: [], setAttachments: actions.setAttachments,
      mentionedUsers: [], setMentionedUsers: actions.setMentionedUsers,
      messageBoundRows: [], setMessageBoundRows: actions.setMessageBoundRows, boundRows: [],
      setLocalError: actions.setLocalError, setDragOver: actions.setDragOver,
      chatPartner: state.chatPartner,
      currentAgent: { id: 7, name: 'Agent', description: '', model: '', system_prompt: '', provider: 'codex', is_active: true },
      agentMode: 'ask', thinkingEnabled: false,
      userConversationId: state.userConversationId, setUserConversationId: actions.setUserConversationId,
      currentConversationId, setCurrentConversationId,
      currentSpaceId: 11, effectiveSpaceId: 11, availableMentionUsers: [], availableSlashAgents: [],
      sendMessage: vi.fn(), selectAgent: vi.fn(), aiSendMessage: send,
      sendUserMessageMutation: { mutateAsync: send },
      setChatMode: actions.setChatMode, setChatPartner: actions.setChatPartner,
      setChatParticipants: actions.setChatParticipants, setBoundRows: actions.setBoundRows,
      setShowBoundRowsBar: actions.setShowBoundRowsBar, setActivePanel: vi.fn(),
      setVectorSearchResults: actions.setVectorSearchResults,
    });
    return { ...chat, events, currentConversationId };
  }, { wrapper: LanguageProvider });
  act(() => result.current.actions.setChatPartner({ type, id: 7, name: 'Partner' }));
  act(() => result.current.actions.setInputValue('Do not lose this'));
  await act(() => result.current.events.handleSubmit());
  expect(type === 'agent' ? result.current.currentConversationId : result.current.state.userConversationId).toBe(301);
  expect(result.current.state.inputValue).toBe('Do not lose this');
  expect(result.current.state.localError).toBe('Send failed');
  await act(() => result.current.events.handleSubmit());
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(2);
  expect(result.current.state.inputValue).toBe('');
});
