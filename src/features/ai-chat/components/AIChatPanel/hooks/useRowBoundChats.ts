/**
 * useRowBoundChats — fetch all conversations bound to a given table_id and
 * expose a Map<row_id, { conversationId, msgCount, unread }>.
 *
 * Used by chip-style ticket/document/favourites lists to show "💬 N" per row
 * without N+1 queries. Single GET hits the existing
 * `/chat/conversations?bound_table_id=X` endpoint which already returns
 * `participant_msg_counts` (per-sender counts) and `unread_count`.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

interface ParticipantMsgCount { sender_id: number; count: number }
interface ConversationLite {
  id: number;
  bound_table_id: number | null;
  bound_row_id: number | null;
  unread_count?: number;
  participant_msg_counts?: ParticipantMsgCount[];
}

export interface RowChatInfo {
  conversationId: number;
  msgCount: number;
  unread: number;
}

export function useRowBoundChats(tableId: number | undefined, enabled: boolean = true) {
  const q = useQuery({
    queryKey: ['row-bound-chats', tableId],
    enabled: !!tableId && enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const r = await apiClient.get<{ success: boolean; data: { conversations: ConversationLite[] } }>(
        `/chat/conversations?bound_table_id=${tableId}&limit=200`
      );
      return r?.data?.conversations || [];
    },
  });

  const map = useMemo(() => {
    const m = new Map<number, RowChatInfo>();
    for (const c of q.data || []) {
      if (!c.bound_row_id) continue;
      const sum = (c.participant_msg_counts || []).reduce((s, p) => s + (p.count || 0), 0);
      const prev = m.get(c.bound_row_id);
      if (!prev || c.id < prev.conversationId) {
        m.set(c.bound_row_id, {
          conversationId: c.id,
          msgCount: sum,
          unread: c.unread_count || 0,
        });
      }
    }
    return m;
  }, [q.data]);

  return { map, refetch: q.refetch, isLoading: q.isLoading };
}
