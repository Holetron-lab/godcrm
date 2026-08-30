/**
 * ADR-185 — Chat message translation mutation hook.
 *
 * Wraps POST /api/v3/chat/messages/:id/translate { target_lang, force? }.
 * The endpoint resolves the chat-panel translator agent, writes
 * `content_<target_lang>` + `translation_meta[target_lang]` on the message row,
 * and returns the updated message. This is the "one user translates, everyone
 * on that language reuses it" mechanic (ADR-185 §3/§4): the translation is
 * persisted on the message itself, so patching the shared conversation cache
 * key (`['conversation-messages', conversationId]`, same as
 * useConversationMessages / usePinMessage) makes it visible to this client
 * immediately; other clients pick it up on their next refetch / socket update.
 *
 * Idempotent server-side: an existing `content_<target_lang>` is returned
 * without re-calling the agent unless `force` is passed.
 *
 * NOTE (contract, ADR-185 §3): expects `{ success, data }` where `data` is the
 * updated message carrying at least `content_<target_lang>`, and optionally
 * `detected_lang` + `translation_meta`. If the backend response shape diverges
 * from this, the divergence is flagged to the orchestrator rather than forked.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { contentLanguageLabel } from '@/shared/i18n/contentLanguages';
import type { ChatMessage } from '../types';

type CachePage = { messages: ChatMessage[]; hasMore: boolean; nextCursor?: number | null };
type CacheShape = { pages: CachePage[]; pageParams: Array<number | null> };

// The endpoint returns the updated row; we only read the dynamic
// `content_<lang>` column plus `detected_lang` / `translation_meta`, all of
// which live on ChatMessage — so a partial message is the exact shape. (The
// extra scalar fields the route adds — target_lang, cached — are ignored here.)
type TranslateResponseData = Partial<ChatMessage>;
interface TranslateResponse {
  success: boolean;
  data?: TranslateResponseData;
  error?: string;
}

/** Merge the translation fields from the server response onto the cached row. */
function patchTranslation(
  old: CacheShape | undefined,
  messageId: number | string,
  targetLang: string,
  data: TranslateResponseData,
): CacheShape | undefined {
  if (!old?.pages?.length) return old;
  const target = String(messageId);
  const langKey = `content_${targetLang}` as keyof ChatMessage;
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      messages: page.messages.map((m) => {
        if (String(m.id) !== target) return m;
        return {
          ...m,
          // Prefer the language-keyed column; the endpoint returns the full row.
          [langKey]: (data[langKey] as string | undefined) ?? m[langKey],
          detected_lang: data.detected_lang ?? m.detected_lang,
          translation_meta: data.translation_meta ?? m.translation_meta,
        };
      }),
    })),
  };
}

export interface UseTranslateMessageResult {
  /** Translate a message into `targetLang`. Resolves once the cache is patched. */
  translate: (messageId: number | string, targetLang: string, force?: boolean) => Promise<void>;
  /** ID of the message currently being translated (for per-turn spinner), or null. */
  translatingId: string | null;
  isPending: boolean;
}

export function useTranslateMessage(
  conversationId: number | string | null | undefined,
): UseTranslateMessageResult {
  const queryClient = useQueryClient();
  const queryKey = ['conversation-messages', conversationId] as const;

  const mutate = useMutation({
    mutationFn: async ({
      messageId,
      targetLang,
      force,
    }: {
      messageId: number | string;
      targetLang: string;
      force?: boolean;
    }) => {
      const path = `/chat/messages/${encodeURIComponent(String(messageId))}/translate`;
      return apiClient.post<TranslateResponse>(path, { target_lang: targetLang, force: !!force });
    },
    onSuccess: (resp, { messageId, targetLang }) => {
      const data = resp?.data;
      if (!data) {
        showToast('Перевод не вернул данные.', 'error');
        return;
      }
      queryClient.setQueryData<CacheShape>(queryKey, (old) =>
        patchTranslation(old, messageId, targetLang, data),
      );
      showToast(`Переведено на ${contentLanguageLabel(targetLang)}.`, 'success');
    },
    onError: () => {
      showToast('Не удалось перевести сообщение.', 'error');
    },
  });

  return {
    translate: async (messageId, targetLang, force) => {
      await mutate.mutateAsync({ messageId, targetLang, force });
    },
    translatingId:
      mutate.isPending && mutate.variables ? String(mutate.variables.messageId) : null,
    isPending: mutate.isPending,
  };
}
