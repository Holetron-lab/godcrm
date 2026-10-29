import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * ForwardMessageModal — pick a conversation to forward a message to.
 * Shows conversation list with search, sends forwarded text + link and original attachments.
 */
import React, { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Search, MessageSquare, Bot } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { useChatPickerList } from './shared/useChatPickerList';
import type { ChatMessage } from '../../../types';

interface ForwardMessageModalProps {
  message: ChatMessage;
  currentConversationId?: number;
  spaceId?: number;
  onClose: () => void;
}

export const ForwardMessageModal: React.FC<ForwardMessageModalProps> = ({
  message,
  currentConversationId,
  spaceId,
  onClose,
}) => {
  const { t } = useLanguage();
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [sending, setSending] = useState<number | null>(null);

  const { search, setSearch, filtered, isLoading } = useChatPickerList({
    excludeConversationId: currentConversationId,
    spaceId,
    limit: 100,
  });

  const handleForward = async (targetConvId: number) => {
    if (sending) return;
    setSending(targetConvId);

    try {
      const senderLabel = message.sender_name || message.agentName || message.role;
      const timestamp = message.timestamp
        ? new Date(message.timestamp).toLocaleString()
        : '';

      const sourceLink = currentConversationId
        ? `\n\n_Источник: чат #${currentConversationId}, сообщение #${message.id}_`
        : '';

      const forwardedText = [
        `--- Переслано от ${senderLabel}${timestamp ? ` (${timestamp})` : ''} ---`,
        message.content,
        '--- конец пересланного сообщения ---',
        sourceLink,
      ].join('\n');

      await apiClient.post(`/chat/conversations/${targetConvId}/messages`, {
        content: forwardedText,
        attachments: message.attachments,
      });

      showToast(t('aiChat.ui.messageForwarded'), 'success');
      onClose();
    } catch (err) {
      showToast(t('aiChat.ui.couldNotForwardMessage'), 'error');
    } finally {
      setSending(null);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            event.preventDefault();
            searchRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-[calc(100vw-2rem)] max-w-md max-h-[70vh] bg-[var(--bg-primary)] rounded-xl shadow-2xl border border-[var(--border-primary)] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)]">
            <Dialog.Title className="text-sm font-semibold text-[var(--text-primary)]">
              {t('aiChat.ui.chooseAChatToForwardTo')}</Dialog.Title>
            <button
              aria-label={t('aiChat.ui.close')}
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
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
                placeholder={t('aiChat.ui.searchChatsLabel')}
                ref={searchRef}
                aria-label={t('aiChat.ui.searchChatsLabel')}
                className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
              />
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-[var(--text-tertiary)]">
                {t('common.loading')}</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--text-tertiary)]">
                {search ? t('columnSettings.nothingFound') : t('aiChat.ui.noChatsAvailable')}
              </div>
            ) : (
              filtered.map((conv: any) => (
                <button
                  key={conv.id}
                  onClick={() => handleForward(conv.id)}
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
                      {conv.title || conv.agent_name || t('aiChat.ui.chatNumber', { id: conv.id })}
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

          {/* Preview of forwarded message */}
          <div className="px-4 py-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
            <div className="text-[10px] text-[var(--text-tertiary)] mb-1">{t('aiChat.ui.messageToForward')}</div>
            <div className="text-xs text-[var(--text-secondary)] line-clamp-2">
              {message.content?.slice(0, 200)}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
