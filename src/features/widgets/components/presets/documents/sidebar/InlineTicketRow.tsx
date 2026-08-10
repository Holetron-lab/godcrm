import React, { useContext } from 'react';
import { MessageCircle, Paperclip } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { useAIChat } from '@/features/ai-chat';
import { useDocumentsContext } from '../DocumentsContext';
import {
  getStateColor,
  getStateName,
  getTicketField,
  getTicketTitle,
  getTypeIcon,
  useTicketConfig,
  useTicketDictionaries,
} from '../content/ticketUtils';
import { TicketsDataContext } from './DocumentTicketsProvider';

export function InlineTicketRow({ ticketRef, indent }: { ticketRef: number | string; indent: number }) {
  const ctx = useDocumentsContext();
  const { openTaskChat, attachRowToMessage: attachTicketToMessage } = useAIChat();
  const tickets = useContext(TicketsDataContext);
  const ticket = tickets.find(t => t.id === Number(ticketRef));
  const { config: ticketConfig } = useTicketConfig(ctx.config);
  const { types, states } = useTicketDictionaries(ticketConfig);

  if (!ticket) return null;

  const openTicketChat = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!ticketConfig?.table_id) {
      showToast('Таблица тикетов не настроена', 'error');
      return;
    }
    try {
      const response = await apiClient.get<{ data: { conversationId: number; id: number } }>(
        `/chat/tasks/${ticketConfig.table_id}/${ticket.id}?create=true`
      );
      const convId = response.data?.conversationId || response.data?.id;
      if (convId) {
        const ticketTitle = ticketConfig ? getTicketTitle(ticket, ticketConfig) : '';
        openTaskChat({
          conversationId: convId,
          tableId: ticketConfig.table_id,
          rowId: ticket.id,
          rowTitle: ticketTitle || `#${ticket.id}`,
        });
      } else {
        showToast('Не удалось получить ID чата', 'error');
      }
    } catch (error) {
      logger.error('openTicketChat failed', { error, ticketId: ticket.id });
      showToast('Не удалось открыть чат', 'error');
    }
  };

  const typeVal = ticketConfig ? getTicketField(ticket, ticketConfig, 'type') : undefined;
  const stateVal = ticketConfig ? getTicketField(ticket, ticketConfig, 'state') : undefined;
  const titleVal = ticketConfig ? getTicketTitle(ticket, ticketConfig) : '';

  return (
    <div
      className="flex items-center gap-2 py-1 px-2 rounded text-xs hover:bg-[var(--bg-tertiary)] cursor-pointer border-l-2 border-blue-500/30 group"
      style={{ marginLeft: indent }}
      onClick={openTicketChat}
    >
      <span className="text-sm">{getTypeIcon(typeVal as number, types)}</span>
      <span className="flex-1 truncate text-[var(--text-secondary)]">{titleVal || 'Без названия'}</span>
      <span className={cn('px-1 py-0.5 rounded text-[9px]', getStateColor(stateVal as number, states))}>
        {getStateName(stateVal as number, states)}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <MessageCircle className="w-3 h-3 text-blue-400 shrink-0" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (ticketConfig?.table_id) {
              attachTicketToMessage({
                table_id: ticketConfig.table_id,
                row_id: ticket.id,
                table_name: 'Tickets',
                table_icon: '🎫',
                row_title: titleVal || `#${ticket.id}`,
              });
            }
          }}
          className="p-0.5 rounded hover:bg-green-500/20"
          title="Прикрепить к сообщению"
        >
          <Paperclip className="w-3 h-3 text-green-400 shrink-0" />
        </button>
      </div>
    </div>
  );
}
