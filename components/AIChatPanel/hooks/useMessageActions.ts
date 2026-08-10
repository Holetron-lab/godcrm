/**
 * useMessageActions — Message-level action handlers (copy, forward, delete, checkbox, reactions).
 * Extracted from AIChatPanel.tsx (lines 832-1030).
 */
import { useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { showToast } from '@/shared/hooks/useToast';
import {
  normalizeCheckboxes,
  toggleCheckboxByIndex,
  denormalizeCheckboxes,
  getCheckboxContext,
} from '@/shared/utils/markdownCheckbox';
import type { ChatMessage } from '../../types';
import type { CheckboxClickInfo } from '@/shared/components/MarkdownPreview';

interface UseMessageActionsParams {
  currentUser: { id: string | number; name: string } | null;
  userConversationId: number | null;
  currentConversationId: number | null;
  refetchUserMessages: () => void;
  sendUserMessageMutateAsync: (params: {
    conversationId: number;
    content: string;
  }) => Promise<unknown>;
  setInputValue: (fn: (prev: string) => string) => void;
  setMessageReactions: (fn: (prev: Record<number, Record<string, { user_id: number; user_name: string }[]>>) => Record<number, Record<string, { user_id: number; user_name: string }[]>>) => void;
  messageReactions: Record<number, Record<string, { user_id: number; user_name: string }[]>>;
  chatPartner: { type: string; name: string } | null;
}

export function useMessageActions({
  currentUser,
  userConversationId,
  currentConversationId,
  refetchUserMessages,
  sendUserMessageMutateAsync,
  setInputValue,
  setMessageReactions,
  messageReactions,
  chatPartner,
}: UseMessageActionsParams) {
  // Handle reaction toggle on message
  const handleReaction = useCallback(async (messageId: number, emoji: string) => {
    try {
      const response = await apiClient.post<{ success: boolean; data: { added?: boolean; removed?: boolean; emoji: string } }>(
        `/chat/messages/${messageId}/reactions`,
        { emoji }
      );

      if (response.success) {
        const currentUserIdRaw = useAuthStore.getState().user?.id;
        const userName = useAuthStore.getState().user?.name || 'Вы';
        const currentUserId = currentUserIdRaw ? Number(currentUserIdRaw) : null;

        setMessageReactions(prev => {
          const msgReactions = { ...(prev[messageId] || {}) };
          if (response.data.added) {
            if (!msgReactions[emoji]) msgReactions[emoji] = [];
            if (currentUserId !== null && !msgReactions[emoji].some(u => u.user_id === currentUserId)) {
              msgReactions[emoji] = [...msgReactions[emoji], { user_id: currentUserId, user_name: userName }];
            }
          } else if (response.data.removed) {
            if (msgReactions[emoji] && currentUserId !== null) {
              msgReactions[emoji] = msgReactions[emoji].filter(u => u.user_id !== currentUserId);
              if (msgReactions[emoji].length === 0) delete msgReactions[emoji];
            }
          }
          return { ...prev, [messageId]: msgReactions };
        });
      }
    } catch (error) {
      logger.error('Failed to toggle reaction:', error);
    }
  }, [setMessageReactions]);

  // Handle copy message to clipboard
  const handleCopyMessage = useCallback((message: ChatMessage) => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
    }
  }, []);

  // Handle checkbox toggle in markdown message
  const handleCheckboxToggleInMessage = useCallback(async (
    messageId: number | string,
    originalContent: string,
    checkboxIndex: number
  ) => {
    const normalized = normalizeCheckboxes(originalContent);
    const toggled = toggleCheckboxByIndex(normalized, checkboxIndex);
    const newContent = denormalizeCheckboxes(toggled, originalContent);
    const context = getCheckboxContext(normalized, checkboxIndex);

    const lines = normalized.split('\n');
    let currentIdx = 0;
    let wasChecked = false;
    for (const line of lines) {
      const match = line.match(/^\s*[-*+]\s+\[([ xX])\]/);
      if (match) {
        if (currentIdx === checkboxIndex) {
          wasChecked = match[1] !== ' ';
          break;
        }
        currentIdx++;
      }
    }
    const isNowChecked = !wasChecked;

    try {
      await apiClient.patch(`/chat/messages/${messageId}/content`, { content: newContent });
    } catch (e) {
      logger.error('Failed to update message content for checkbox toggle:', e);
      return;
    }

    refetchUserMessages();

    const prefix = context.heading ? `[${context.heading}] ` : '';
    const status = isNowChecked ? '✅' : '⬜';
    const userName = currentUser?.name || 'User';
    const systemText = `${status} ${prefix}${isNowChecked ? 'Checked' : 'Unchecked'}: "${context.lineText}" — ${userName}`;

    const convId = userConversationId || currentConversationId;
    if (convId) {
      try {
        await sendUserMessageMutateAsync({ conversationId: convId, content: systemText });
      } catch (e) {
        logger.error('Failed to send checkbox system message:', e);
      }
    }
  }, [currentUser?.name, userConversationId, currentConversationId, sendUserMessageMutateAsync, refetchUserMessages]);

  // Legacy: handle checkbox click info (append to input)
  const handleCheckboxClick = useCallback((info: CheckboxClickInfo) => {
    const prefix = info.heading ? `[${info.heading}] ` : '';
    const status = info.checked ? '[x]' : '[ ]';
    const userTag = info.user ? ` — ${info.user.name} (${info.user.id})` : '';
    const text = `${prefix}${status} ${info.lineText}${userTag}`;
    setInputValue(prev => prev ? `${prev}\n${text}` : text);
  }, [setInputValue]);

  // Handle forward message
  const handleForwardMessage = useCallback((message: ChatMessage) => {
    if (!message.content) {
      showToast('Сообщение пустое — нечего пересылать', 'error');
      return;
    }
    const senderLabel = message.sender_name || message.agentName || message.role;
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
    const forwardedText = [
      `--- Переслано от ${senderLabel}${timestamp ? ` (${timestamp})` : ''} ---`,
      message.content,
      '--- конец пересланного сообщения ---',
    ].join('\n');

    navigator.clipboard.writeText(forwardedText).then(() => {
      showToast('Сообщение скопировано в буфер. Вставьте в нужный чат.', 'success');
    }).catch(() => {
      showToast('Пересылка сообщений скоро будет доступна', 'info');
    });
    logger.debug('Forward message copied to clipboard:', message.id);
  }, []);

  // Handle soft delete message
  const handleDeleteMessage = useCallback(async (messageId: number) => {
    try {
      const response = await apiClient.delete<{ success: boolean }>(`/chat/messages/${messageId}`);
      if (response.success) {
        refetchUserMessages();
      }
    } catch (error) {
      logger.error('Failed to delete message:', error);
    }
  }, [refetchUserMessages]);

  // Handle click on message sender avatar
  const handleSenderClick = useCallback((message: ChatMessage) => {
    const metadata = message.metadata;
    const isAgentMessage = message.role === 'assistant' || metadata?.agent_name;

    if (isAgentMessage) {
      const agentName = metadata?.agent_name || chatPartner?.name || 'assistant';
      const slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      setInputValue(prev => {
        const trimmed = prev.trimEnd();
        return trimmed ? `${trimmed} /${slug} ` : `/${slug} `;
      });
    } else {
      const senderName = chatPartner?.name || 'user';
      const slug = senderName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      setInputValue(prev => {
        const trimmed = prev.trimEnd();
        return trimmed ? `${trimmed} @${slug} ` : `@${slug} `;
      });
    }
  }, [chatPartner?.name, setInputValue]);

  // Fetch reactions for visible messages in a single batch request
  const fetchReactionsForMessages = useCallback(async (messageIds: number[]) => {
    if (messageIds.length === 0) return;
    const idsToFetch = messageIds.filter(id => !(id in messageReactions));
    if (idsToFetch.length === 0) return;

    try {
      const response = await apiClient.post<{ success: boolean; data: Record<number, Record<string, { user_id: number; user_name: string }[]>> }>(
        '/chat/messages/reactions/batch',
        { messageIds: idsToFetch }
      );
      if (response.success && response.data) {
        setMessageReactions(prev => ({ ...prev, ...response.data }));
      }
    } catch {
      // Ignore batch fetch errors
    }
  }, [messageReactions, setMessageReactions]);

  return {
    handleReaction,
    handleCopyMessage,
    handleCheckboxToggleInMessage,
    handleCheckboxClick,
    handleForwardMessage,
    handleDeleteMessage,
    handleSenderClick,
    fetchReactionsForMessages,
  };
}
