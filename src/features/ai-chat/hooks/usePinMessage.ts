/**
 * ADR-0068 WP-E — Pinned-message mutation hook.
 *
 * Wraps POST/DELETE /api/v3/chat/messages/:id/pin with TanStack Query's
 * optimistic-mutate / onError-rollback pattern. The same conversation cache
 * key (`['conversation-messages', conversationId]`) used by
 * useConversationMessages is patched in place so the message bubble row AND
 * the PinnedBanner both flip immediately. The server response is idempotent;
 * 409 `pin_cap_reached` (>50/conv) rolls back without changing the cap UX.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import type { ChatMessage } from '../types';

type CachePage = { messages: ChatMessage[]; hasMore: boolean; nextCursor?: number | null };
type CacheShape = { pages: CachePage[]; pageParams: Array<number | null> };

interface PinResponseData { id: number; pinned_at: string | null; }
interface PinResponse { success: boolean; data?: PinResponseData; error?: string; cap?: number; message?: string }

function patchPinnedAt(old: CacheShape | undefined, messageId: number | string, value: string | null): CacheShape | undefined {
  if (!old?.pages?.length) return old;
  const target = String(messageId);
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      messages: page.messages.map((m) => (String(m.id) === target ? { ...m, pinned_at: value } : m)),
    })),
  };
}

export interface UsePinMessageResult {
  pin: (messageId: number | string) => Promise<void>;
  unpin: (messageId: number | string) => Promise<void>;
  isPending: boolean;
  capReached: boolean;
  clearCapNotice: () => void;
}

export function usePinMessage(conversationId: number | string | null | undefined): UsePinMessageResult {
  const queryClient = useQueryClient();
  const queryKey = ['conversation-messages', conversationId] as const;

  // Shared optimistic helper — `nextValue` is what the cache row should look
  // like during the optimistic window. Returned context carries the snapshot
  // for rollback.
  const mutate = useMutation({
    mutationFn: async ({ messageId, mode }: { messageId: number | string; mode: 'pin' | 'unpin' }) => {
      const path = `/chat/messages/${encodeURIComponent(String(messageId))}/pin`;
      if (mode === 'pin') {
        return apiClient.post<PinResponse>(path, {});
      }
      return apiClient.delete<PinResponse>(path);
    },
    onMutate: async ({ messageId, mode }) => {
      if (!conversationId) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CacheShape>(queryKey);
      const optimisticValue = mode === 'pin' ? new Date().toISOString() : null;
      queryClient.setQueryData<CacheShape>(queryKey, (old) => patchPinnedAt(old, messageId, optimisticValue));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      // apiClient throws `new Error(rawBody)`; match 409/403 by body substring
      // (JSON.parse on partial bodies is unsafe — substring is enough here).
      const body = typeof err?.message === 'string' ? err.message : '';
      if (body.includes('pin_cap_reached')) {
        showToast('Достигнут лимит закреплённых (50). Открепите что-то и попробуйте снова.', 'error');
      } else if (body.includes('403') || body.toLowerCase().includes('forbidden') || body.toLowerCase().includes('only the chat owner')) {
        showToast('Закреплять сообщения в этом чате может только владелец.', 'error');
      } else {
        showToast('Не удалось обновить закрепление.', 'error');
      }
    },
    onSuccess: (resp, { messageId }) => {
      // Server returns authoritative pinned_at. Sync the cache to that exact
      // value so idempotent re-pin / re-unpin (which doesn't change DB) still
      // converges with the server's view.
      const serverValue = resp?.data?.pinned_at ?? null;
      queryClient.setQueryData<CacheShape>(queryKey, (old) => patchPinnedAt(old, messageId, serverValue));
    },
  });

  // Cap-reached UX: apiClient throws `new Error(errorText)` where errorText is
  // the raw body. The 409 body contains `"error":"pin_cap_reached"` — match by
  // substring; safer than JSON.parse against partial bodies.
  const capReached = mutate.isError && typeof mutate.error?.message === 'string'
    && mutate.error.message.includes('pin_cap_reached');

  return {
    pin: async (messageId) => { await mutate.mutateAsync({ messageId, mode: 'pin' }); },
    unpin: async (messageId) => { await mutate.mutateAsync({ messageId, mode: 'unpin' }); },
    isPending: mutate.isPending,
    capReached,
    clearCapNotice: () => mutate.reset(),
  };
}
