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

/** Get first truthy field from row.data by checking multiple column name candidates */
function getField(data: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}

/** Status → color mapping */
function getStatusStyle(status: string): { bg: string; text: string } {
  const s = status.toLowerCase().trim();
  if (['done', 'closed', 'resolved', 'completed', 'готово', 'завершено', 'закрыт'].some(x => s.includes(x)))
    return { bg: 'bg-green-500/20', text: 'text-green-400' };
  if (['in progress', 'in_progress', 'active', 'в работе', 'в процессе', 'started'].some(x => s.includes(x)))
    return { bg: 'bg-yellow-500/20', text: 'text-yellow-400' };
  if (['blocked', 'on hold', 'заблокирован', 'hold'].some(x => s.includes(x)))
    return { bg: 'bg-red-500/20', text: 'text-red-400' };
  if (['review', 'testing', 'qa', 'тестирование', 'ревью'].some(x => s.includes(x)))
    return { bg: 'bg-blue-500/20', text: 'text-blue-400' };
  if (['backlog', 'бэклог', 'icebox'].some(x => s.includes(x)))
    return { bg: 'bg-gray-500/20', text: 'text-gray-400' };
  // default: todo/open/new
  return { bg: 'bg-slate-500/20', text: 'text-slate-400' };
}

/** Priority → color + label */
function getPriorityStyle(priority: string): { bg: string; text: string; emoji: string } | null {
  const p = priority.toLowerCase().trim();
  if (['critical', 'p0', 'urgent', 'критичный', 'срочный'].some(x => p.includes(x)))
    return { bg: 'bg-red-500/20', text: 'text-red-400', emoji: '🔴' };
  if (['high', 'p1', 'высокий'].some(x => p.includes(x)))
    return { bg: 'bg-orange-500/20', text: 'text-orange-400', emoji: '🟠' };
  if (['medium', 'p2', 'средний', 'normal'].some(x => p.includes(x)))
    return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', emoji: '🟡' };
  if (['low', 'p3', 'низкий'].some(x => p.includes(x)))
    return { bg: 'bg-blue-500/20', text: 'text-blue-400', emoji: '🔵' };
  return null;
}

/** Type → emoji */
function getTypeEmoji(type: string): string {
  const t = type.toLowerCase().trim();
  if (['bug', 'баг', 'defect', 'ошибка'].some(x => t.includes(x))) return '🐛';
  if (['feature', 'feat', 'фича', 'функция', 'enhancement'].some(x => t.includes(x))) return '✨';
  if (['spike', 'research', 'исследование'].some(x => t.includes(x))) return '🔍';
  if (['chore', 'refactor', 'рефакторинг', 'tech'].some(x => t.includes(x))) return '🔧';
  if (['docs', 'documentation', 'документация'].some(x => t.includes(x))) return '📝';
  if (['test', 'тест'].some(x => t.includes(x))) return '🧪';
  return '📋';
}

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
  // Pagination
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
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
  selectConversation,
  hasMore,
  isLoadingMore,
  onLoadMore,
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
          <>
          {ticketRows.map(row => {
            // Ticket binding - conversations may have metadata.boundRow
            type ConversationWithMeta = typeof conversations[number] & {
              metadata?: { boundRow?: { row_id: number; table_id: number } }
            };
            const rowChats = (conversations as ConversationWithMeta[]).filter(c =>
              c.metadata?.boundRow && c.metadata.boundRow.row_id === row.id && c.metadata.boundRow.table_id === ticketsSource?.tableId
            );
            const chatCount = rowChats.length;
            const isExpanded = expandedTicketChats === row.id;

            const rowTitle = String(row.data['name'] || row.data['title'] || row.data['Название'] || `Запись #${row.id}`);
            const status = getField(row.data, 'status', 'state', 'task_status', 'Статус');
            const priority = getField(row.data, 'priority', 'urgency', 'Приоритет');
            const type = getField(row.data, 'type', 'task_type', 'ticket_type', 'kind', 'Тип');
            const statusStyle = status ? getStatusStyle(status) : null;
            const priorityStyle = priority ? getPriorityStyle(priority) : null;
            const typeEmoji = type ? getTypeEmoji(type) : '';

            return (
              <div key={row.id} className="border-b border-[var(--border-secondary)] last:border-b-0">
                <div className="flex items-start gap-2 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors">
                  <div className={cn(
                    "w-7 h-7 rounded flex items-center justify-center text-xs flex-shrink-0 mt-0.5",
                    statusStyle ? `${statusStyle.bg} ${statusStyle.text}` : "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-400)]"
                  )}>
                    {typeEmoji || '#'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-[var(--text-primary)] truncate block">
                      {priorityStyle && <span className="mr-1" title={priority}>{priorityStyle.emoji}</span>}
                      {rowTitle}
                    </span>
                    {(status || priority) && (
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {status && statusStyle && (
                          <span className={cn("inline-block px-1.5 py-0.5 rounded text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                            {status}
                          </span>
                        )}
                        {type && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400">
                            {type}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
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
                          row_title: rowTitle
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
                      "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors flex-shrink-0 mt-0.5",
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
                          row_title: rowTitle
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
          })}
          {hasMore && (
            <div className="px-3 py-2 border-t border-[var(--border-secondary)]">
              <button
                onClick={() => onLoadMore?.()}
                disabled={isLoadingMore}
                className="w-full py-2 text-xs text-[var(--color-primary-500)] hover:bg-[var(--bg-tertiary)] rounded transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  'Загрузить ещё'
                )}
              </button>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
};

// Legacy alias for backwards compatibility (must be after TicketsPanel declaration)
export const TasksPanel = TicketsPanel;
