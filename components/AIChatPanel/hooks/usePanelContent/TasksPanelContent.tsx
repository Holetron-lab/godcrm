/** TasksPanelContent — ADR-119 extracted from usePanelContent.tsx */
import React from 'react';
import { X, Search, Loader2, ListTodo, Plus, MessageSquare, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { TasksSourceInlineSelector } from '../../../TasksSourceInlineSelector';
import { getTaskRowTitle, getTaskRowField } from '../../../AIChatPanel.utils';
import type { PanelContentDeps } from './PanelContentTypes';

export function TasksPanelContent(d: PanelContentDeps) {
  type ConversationWithMeta = typeof d.conversations[number] & {
    metadata?: { boundRow?: { row_id: number; table_id: number } }
  };

  return (
    <div className="flex flex-col h-full">
      {d.tasksSource ? (
        <>
          <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <ListTodo className="w-3.5 h-3.5" />
                <span>{d.tasksSource.tableIcon || '\uD83D\uDCCB'} {d.tasksSource.tableName}</span>
              </div>
              <button onClick={() => d.updateTasksSource(undefined)} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Изменить</button>
            </div>
          </div>
          <div className="px-3 py-2 border-b border-[var(--border-secondary)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              <input type="text" value={d.tasksSearch} onChange={(e) => d.setTasksSearch(e.target.value)} placeholder="Поиск задач..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30" />
              {d.tasksSearch && (
                <button onClick={() => d.setTasksSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded">
                  <X className="w-3 h-3 text-[var(--text-tertiary)]" />
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {d.isLoadingTasks ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" /></div>
            ) : d.taskRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">Нет записей</div>
            ) : d.filteredTaskRows.length === 0 && d.tasksSearch.trim() ? (
              <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">Ничего не найдено по запросу &quot;{d.tasksSearch}&quot;</div>
            ) : (
              d.filteredTaskRows.map(row => {
                const rowChats = (d.conversations as ConversationWithMeta[]).filter(c =>
                  c.metadata?.boundRow && c.metadata.boundRow.row_id === row.id && c.metadata.boundRow.table_id === d.tasksSource?.tableId
                );
                const chatCount = rowChats.length;
                const isExpanded = d.expandedTaskChats === row.id;
                const rowTitle = getTaskRowTitle(row, d.tasksSource);
                const rowDesc = getTaskRowField(row, d.tasksSource?.descriptionColumn) as string | undefined;
                const statusVal = getTaskRowField(row, d.tasksSource?.statusColumn);
                const statusName = statusVal && d.taskStatusDict.length > 0 ? d.taskStatusDict.find(s => s.id === Number(statusVal))?.name || '' : '';

                return (
                  <div key={row.id} className="border-b border-[var(--border-secondary)] last:border-b-0">
                    <div className="flex items-start gap-2 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors">
                      <div className="w-7 h-7 rounded bg-[var(--color-primary-500)]/20 flex items-center justify-center text-xs text-[var(--color-primary-400)] flex-shrink-0 mt-0.5">#{row.id}</div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-[var(--text-primary)] truncate block">{rowTitle}</span>
                        {rowDesc && <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{String(rowDesc)}</p>}
                        {statusName && <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400">{statusName}</span>}
                      </div>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        if (chatCount === 0) {
                          d.createNewConversation();
                          d.setBoundRows([{ table_id: d.tasksSource!.tableId, table_name: d.tasksSource!.tableName, table_icon: d.tasksSource!.tableIcon, row_id: row.id, row_title: rowTitle }]);
                          d.setActivePanel('none');
                        } else if (chatCount === 1) { d.selectConversation(rowChats[0].id); d.setActivePanel('none'); }
                        else d.setExpandedTaskChats(isExpanded ? null : row.id);
                      }}
                        className={cn("flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors flex-shrink-0 mt-0.5",
                          chatCount > 0 ? "bg-[var(--color-primary-500)]/10 text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/20" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                        )} title={chatCount === 0 ? 'Новый чат' : chatCount === 1 ? 'Открыть чат' : `${chatCount} чатов`}>
                        <MessageSquare className="w-3.5 h-3.5" />
                        {chatCount > 1 && (<><span>{chatCount}</span><ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} /></>)}
                        {chatCount === 0 && <Plus className="w-3 h-3" />}
                      </button>
                    </div>
                    {isExpanded && chatCount > 1 && (
                      <div className="bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)]">
                        {rowChats.map(chat => (
                          <button key={chat.id} onClick={() => { d.selectConversation(chat.id); d.setActivePanel('none'); d.setExpandedTaskChats(null); }}
                            className="w-full flex items-center gap-2 px-3 py-2 pl-12 hover:bg-[var(--bg-secondary)] transition-colors text-left">
                            <MessageSquare className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                            <span className="flex-1 text-xs text-[var(--text-secondary)] truncate">{chat.title || 'Чат'}</span>
                            <span className="text-[10px] text-[var(--text-tertiary)]">{new Date(chat.updatedAt).toLocaleDateString()}</span>
                          </button>
                        ))}
                        <button onClick={() => { d.createNewConversation(); d.setBoundRows([{ table_id: d.tasksSource!.tableId, table_name: d.tasksSource!.tableName, table_icon: d.tasksSource!.tableIcon, row_id: row.id, row_title: rowTitle }]); d.setActivePanel('none'); d.setExpandedTaskChats(null); }}
                          className="w-full flex items-center gap-2 px-3 py-2 pl-12 hover:bg-[var(--bg-secondary)] transition-colors text-left text-[var(--color-primary-500)]">
                          <Plus className="w-3.5 h-3.5" /><span className="text-xs">Новый чат</span>
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
          <TasksSourceInlineSelector defaultSpaceId={d.effectiveSpaceId} onSelect={(config) => d.updateTasksSource(config)} onCancel={() => {}} showHeader={false} />
        </div>
      )}
    </div>
  );
}
