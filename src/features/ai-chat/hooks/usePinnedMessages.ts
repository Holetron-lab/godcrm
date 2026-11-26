/**
 * ADR-0068 WP-E — pinned messages of a conversation, independent of history paging.
 *
 * History loads 50 messages at a time, so a pin older than the loaded pages is
 * not in the message cache. The server list fills that gap; a message that is
 * loaded is taken from the message cache instead, because that copy carries the
 * optimistic pin state written by usePinMessage.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { ChatMessage } from '../types';

type ConversationId = number | string | null | undefined;

export const pinnedMessagesQueryKey = (conversationId: ConversationId) =>
  ['conversation-pinned-messages', conversationId] as const;

export function usePinnedMessages(conversationId: ConversationId, loadedMessages: ChatMessage[]): ChatMessage[] {
  const { data: serverPinned } = useQuery({
    queryKey: pinnedMessagesQueryKey(conversationId),
    queryFn: async () => {
      const response = await apiClient.get<{ data?: { messages?: ChatMessage[] } }>(
        `/chat/conversations/${conversationId}/pinned-messages`,
      );
      return response?.data?.messages ?? [];
    },
    enabled: !!conversationId,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const loadedPinned = loadedMessages.filter(m => m.pinned_at && !m.is_deleted);
    const loadedIds = new Set(loadedPinned.map(m => String(m.id)));
    return [...loadedPinned, ...(serverPinned ?? []).filter(m => !loadedIds.has(String(m.id)))];
  }, [loadedMessages, serverPinned]);
}
