import React from 'react';
import { ListTodo, Loader2, MessageSquare, Plus, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { TicketsSourceInlineSelector } from '@/features/ai-chat/components/TicketsSourceInlineSelector';
import type { 
  TicketsSource, 
  TaskRow, 
  Conversation, 
  BoundRow,
  Space 
} from '../../types';

interface TicketsPanelProps {
  ticketsSource: TicketsSource | undefined;
  ticketRows: TaskRow[];
  isLoadingTickets: boolean;
  conversations: Conversation[];
  expandedTicketChats: number | null;
  currentSpace: Space | null;
  setTicketsSource: (source: TicketsSource | undefined) => void;
  setExpandedTicketChats: (ticketId: number | null) => void;
  createNewConversation: () => void;
  setBoundRows: (rows: BoundRow[]) => void;
  setActivePanel: (panel: string) => void;
  selectConversation: (conversationId: number) => void;
}

// Legacy alias for backwards compatibility
export type TasksPanelProps = TicketsPanelProps;

export const TicketsPanel: React.FC<TicketsPanelProps> = ({
  ticketsSource,
  ticketRows,
  isLoadingTickets,
  conversations,
  expandedTicketChats,
  currentSpace,
  setTicketsSource,
  setExpandedTicketChats,
  createNewConversation,
  setBoundRows,
  setActivePanel,
  selectConversation
}) => {
  if (!ticketsSource) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex flex-col h-full px-4 py-4">
          <div className="flex flex-col items-center text-center mb-4">
            <ListTodo className="w-10 h-10 text-[var(--text-tertiary)] mb-3" />
            <p className="text-sm text-[var(--text-secondary)] mb-1">Источник не настроен</p>
            <p className="text-xs text-[var(--text-tertiary)]">Выберите таблицу для тикетов</p>
          </div>
          <TicketsSourceInlineSelector
            defaultSpaceId={currentSpace?.id}
            onSelect={(config) => {
              setTicketsSource(config);
            }}
            onCancel={() => {}}
            showHeader={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <ListTodo className="w-3.5 h-3.5" />
            <span>{ticketsSource.tableIcon || '📋'} {ticketsSource.tableName}</span>
          </div>
          <button
            onClick={() => setTicketsSource(undefined)}
            className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            Изменить
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoadingTickets ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : ticketRows.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
            Нет записей
          </div>
        ) : (
          ticketRows.map(row => {
            // Ticket binding - conversations may have metadata.boundRow
            type ConversationWithMeta = typeof conversations[number] & {
              metadata?: { boundRow?: { row_id: number; table_id: number } }
            };
            const rowChats = (conversations as ConversationWithMeta[]).filter(c =>
              c.metadata?.boundRow && c.metadata.boundRow.row_id === row.id && c.metadata.boundRow.table_id === ticketsSource?.tableId
            );
            const chatCount = rowChats.length;
            const isExpanded = expandedTicketChats === row.id;
            
            return (
              <div key={row.id} className="border-b border-[var(--border-secondary)] last:border-b-0">
                <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors">
                  <div className="w-7 h-7 rounded bg-[var(--color-primary-500)]/20 flex items-center justify-center text-xs text-[var(--color-primary-400)] flex-shrink-0">
                    #{row.id}
                  </div>
                  <span className="flex-1 text-sm text-[var(--text-primary)] truncate">
                    {String(row.data['name'] || row.data['title'] || row.data['Название'] || `Запись #${row.id}`)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (chatCount === 0) {
                        createNewConversation();
                        setBoundRows([{
                          table_id: ticketsSource!.tableId,
                          table_name: ticketsSource!.tableName,
                          table_icon: ticketsSource!.tableIcon,
                          row_id: row.id,
                          row_title: String(row.data['name'] || row.data['title'] || row.data['Название'] || `#${row.id}`)
                        }]);
                        setActivePanel('none');
                      } else if (chatCount === 1) {
                        selectConversation(Number(rowChats[0].id));
                        setActivePanel('none');
                      } else {
                        setExpandedTicketChats(isExpanded ? null : row.id);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors flex-shrink-0",
                      chatCount > 0
                        ? "bg-[var(--color-primary-500)]/10 text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/20"
                        : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                    )}
                    title={chatCount === 0 ? 'Новый чат' : chatCount === 1 ? 'Открыть чат' : `${chatCount} чатов`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {chatCount > 1 && (
                      <>
                        <span>{chatCount}</span>
                        <ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} />
                      </>
                    )}
                    {chatCount === 0 && <Plus className="w-3 h-3" />}
                  </button>
                </div>
                {isExpanded && chatCount > 1 && (
                  <div className="bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)]">
                    {rowChats.map(chat => (
                      <button
                        key={chat.id}
                        onClick={() => {
                          selectConversation(Number(chat.id));
                          setActivePanel('none');
                          setExpandedTicketChats(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 pl-12 hover:bg-[var(--bg-secondary)] transition-colors text-left"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                        <span className="flex-1 text-xs text-[var(--text-secondary)] truncate">
                          {chat.title || 'Чат'}
                        </span>
                        <span className="text-[10px] text-[var(--text-tertiary)]">
                          {new Date(chat.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        createNewConversation();
                        setBoundRows([{
                          table_id: ticketsSource!.tableId,
                          table_name: ticketsSource!.tableName,
                          table_icon: ticketsSource!.tableIcon,
                          row_id: row.id,
                          row_title: String(row.data['name'] || row.data['title'] || row.data['Название'] || `#${row.id}`)
                        }]);
                        setActivePanel('none');
                        setExpandedTicketChats(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 pl-12 hover:bg-[var(--bg-secondary)] transition-colors text-left text-[var(--color-primary-500)]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span className="text-xs">Новый чат</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// Legacy alias for backwards compatibility (must be after TicketsPanel declaration)
export const TasksPanel = TicketsPanel;