/**
 * useMovedMessagesPreview Hook — ADR-0031 §Z / WP-24
 *
 * On-demand fetch of a small batch of messages from a conversation by id,
 * powering the inline-expand preview inside <ChatLinkCard> (forward
 * direction). The source-side stub stores the target message ids in
 * `metadata.moved_to.message_ids`; clicking the chevron expands the card
 * and fans them in here.
 *
 * Backend contract:
 *   GET /api/v3/chat/conversations/:id/messages/by-ids?ids=1,2,3
 *
 * The query is `enabled` only when `enabled === true`, so the network
 * request fires lazily when the user actually expands the card.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

export interface MovedMessagePreview {
  id: number;
  sender_id: number | null;
  sender_type: string | null;
  role: string | null;
  content: string | null;
  content_type: string | null;
  attachments: unknown[];
  metadata: Record<string, unknown>;
  created_at: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
  sender_user_type: string | null;
}

interface ApiResponse<T> {
  success?: boolean;
  data?: T;
}

interface ByIdsPayload {
  messages: MovedMessagePreview[];
}

export function useMovedMessagesPreview(
  conversationId: number | null | undefined,
  ids: number[] | undefined,
  enabled: boolean,
) {
  const sortedKey = (ids ? [...ids].filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b) : []);
  return useQuery<MovedMessagePreview[], Error>({
    queryKey: ['moved-messages-preview', conversationId, sortedKey],
    queryFn: async () => {
      const idsCsv = sortedKey.join(',');
      const response = await apiClient.get<ApiResponse<ByIdsPayload> | ByIdsPayload>(
        `/chat/conversations/${conversationId}/messages/by-ids?ids=${idsCsv}`,
      );
      const payload =
        response && typeof response === 'object' && 'data' in response && response.data
          ? (response.data as ByIdsPayload)
          : (response as ByIdsPayload);
      return Array.isArray(payload?.messages) ? payload.messages : [];
    },
    enabled:
      enabled === true
      && typeof conversationId === 'number' && conversationId > 0
      && sortedKey.length > 0,
    staleTime: 60_000,
  });
}

export default useMovedMessagesPreview;
