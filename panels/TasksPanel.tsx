/**
 * TasksPanel — extracted from AIChatPanel.renderTasksPanel()
 * Displays tasks from a configured table source with search and chat binding.
 */

import React from 'react';
import {
  X,
  Search,
  Loader2,
  ListTodo,
  MessageSquare,
  Plus,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';

type PanelTab = 'none' | 'contacts' | 'ai-agents' | 'tasks' | 'settings' | 'inbox';

interface TasksSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
}

interface TaskRow {
  id: number;
  data: Record<string, unknown>;
}

interface Conversation {
  id: number;
  title?: string;
  updatedAt: string;
  metadata?: { boundRow?: { row_id: number; table_id: number } };
}

interface BoundRow {
  table_id: number;
  row_id: number;
  table_name?: string;
  table_icon?: string;
  row_title?: string;
}

interface TasksSourceInlineSelectorProps {
  defaultSpaceId: number | null;
  onSelect: (config: TasksSourceConfig) => void;
  onCancel: () => void;
  showHeader?: boolean;
}

// Column name aliases for auto-detection
const TITLE_ALIASES = ['title', 'what', 'name', 'subject', 'Название'];

/** Get task row title using configured column or fallback aliases */
function getTaskRowTitle(
  row: { id: number; data: Record<string, unknown> },
  config?: TasksSourceConfig
): string {
  const d = row.data;
  if (config?.displayColumn && d[config.displayColumn]) {
    return String(d[config.displayColumn]);
  }
  for (const alias of TITLE_ALIASES) {
    if (d[alias]) return String(d[alias]);
  }
  return `Запись #${row.id}`;
}

/** Get task row field value */
function getTaskRowField(
  row: { id: number; data: Record<string, unknown> },
  column?: string
): unknown {
  if (!column) return undefined;
  return row.data[column];
}

export interface TasksPanelProps {
  tasksSource: TasksSourceConfig | undefined;
  updateTasksSource: (config: TasksSourceConfig | undefined) => void;
  tasksSearch: string;
  setTasksSearch: (value: string) => void;
  isLoadingTasks: boolean;
  taskRows: TaskRow[];
  filteredTaskRows: TaskRow[];
  taskStatusDict: Array<{ id: number; name: string }>;
  conversations: Conversation[];
  expandedTaskChats: number | null;
  setExpandedTaskChats: (id: number | null) => void;
  createNewConversation: () => void;
  selectConversation: (id: number) => void;
  setBoundRows: (rows: BoundRow[]) => void;
  setActivePanel: (panel: PanelTab) => void;
  effectiveSpaceId: number | null;
  TasksSourceInlineSelector: React.ComponentType<TasksSourceInlineSelectorProps>;
}

export function TasksPanel({
  tasksSource,
  updateTasksSource,
  tasksSearch,
  setTasksSearch,
  isLoadingTasks,
  taskRows,
  filteredTaskRows,
  taskStatusDict,
  conversations,
  expandedTaskChats,
  setExpandedTaskChats,
  createNewConversation,
  selectConversation,
  setBoundRows,
  setActivePanel,
  effectiveSpaceId,
  TasksSourceInlineSelector,
}: TasksPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {tasksSource ? (
        <>
          <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <ListTodo className="w-3.5 h-3.5" />
                <span>{tasksSource.tableIcon || '📋'} {tasksSource.tableName}</span>
              </div>
              <button
                onClick={() => updateTasksSource(undefined)}
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                Изменить
              </button>
            </div>
          </div>
          {/* Search input for tasks */}
          <div className="px-3 py-2 border-b border-[var(--border-secondary)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={tasksSearch}
                onChange={(e) => setTasksSearch(e.target.value)}
                placeholder="Поиск задач..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
              />
              {tasksSearch && (
                <button
                  onClick={() => setTasksSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded"
                >
                  <X className="w-3 h-3 text-[var(--text-tertiary)]" />
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoadingTasks ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
              </div>
            ) : taskRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
                Нет записей
              </div>
            ) : filteredTaskRows.length === 0 && tasksSearch.trim() ? (
              <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
                Ничего не найдено по запросу &quot;{tasksSearch}&quot;
              </div>
            ) : (
              filteredTaskRows.map(row => {
                // Task binding feature - conversations may have metadata.boundRow
                type ConversationWithMeta = typeof conversations[number] & {
                  metadata?: { boundRow?: { row_id: number; table_id: number } }
                };
                const rowChats = (conversations as ConversationWithMeta[]).filter(c =>
                  c.metadata?.boundRow && c.metadata.boundRow.row_id === row.id && c.metadata.boundRow.table_id === tasksSource?.tableId
                );
                const chatCount = rowChats.length;
                const isExpanded = expandedTaskChats === row.id;

                const rowTitle = getTaskRowTitle(row, tasksSource);
                const rowDesc = getTaskRowField(row, tasksSource?.descriptionColumn) as string | undefined;
                const statusVal = getTaskRowField(row, tasksSource?.statusColumn);
                const statusName = statusVal && taskStatusDict.length > 0
                  ? taskStatusDict.find(s => s.id === Number(statusVal))?.name || ''
                  : '';

                return (
                  <div key={row.id} className="border-b border-[var(--border-secondary)] last:border-b-0">
                    <div className="flex items-start gap-2 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors">
                      <div className="w-7 h-7 rounded bg-[var(--color-primary-500)]/20 flex items-center justify-center text-xs text-[var(--color-primary-400)] flex-shrink-0 mt-0.5">
                        #{row.id}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-[var(--text-primary)] truncate block">
                          {rowTitle}
                        </span>
                        {rowDesc && (
                          <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">
                            {String(rowDesc)}
                          </p>
                        )}
                        {statusName && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400">
                            {statusName}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (chatCount === 0) {
                            createNewConversation();
                            setBoundRows([{
                              table_id: tasksSource!.tableId,
                              table_name: tasksSource!.tableName,
                              table_icon: tasksSource!.tableIcon,
                              row_id: row.id,
                              row_title: rowTitle
                            }]);
                            setActivePanel('none');
                          } else if (chatCount === 1) {
                            selectConversation(rowChats[0].id);
                            setActivePanel('none');
                          } else {
                            setExpandedTaskChats(isExpanded ? null : row.id);
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
                              selectConversation(chat.id);
                              setActivePanel('none');
                              setExpandedTaskChats(null);
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
                              table_id: tasksSource!.tableId,
                              table_name: tasksSource!.tableName,
                              table_icon: tasksSource!.tableIcon,
                              row_id: row.id,
                              row_title: rowTitle
                            }]);
                            setActivePanel('none');
                            setExpandedTaskChats(null);
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
        </>
      ) : (
        <div className="flex flex-col h-full px-4 py-4">
          <div className="flex flex-col items-center text-center mb-4">
            <ListTodo className="w-10 h-10 text-[var(--text-tertiary)] mb-3" />
            <p className="text-sm text-[var(--text-secondary)] mb-1">Источник не настроен</p>
            <p className="text-xs text-[var(--text-tertiary)]">Выберите таблицу для задач</p>
          </div>
          <TasksSourceInlineSelector
            defaultSpaceId={effectiveSpaceId}
            onSelect={(config) => {
              updateTasksSource(config);
            }}
            onCancel={() => {}}
            showHeader={false}
          />
        </div>
      )}
    </div>
  );
}
