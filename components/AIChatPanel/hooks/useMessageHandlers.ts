/**
 * useMessageHandlers Hook
 * ADR-097 Phase 3: Extracted message action handlers from AIChatPanel.tsx
 *
 * Handles:
 * - Copy message to clipboard
 * - Forward message (placeholder with clipboard copy)
 * - Soft-delete message
 * - Reaction toggle (add/remove)
 * - Batch reaction fetching for visible messages
 * - Sender click → insert @mention or /command in input
 * - Checkbox click in markdown → append to input
 */

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { ChatMessage, ChatPartner, MessageReaction } from '../types';
import type { CheckboxClickInfo } from '@/shared/components/MarkdownPreview';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseMessageHandlersParams {
  /** Setter for the message reactions cache */
  setMessageReactions: Dispatch<SetStateAction<Record<number, Record<string, MessageReaction[]>>>>;
  /** Current message reactions cache (for batch skip logic) */
  messageReactions: Record<number, Record<string, MessageReaction[]>>;
  /** Setter for the text input value */
  setInputValue: Dispatch<SetStateAction<string>>;
  /** Current chat partner (used for sender click handler) */
  chatPartner: ChatPartner | null;
  /** Refetch user conversation messages (after delete) */
  refetchUserMessages: () => void;
}

export interface UseMessageHandlersResult {
  /** Copy a message's text content to the clipboard */
  handleCopyMessage: (message: ChatMessage) => void;
  /** Forward a message (currently copies with "Forwarded:" prefix) */
  handleForwardMessage: (message: ChatMessage) => void;
  /** Soft-delete a message by ID */
  handleDeleteMessage: (messageId: number) => Promise<void>;
  /** Toggle a reaction emoji on a message */
  handleReaction: (messageId: number, emoji: string) => Promise<void>;
  /** Batch-fetch reactions for a list of message IDs (skips already-cached) */
  fetchReactionsForMessages: (messageIds: number[]) => Promise<void>;
  /** Click on a message sender avatar → insert @mention or /command into input */
  handleSenderClick: (message: ChatMessage) => void;
  /** Click on a markdown checkbox → append info to input */
  handleCheckboxClick: (info: CheckboxClickInfo) => void;
}

// ─── The Hook ─────────────────────────────────────────────────────────────────

export function useMessageHandlers(params: UseMessageHandlersParams): UseMessageHandlersResult {
  const {
    setMessageReactions,
    messageReactions,
    setInputValue,
    chatPartner,
    refetchUserMessages,
  } = params;

  // ── Copy Message ──────────────────────────────────────────────────────────

  const handleCopyMessage = useCallback((message: ChatMessage) => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
    }
  }, []);

  // ── Forward Message (placeholder) ─────────────────────────────────────────

  const handleForwardMessage = useCallback((message: ChatMessage) => {
    // TODO: Open modal to select conversation/user to forward to
    logger.debug('Forward message:', message.id);
    if (message.content) {
      navigator.clipboard.writeText(`Переслано:\n${message.content}`);
    }
  }, []);

  // ── Delete Message ────────────────────────────────────────────────────────

  const handleDeleteMessage = useCallback(
    async (messageId: number) => {
      try {
        const response = await apiClient.delete<{ success: boolean }>(`/chat/messages/${messageId}`);
        if (response.success) {
          refetchUserMessages();
        }
      } catch (error) {
        logger.error('Failed to delete message:', error);
      }
    },
    [refetchUserMessages],
  );

  // ── Reaction Toggle ───────────────────────────────────────────────────────

  const handleReaction = useCallback(
    async (messageId: number, emoji: string) => {
      try {
        const response = await apiClient.post<{
          success: boolean;
          data: { added?: boolean; removed?: boolean; emoji: string };
        }>(`/chat/messages/${messageId}/reactions`, { emoji });

        if (response.success) {
          const currentUserIdRaw = useAuthStore.getState().user?.id;
          const userName = useAuthStore.getState().user?.name || 'Вы';
          const currentUserId = currentUserIdRaw ? Number(currentUserIdRaw) : null;

          setMessageReactions(prev => {
            const msgReactions = { ...(prev[messageId] || {}) };

            if (response.data.added) {
              if (!msgReactions[emoji]) msgReactions[emoji] = [];
              if (
                currentUserId !== null &&
                !msgReactions[emoji].some(u => u.user_id === currentUserId)
              ) {
                msgReactions[emoji] = [
                  ...msgReactions[emoji],
                  { user_id: currentUserId, user_name: userName },
                ];
              }
            } else if (response.data.removed) {
              if (msgReactions[emoji] && currentUserId !== null) {
                msgReactions[emoji] = msgReactions[emoji].filter(
                  u => u.user_id !== currentUserId,
                );
                if (msgReactions[emoji].length === 0) delete msgReactions[emoji];
              }
            }

            return { ...prev, [messageId]: msgReactions };
          });
        }
      } catch (error) {
        logger.error('Failed to toggle reaction:', error);
      }
    },
    [setMessageReactions],
  );

  // ── Batch Fetch Reactions ─────────────────────────────────────────────────

  const fetchReactionsForMessages = useCallback(
    async (messageIds: number[]) => {
      if (messageIds.length === 0) return;

      const idsToFetch = messageIds.filter(id => !(id in messageReactions));
      if (idsToFetch.length === 0) return;

      try {
        const response = await apiClient.post<{
          success: boolean;
          data: Record<number, Record<string, { user_id: number; user_name: string }[]>>;
        }>('/chat/messages/reactions/batch', { messageIds: idsToFetch });

        if (response.success && response.data) {
          setMessageReactions(prev => ({ ...prev, ...response.data }));
        }
      } catch {
        // Silently ignore batch fetch errors
      }
    },
    [messageReactions, setMessageReactions],
  );

  // ── Sender Click → Insert @mention or /command ────────────────────────────

  const handleSenderClick = useCallback(
    (message: ChatMessage) => {
      const metadata = message.metadata;
      const isAgentMessage = message.role === 'assistant' || !!metadata?.agent_name;

      if (isAgentMessage) {
        // For AI agents, use /command format
        const agentName = metadata?.agent_name || chatPartner?.name || 'assistant';
        const slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        setInputValue(prev => {
          const trimmed = prev.trimEnd();
          return trimmed ? `${trimmed} /${slug} ` : `/${slug} `;
        });
      } else {
        // For users, use @mention format
        const senderName = chatPartner?.name || 'user';
        const slug = senderName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        setInputValue(prev => {
          const trimmed = prev.trimEnd();
          return trimmed ? `${trimmed} @${slug} ` : `@${slug} `;
        });
      }
    },
    [chatPartner?.name, setInputValue],
  );

  // ── Checkbox Click in Markdown ────────────────────────────────────────────

  const handleCheckboxClick = useCallback(
    (info: CheckboxClickInfo) => {
      const prefix = info.heading ? `[${info.heading}] ` : '';
      const status = info.checked ? '[x]' : '[ ]';
      const userTag = info.user ? ` — ${info.user.name} (${info.user.id})` : '';
      const text = `${prefix}${status} ${info.lineText}${userTag}`;
      setInputValue(prev => (prev ? `${prev}\n${text}` : text));
    },
    [setInputValue],
  );

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    handleCopyMessage,
    handleForwardMessage,
    handleDeleteMessage,
    handleReaction,
    fetchReactionsForMessages,
    handleSenderClick,
    handleCheckboxClick,
  };
}
