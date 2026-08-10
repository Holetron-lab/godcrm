/** TasksPanelContent — chip-style tickets panel.
 *
 * Header layout (unified with DocumentsPanelContent):
 *   row 1: [🔍 search...]                       [filter] [+ create]
 *   row 2: [filter strip]   ← only when filter toggle is on
 *
 * Source identity (icon · name · loaded/total · ⚙ change source) lives in the
 * BindableRowsList footer status bar, not in a dedicated header row.
 *
 * Click on a row → opens the row's bound chat, lazy-creating it via
 * /chat/conversations/ensure-row-chat. Per-row mini-toolbar (✏️/📎/🔗/💬)
 * lives at the right edge of each card (see BindableRowsList).
 */
import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, X, ListTodo, Plus } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { AddRowModal } from '@/features/tables/components/modals/AddRowModal';
import { TasksSourceInlineSelector } from '../../../TasksSourceInlineSelector';
import { BindableRowsList } from '../../components/BindableRowsList';
import { RowPickerFilters, RowPickerFiltersToggle, type FilterMap } from '../../../RowBindingV2.RowList.Filters';
import type { PanelContentDeps } from './PanelContentTypes';

function readField(data: Record<string, unknown>, col: string): unknown {
  if (col in data) return data[col];
  const lower = col.toLowerCase();
  for (const k of Object.keys(data)) {
    if (k.toLowerCase() === lower) return data[k];
  }
  return undefined;
}

export function TasksPanelContent(d: PanelContentDeps) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<FilterMap>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const currentBoundRowId = useMemo(() => {
    const cid = d.currentConversationId;
    if (!cid) return null;
    type ConvWithBinding = typeof d.conversations[number] & { bound_row_id?: number | null };
    const c = (d.conversations as ConvWithBinding[]).find(x => x.id === cid);
    return c?.bound_row_id ?? null;
  }, [d.conversations, d.currentConversationId]);

  const { data: columns = [] } = useTableColumns(d.tasksSource ? String(d.tasksSource.tableId) : undefined);

  // Apply select-column filters on top of search-filtered rows.
  const filteredRows = useMemo(() => {
    const keys = Object.keys(filters);
    if (keys.length === 0) return d.filteredTaskRows;
    return d.filteredTaskRows.filter(r => {
      for (const [col, allowed] of Object.entries(filters)) {
        if (!allowed || allowed.length === 0) continue;
        const v = readField(r.data, col);
        if (Array.isArray(v)) {
          const matches = v.map(x => String(x));
          if (!allowed.some(a => matches.includes(a))) return false;
        } else {
          if (!allowed.includes(String(v ?? ''))) return false;
        }
      }
      return true;
    });
  }, [d.filteredTaskRows, filters]);

  const activeFilterCount = useMemo(
    () => Object.values(filters).reduce((s, arr) => s + (arr?.length || 0), 0),
    [filters]
  );

  if (!d.tasksSource) {
    return (
      <div className="flex flex-col h-full px-4 py-4">
        <div className="flex flex-col items-center text-center mb-4">
          <ListTodo className="w-10 h-10 text-[var(--text-tertiary)] mb-3" />
          <p className="text-sm text-[var(--text-secondary)] mb-1">Источник не настроен</p>
          <p className="text-xs text-[var(--text-tertiary)]">Выберите таблицу для задач</p>
        </div>
        <TasksSourceInlineSelector
          defaultSpaceId={d.effectiveSpaceId}
          onSelect={(config) => d.updateTasksSource(config)}
          onCancel={() => {}}
          showHeader={false}
        />
      </div>
    );
  }

  const handleCreateConfirm = async (data: Record<string, unknown>) => {
    try {
      await apiClient.post(`/tables/${d.tasksSource!.tableId}/rows`, { data });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['rows'] });
    } finally {
      setAddModalOpen(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header: search + filter toggle + create */}
      <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={d.tasksSearch}
              onChange={(e) => d.setTasksSearch(e.target.value)}
              placeholder="Поиск задач..."
              className="w-full pl-7 pr-7 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
            />
            {d.tasksSearch && (
              <button
                onClick={() => d.setTasksSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-[var(--bg-secondary)] rounded"
              >
                <X className="w-3 h-3 text-[var(--text-tertiary)]" />
              </button>
            )}
          </div>
          <RowPickerFiltersToggle
            open={filtersOpen}
            setOpen={setFiltersOpen}
            activeCount={activeFilterCount}
            onClear={() => setFilters({})}
            slim
          />
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            title="Создать задачу"
            className="p-1 rounded transition-colors text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/10"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {filtersOpen && (
        <RowPickerFilters
          columns={columns as Array<{ name: string; displayName?: string; type: string; config?: Record<string, unknown> }>}
          value={filters}
          onChange={setFilters}
        />
      )}

      <BindableRowsList
        source={d.tasksSource}
        rows={filteredRows}
        isLoading={d.isLoadingTasks}
        hasMore={d.hasNextTasksPage}
        isLoadingMore={d.isFetchingNextTasksPage}
        onLoadMore={d.fetchNextTasksPage}
        currentConversationId={d.currentConversationId}
        currentBoundRowId={currentBoundRowId}
        selectConversation={d.selectConversation}
        openTaskChat={d.openTaskChat}
        closePanel={() => d.setActivePanel('none')}
        setBoundRows={d.setBoundRows}
        setShowBoundRowsBar={d.setShowBoundRowsBar}
        onAttachToMessage={d.attachRowToMessage}
        total={d.tasksTotal}
        onChangeSource={() => d.updateTasksSource(undefined)}
        panelMode={d.panelMode}
        onTogglePanelMode={d.togglePanelMode}
      />

      <AddRowModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onConfirm={handleCreateConfirm}
        columns={columns as Parameters<typeof AddRowModal>[0]['columns']}
        tableId={d.tasksSource.tableId}
        tableName={d.tasksSource.tableName}
      />
    </div>
  );
}
