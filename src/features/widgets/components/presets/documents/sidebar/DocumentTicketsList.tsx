import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2, MessageCircle, Paperclip, Ticket } from 'lucide-react';
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
  type TicketRow,
} from '../content/ticketUtils';

export function DocumentTicketsList({ projectId }: { projectId: number }) {
  const ctx = useDocumentsContext();
  const { openTaskChat, attachRowToMessage: attachTicketRowToMessage } = useAIChat();
  const { config: ticketConfig, isLoading: isConfigLoading } = useTicketConfig(ctx.config);
  const { types, states } = useTicketDictionaries(ticketConfig);

  const { data: ticketsData, isLoading: isLoadingRows } = useQuery({
    queryKey: ['tickets', projectId, ticketConfig?.table_id],
    queryFn: async () => {
      const response = await apiClient.get(`/tables/${ticketConfig!.table_id}/rows?limit=5000`);
      return response.data;
    },
    enabled: !!ctx.selectedDocumentId && !!ticketConfig?.table_id,
    staleTime: 30_000,
  });

  const allTickets: TicketRow[] = ticketsData?.rows || [];

  const documentTicketRefs = useMemo(() => {
    if (!ctx.selectedDocumentId) return new Set<number>();
    return new Set(
      ctx.items
        .filter(item => item.ticket_ref)
        .map(item => Number(item.ticket_ref))
    );
  }, [ctx.items, ctx.selectedDocumentId]);

  const documentTickets = useMemo(() => {
    if (!ticketConfig) return [];
    const filtered = allTickets.filter(t => documentTicketRefs.has(t.id));
    if (!ctx.searchQuery.trim()) return filtered;
    const q = ctx.searchQuery.toLowerCase();
    return filtered.filter((ticket: TicketRow) =>
      getTicketTitle(ticket, ticketConfig).toLowerCase().includes(q)
    );
  }, [allTickets, documentTicketRefs, ctx.searchQuery, ticketConfig]);

  const groupedTickets = useMemo(() => {
    const groups: Record<string, { sectionTitle: string; tickets: TicketRow[] }> = {};
    const ungroupedKey = '__ungrouped__';

    for (const item of ctx.items) {
      if (!item.ticket_ref) continue;
      const ticketId = Number(item.ticket_ref);
      const ticket = documentTickets.find(t => t.id === ticketId);
      if (!ticket) continue;

      let sectionTitle = 'Без секции';
      const itemIndex = ctx.items.indexOf(item);
      for (let i = itemIndex - 1; i >= 0; i--) {
        const prev = ctx.items[i];
        if (prev.level === 'h1' || prev.level === 'h2' || prev.level === 'h3') {
          sectionTitle = prev.title || prev.content || 'Без названия';
          break;
        }
      }

      const key = sectionTitle === 'Без секции' ? ungroupedKey : sectionTitle;
      if (!groups[key]) {
        groups[key] = { sectionTitle, tickets: [] };
      }
      if (!groups[key].tickets.find(t => t.id === ticket.id)) {
        groups[key].tickets.push(ticket);
      }
    }

    return Object.values(groups);
  }, [ctx.items, documentTickets]);

  const openTicketChat = async (ticketId: number, ticketTitle?: string) => {
    if (!ticketConfig?.table_id) {
      showToast('Таблица тикетов не настроена', 'error');
      return;
    }

    try {
      const response = await apiClient.get<{ data: { conversationId: number; id: number } }>(
        `/chat/tasks/${ticketConfig.table_id}/${ticketId}?create=true`
      );
      const convId = response.data?.conversationId || response.data?.id;

      if (convId) {
        openTaskChat({
          conversationId: convId,
          tableId: ticketConfig.table_id,
          rowId: ticketId,
          rowTitle: ticketTitle,
        });
      } else {
        showToast('Не удалось получить ID чата', 'error');
      }
    } catch (error) {
      logger.error('openTicketChat failed', { error, ticketId, tableId: ticketConfig.table_id });
      showToast('Не удалось открыть чат', 'error');
    }
  };

  if (isConfigLoading || isLoadingRows) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!ticketConfig) {
    return (
      <div className="text-center py-8 text-[var(--text-tertiary)]">
        <Ticket className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Тикеты не настроены</p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      <button
        onClick={() => ctx.setTicketsViewMode(false)}
        className="w-full flex items-center gap-2 p-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-lg mb-2"
      >
        <ChevronRight className="w-4 h-4 rotate-180" /> Назад
      </button>

      <div className="px-2 py-1 text-xs font-semibold text-[var(--text-tertiary)] uppercase">
        Тикеты документа ({documentTickets.length})
      </div>

      {groupedTickets.length > 0 ? (
        groupedTickets.map((group, gi) => (
          <div key={gi} className="mb-2">
            <div className="px-2 py-1 text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider border-b border-[var(--border-primary)]">
              {group.sectionTitle}
            </div>
            {group.tickets.map((ticket: TicketRow) => {
              const typeVal = getTicketField(ticket, ticketConfig, 'type');
              const stateVal = getTicketField(ticket, ticketConfig, 'state');
              return (
                <div
                  key={ticket.id}
                  className="flex items-center gap-2 p-2 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer group"
                >
                  <span className="text-base">{getTypeIcon(typeVal as number, types)}</span>
                  <span className="flex-1 truncate text-sm">{getTicketTitle(ticket, ticketConfig) || 'Без названия'}</span>
                  <span className={cn('px-1.5 py-0.5 rounded text-[10px]', getStateColor(stateVal as number, states))}>
                    {getStateName(stateVal as number, states)}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); openTicketChat(ticket.id, getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`); }}
                      className="p-1 rounded hover:bg-blue-500/20"
                      title="Открыть чат"
                    >
                      <MessageCircle className="w-3.5 h-3.5 text-blue-400" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (ticketConfig?.table_id) {
                          attachTicketRowToMessage({
                            table_id: ticketConfig.table_id,
                            row_id: ticket.id,
                            table_name: 'Tickets',
                            table_icon: '🎫',
                            row_title: getTicketTitle(ticket, ticketConfig) || `#${ticket.id}`,
                          });
                        }
                      }}
                      className="p-1 rounded hover:bg-green-500/20"
                      title="Прикрепить к сообщению"
                    >
                      <Paperclip className="w-3.5 h-3.5 text-green-400" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      ) : (
        <div className="text-center py-8 text-[var(--text-tertiary)]">
          <Ticket className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Нет тикетов в этом документе</p>
        </div>
      )}
    </div>
  );
}
