/**
 * ADR-097: Message interaction handlers
 * Extracted from AIChatPanel.tsx (lines 1015-1213)
 *
 * Provides reaction toggle, copy, checkbox, forward, delete, sender click,
 * and batch reaction fetching.
 */

import { useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { showToast } from '@/shared/hooks/useToast';
import {
  toggleCheckboxByIndex,
  normalizeCheckboxes,
  denormalizeCheckboxes,
  getCheckboxContext,
} from '@/shared/utils/markdownCheckbox';
import type { CheckboxClickInfo } from '@/shared/components/MarkdownPreview';
import type { ChatMessage } from '../types';

/** Shape of reactions map: messageId -> emoji -> array of {user_id, user_name} */
export type MessageReactionsMap = Record<number, Record<string, { user_id: number; user_name: string }[]>>;

export interface UseMessageInteractionsParams {
  messageReactions: MessageReactionsMap;
  setMessageReactions: (fn: (prev: MessageReactionsMap) => MessageReactionsMap) => void;
  setInputValue: (fn: (prev: string) => string) => void;
  chatPartner: { type: string; name: string; [key: string]: unknown } | null;
  userConversationId: number | null;
  currentConversationId: number | null;
  sendUserMessageMutateAsync: (params: {
    conversationId: number;
    content: string;
  }) => Promise<unknown>;
  refetchUserMessages: () => void;
}

export interface UseMessageInteractionsReturn {
  handleReaction: (messageId: number, emoji: string) => Promise<void>;
  handleCopyMessage: (message: ChatMessage) => void;
  handleCheckboxToggleInMessage: (
    messageId: number | string,
    originalContent: string,
    checkboxIndex: number
  ) => Promise<void>;
  handleCheckboxClick: (info: CheckboxClickInfo) => void;
  handleForwardMessage: (message: ChatMessage) => void;
  handleDeleteMessage: (messageId: number) => Promise<void>;
  handleSenderClick: (message: ChatMessage) => void;
  fetchReactionsForMessages: (messageIds: number[]) => Promise<void>;
}

export function useMessageInteractions({
  messageReactions,
  setMessageReactions,
  setInputValue,
  chatPartner,
  userConversationId,
  currentConversationId,
  sendUserMessageMutateAsync,
  refetchUserMessages,
}: UseMessageInteractionsParams): UseMessageInteractionsReturn {
  // Handle reaction toggle on message
  const handleReaction = async (messageId: number, emoji: string) => {
    try {
      const response = await apiClient.post<{ success: boolean; data: { added?: boolean; removed?: boolean; emoji: string } }>(
        `/chat/messages/${messageId}/reactions`,
        { emoji }
      );

      if (response.success) {
        const currentUserIdRaw = useAuthStore.getState().user?.id;
        const userName = useAuthStore.getState().user?.name || 'Вы';
        // Ensure currentUserId is a number for comparison
        const currentUserId = currentUserIdRaw ? Number(currentUserIdRaw) : null;

        setMessageReactions(prev => {
          const msgReactions = { ...(prev[messageId] || {}) };

          if (response.data.added) {
            // Add reaction
            if (!msgReactions[emoji]) msgReactions[emoji] = [];
            if (currentUserId !== null && !msgReactions[emoji].some(u => u.user_id === currentUserId)) {
              msgReactions[emoji] = [...msgReactions[emoji], { user_id: currentUserId, user_name: userName }];
            }
          } else if (response.data.removed) {
            // Remove reaction
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
  };

  // Handle copy message to clipboard
  const handleCopyMessage = useCallback((message: ChatMessage) => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
      // Could show a toast notification here
    }
  }, []);

  // Handle checkbox toggle in markdown message:
  // 1. Update the message content in DB (PATCH)
  // 2. Send a system message notifying about the change
  const handleCheckboxToggleInMessage = useCallback(async (
    messageId: number | string,
    originalContent: string,
    checkboxIndex: number
  ) => {
    const normalized = normalizeCheckboxes(originalContent);
    const toggled = toggleCheckboxByIndex(normalized, checkboxIndex);
    const newContent = denormalizeCheckboxes(toggled, originalContent);
    const context = getCheckboxContext(normalized, checkboxIndex);

    // Determine new state (after toggle)
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

    // 1. Update message content in DB
    try {
      await apiClient.patch(`/chat/messages/${messageId}/content`, { content: newContent });
    } catch (e) {
      logger.error('Failed to update message content for checkbox toggle:', e);
      return;
    }

    // 2. Refetch messages to show the updated content
    refetchUserMessages();

    // 3. Send system message about the checkbox change
    const prefix = context.heading ? `[${context.heading}] ` : '';
    const status = isNowChecked ? '✅' : '⬜';
    const currentUser = useAuthStore.getState().user;
    const userName = currentUser?.name || 'User';
    const systemText = `${status} ${prefix}${isNowChecked ? 'Checked' : 'Unchecked'}: "${context.lineText}" — ${userName}`;

    // Use the active conversation to send the system message
    const convId = userConversationId || currentConversationId;
    if (convId) {
      try {
        await sendUserMessageMutateAsync({
          conversationId: convId,
          content: systemText,
        });
      } catch (e) {
        logger.error('Failed to send checkbox system message:', e);
      }
    }
  }, [userConversationId, currentConversationId, sendUserMessageMutateAsync, refetchUserMessages]);

  // Legacy: handle checkbox click info (append to input)
  const handleCheckboxClick = useCallback((info: CheckboxClickInfo) => {
    const prefix = info.heading ? `[${info.heading}] ` : '';
    const status = info.checked ? '[x]' : '[ ]';
    const userTag = info.user ? ` — ${info.user.name} (${info.user.id})` : '';
    const text = `${prefix}${status} ${info.lineText}${userTag}`;
    setInputValue((prev: string) => prev ? `${prev}\n${text}` : text);
  }, [setInputValue]);

  // Handle forward message -- copy content to clipboard with attribution and notify user
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
      // Clipboard API may fail in non-secure contexts
      showToast('Пересылка сообщений скоро будет доступна', 'info');
    });

    logger.debug('Forward message copied to clipboard:', message.id);
  }, []);

  // Handle soft delete message
  const handleDeleteMessage = useCallback(async (messageId: number) => {
    try {
      const response = await apiClient.delete<{ success: boolean }>(`/chat/messages/${messageId}`);
      if (response.success) {
        // Refetch conversation to get updated messages
        refetchUserMessages();
      }
    } catch (error) {
      logger.error('Failed to delete message:', error);
    }
  }, [refetchUserMessages]);

  // ADR-069: Handle click on message sender avatar - add @mention or /command to input
  const handleSenderClick = useCallback((message: ChatMessage) => {
    // Get sender info from message metadata or role
    const metadata = message.metadata;
    const isAgentMessage = message.role === 'assistant' || metadata?.agent_name;

    if (isAgentMessage) {
      // For AI agents, use /command format
      const agentName = metadata?.agent_name || chatPartner?.name || 'assistant';
      const slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      setInputValue((prev: string) => {
        const trimmed = prev.trimEnd();
        return trimmed ? `${trimmed} /${slug} ` : `/${slug} `;
      });
    } else {
      // For users, use @mention format
      // Try to get sender name from participants or users
      const senderName = chatPartner?.name || 'user';
      const slug = senderName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      setInputValue((prev: string) => {
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
