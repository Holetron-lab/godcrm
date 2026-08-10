// useChatUnreadSummary — ADR-0064 WP-B.
//
// Fetches GET /chat/unread-summary on mount and polls every 30s. Returns
// the aggregated `total` plus the per-conversation breakdown. Live updates
// are delivered by the notification orchestrator (WP-B) which invalidates
// the `chat-unread-summary` query key on every observed new message and
// mark-read action.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

export const CHAT_UNREAD_SUMMARY_QUERY_KEY = ['chat-unread-summary'] as const;

interface UnreadSummaryRow {
  conversation_id: number;
  unread_count: number;
}

export interface UnreadSummary {
  total: number;
  by_conversation: UnreadSummaryRow[];
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

interface Options {
  enabled?: boolean;
  refetchInterval?: number;
}

export function useChatUnreadSummary(options: Options = {}) {
  const { enabled = true, refetchInterval = 30_000 } = options;

  const query = useQuery({
    queryKey: CHAT_UNREAD_SUMMARY_QUERY_KEY,
    queryFn: async (): Promise<UnreadSummary> => {
      const res = await apiClient.get<ApiEnvelope<UnreadSummary>>('/chat/unread-summary');
      return res?.data ?? { total: 0, by_conversation: [] };
    },
    enabled,
    refetchInterval,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  return {
    total: query.data?.total ?? 0,
    byConversation: query.data?.by_conversation ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
