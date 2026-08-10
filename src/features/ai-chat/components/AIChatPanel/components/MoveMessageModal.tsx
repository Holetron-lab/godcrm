/**
 * MoveMessageModal — pick a target conversation to MOVE a message to.
 * ADR-0031 WP-24 FE: counterpart of ForwardMessageModal but for moves.
 *
 * Behaviour:
 *  - Shown only to chat owners (gate handled in caller).
 *  - On submit POSTs /chat/conversations/:id/messages/move with
 *    { target_conversation_id, message_ids: [message.id] }.
 *  - On 200 toasts "Перенесено в <название>" and invalidates both source and
 *    target conversation message caches.
 *  - On 403 toasts "Нет прав переносить из этого чата" and closes.
 *  - On other errors toasts the server error message.
 */
import React, { useState } from 'react';
import { X, Search, MessageSquare, Bot, ArrowRightLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { logger } from '@/shared/utils/logger';
import { useChatPickerList } from './shared/useChatPickerList';
import type { ChatMessage } from '../../../types';

interface MoveMessageModalProps {
  message: ChatMessage;
  currentConversationId: number;
  spaceId?: number;
  onClose: () => void;
}

interface ApiErrorPayload {
  status?: number;
  data?: { error?: { message?: string }; message?: string };
  message?: string;
}

function extractApiError(err: unknown): { status: number | undefined; message: string } {
  const e = err as ApiErrorPayload;
  const status = e?.status;
  const message =
    e?.data?.error?.message ||
    e?.data?.message ||
    e?.message ||
    'Ошибка при переносе';
  return { status, message };
}

export const MoveMessageModal: React.FC<MoveMessageModalProps> = ({
  message,
  currentConversationId,
  spaceId,
  onClose,
}) => {
  const [sending, setSending] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { search, setSearch, filtered, isLoading } = useChatPickerList({
    excludeConversationId: currentConversationId,
    spaceId,
    limit: 100,
  });

  const invalidateConversationCaches = (sourceId: number, targetId: number) => {
    // Match patterns used by useConversationMessages.ts: ['conversation-messages', id]
    queryClient.invalidateQueries({ queryKey: ['conversation-messages', sourceId] });
    queryClient.invalidateQueries({ queryKey: ['conversation-messages', targetId] });
    // Also refresh the conversation metadata + inbox
    queryClient.invalidateQueries({ queryKey: ['conversation', sourceId] });
    queryClient.invalidateQueries({ queryKey: ['conversation', targetId] });
    queryClient.invalidateQueries({ queryKey: ['inbox-conversations'] });
  };

  const handleMove = async (targetConv: any) => {
    if (sending || !message.id) return;
    const targetId = targetConv.id as number;
    setSending(targetId);

    try {
      await apiClient.post(
        `/chat/conversations/${currentConversationId}/messages/move`,
        {
          target_conversation_id: targetId,
          message_ids: [Number(message.id)],
        },
      );

      const targetTitle =
        targetConv.title || targetConv.agent_name || `Чат #${targetId}`;
      showToast(`Перенесено в ${targetTitle}`, 'success');
      invalidateConversationCaches(currentConversationId, targetId);
      onClose();
    } catch (err) {
      const { status, message: errMessage } = extractApiError(err);
      logger.error('[MoveMessageModal] move failed:', err);
      if (status === 403) {
        showToast('Нет прав переносить из этого чата', 'error');
        onClose();
      } else {
        showToast(errMessage, 'error');
        setSending(null);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[70vh] bg-[var(--bg-primary)] rounded-xl shadow-2xl border border-[var(--border-primary)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)]">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-[var(--color-primary-500)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Перенести в чат
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-[var(--border-secondary)]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск чата..."
              autoFocus
              className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-[var(--text-tertiary)]">
              Загрузка...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-center text-sm text-[var(--text-tertiary)]">
              {search ? 'Ничего не найдено' : 'Нет доступных чатов'}
            </div>
          ) : (
            filtered.map((conv: any) => (
              <button
                key={conv.id}
                onClick={() => handleMove(conv)}
                disabled={sending === conv.id}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                  'hover:bg-[var(--bg-secondary)]',
                  sending === conv.id && 'opacity-50 pointer-events-none'
                )}
              >
                {/* Icon */}
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-[var(--bg-tertiary)]">
                  {conv.agent_icon ? (
                    <span className="text-base">{conv.agent_icon}</span>
                  ) : conv.type === 'ai_chat' || conv.type === 'chat' ? (
                    <Bot className="w-4 h-4 text-[var(--text-tertiary)]" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-[var(--text-tertiary)]" />
                  )}
                </div>

                {/* Title + subtitle */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {conv.title || conv.agent_name || `Чат #${conv.id}`}
                  </div>
                  {conv.agent_name && conv.title && (
                    <div className="text-xs text-[var(--text-tertiary)] truncate">
                      {conv.agent_name}
                    </div>
                  )}
                </div>

                {/* Sending indicator */}
                {sending === conv.id && (
                  <div className="w-4 h-4 border-2 border-[var(--color-primary-500)] border-t-transparent rounded-full animate-spin" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Preview of moved message */}
        <div className="px-4 py-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
          <div className="text-[10px] text-[var(--text-tertiary)] mb-1">
            Переносимое сообщение:
          </div>
          <div className="text-xs text-[var(--text-secondary)] line-clamp-2">
            {message.content?.slice(0, 200)}
          </div>
        </div>
      </div>
    </div>
  );
};
