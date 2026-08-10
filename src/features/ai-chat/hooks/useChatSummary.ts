/**
 * useChatSummary Hook — ADR-0031 §Z / WP-24
 *
 * TanStack Query hook for fetching a compact chat summary used by
 * <ChatLinkCard> (the unified replacement for MovedStubBubble + MovedFromBanner).
 *
 * Backend contract:
 *   GET /api/v3/chat/conversations/:id/summary
 *
 * Response shape (success):
 *   {
 *     id: number,
 *     title: string,
 *     type: 'group' | 'direct' | 'task' | 'inbox' | 'ticket' | 'row',
 *     participants: Array<{ id, name, avatar }>, // <= 3
 *     participants_total: number,
 *     message_count: number,
 *     agent: { id, name, icon } | null,
 *     bound_row: { table_id, row_id, title } | null,
 *     icon: string | null,
 *     deleted: boolean,
 *   }
 *
 * Soft-deleted: 200 with `{ id, title, deleted: true }` only.
 * Errors: 404 (not found), 403 (no access).
 *
 * Cache: query key `['chat-summary', id]` dedups concurrent calls; `staleTime: 30s`.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

export interface ChatSummaryParticipant {
  id: number;
  name: string;
  avatar: string | null;
}

export interface ChatSummaryAgent {
  id: number;
  name: string;
  icon: string;
}

export interface ChatSummaryBoundRow {
  table_id: number;
  row_id: number;
  title: string | null;
  table_name?: string | null;
}

export type ChatSummaryType =
  | 'group'
  | 'direct'
  | 'task'
  | 'inbox'
  | 'ticket'
  | 'row';

export interface ChatSummary {
  id: number;
  title: string;
  type: ChatSummaryType;
  created_at?: string | null;
  participants: ChatSummaryParticipant[];
  participants_total: number;
  message_count?: number;
  unread_count?: number;
  agent: ChatSummaryAgent | null;
  bound_row: ChatSummaryBoundRow | null;
  icon: string | null;
  deleted: boolean;
}

interface ApiResponse<T> {
  success?: boolean;
  data?: T;
}

export type ChatSummaryError =
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'unknown'; message?: string };

/**
 * Fetch a compact summary for a single conversation.
 *
 * Returns `{ data, isLoading, error }` — `error` is shaped as
 * `ChatSummaryError` so the consumer can render the right gray plate
 * (deleted vs forbidden vs generic).
 */
export function useChatSummary(conversationId: number | null | undefined) {
  return useQuery<ChatSummary, ChatSummaryError>({
    queryKey: ['chat-summary', conversationId],
    queryFn: async () => {
      try {
        const response = await apiClient.get<ApiResponse<ChatSummary> | ChatSummary>(
          `/chat/conversations/${conversationId}/summary`,
        );
        // Support both shapes: { data: ChatSummary } and bare ChatSummary.
        const payload =
          response && typeof response === 'object' && 'data' in response && response.data
            ? (response.data as ChatSummary)
            : (response as ChatSummary);

        if (!payload || typeof payload !== 'object') {
          throw { kind: 'unknown', message: 'Empty summary response' } as ChatSummaryError;
        }
        return payload;
      } catch (err) {
        // apiClient throws Error with the response text. Check status hints
        // so consumers can render proper gray plates.
        const msg = err instanceof Error ? err.message : String(err);
        if (/\b403\b/.test(msg) || /forbidden/i.test(msg)) {
          throw { kind: 'forbidden' } as ChatSummaryError;
        }
        if (/\b404\b/.test(msg) || /not\s*found/i.test(msg)) {
          throw { kind: 'not_found' } as ChatSummaryError;
        }
        throw { kind: 'unknown', message: msg } as ChatSummaryError;
      }
    },
    enabled: typeof conversationId === 'number' && conversationId > 0,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      // Don't retry on permission/missing — they won't fix themselves.
      if (error && (error.kind === 'forbidden' || error.kind === 'not_found')) return false;
      return failureCount < 2;
    },
  });
}

export default useChatSummary;
