/**
 * useTicketChatStats - Hook for fetching batch conversation stats per table
 * Task #6 (ADR-077): Agent status indicators on Kanban cards
 *
 * Fetches message counts and last agent info for all rows in a table,
 * used to display agent avatars and message counts on kanban cards.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';

export interface TicketChatStat {
  row_id: string;
  total_messages: number;
  conversation_count: number;
  last_message_at: string | null;
  last_agent_name: string | null;
  last_agent_avatar: string | null;
  last_agent_user_id: number | null;
}

export type TicketChatStatsMap = Map<string, TicketChatStat>;

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { message: string };
}

interface UseTicketChatStatsOptions {
  tableId: number | null;
  enabled?: boolean;
}

export function useTicketChatStats({ tableId, enabled = true }: UseTicketChatStatsOptions) {
  const { data: statsMap, isLoading } = useQuery<TicketChatStatsMap>({
    queryKey: ['ticket-chat-stats', tableId],
    queryFn: async () => {
      if (!tableId) return new Map();

      logger.debug('[useTicketChatStats] Fetching stats for table', tableId);

      const response = await apiClient.get<ApiResponse<TicketChatStat[]>>(
        `/chat/tasks/${tableId}/stats`
      );

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch chat stats');
      }

      const map = new Map<string, TicketChatStat>();
      const stats = response.data || [];
      for (const stat of stats) {
        map.set(String(stat.row_id), stat);
      }

      logger.debug('[useTicketChatStats] Loaded stats for', map.size, 'rows');
      return map;
    },
    enabled: enabled && !!tableId && tableId > 0,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  return {
    chatStats: statsMap || new Map<string, TicketChatStat>(),
    isLoadingChatStats: isLoading,
  };
}
