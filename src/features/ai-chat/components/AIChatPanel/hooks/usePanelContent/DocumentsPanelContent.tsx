/** DocumentsPanelContent — chip-style documents panel.
 *
 * Mirrors TasksPanelContent verbatim: single header row (search + filter
 * toggle + create), same filter strip toggle, same per-row mini-toolbar via
 * BindableRowsList. Source identity (icon · name · loaded/total) lives in the
 * BindableRowsList footer status bar.
 */
import React, { useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { X, FileText, Search, Plus } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { AddRowModal } from '@/features/tables/components/modals/AddRowModal';
import { BindableRowsList } from '../../components/BindableRowsList';
import { RowPickerFilters, RowPickerFiltersToggle, type FilterMap } from '../../../RowBindingV2.RowList.Filters';
import type { PanelContentDeps } from './PanelContentTypes';

interface RowInfo { id: number; data: Record<string, unknown> }
interface PageResult { rows: RowInfo[]; page: number; pages: number; total: number }
// Side-docked panel pulls 100 per page (taller viewport), bottom-docked stays
// at 30. Mirrors the same rule for tasks (see useDataQueries.ts).
const PAGE_SIZE_WIDE = 100;
const PAGE_SIZE_BOTTOM = 30;

function readField(data: Record<string, unknown>, col: string): unknown {
  if (col in data) return data[col];
  const lower = col.toLowerCase();
  for (const k of Object.keys(data)) {
    if (k.toLowerCase() === lower) return data[k];
  }
  return undefined;
}

export function DocumentsPanelContent(d: PanelContentDeps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterMap>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const docs = d.favoritesConfig?.documents;

  const currentBoundRowId = useMemo(() => {
    const cid = d.currentConversationId;
    if (!cid) return null;
    type ConvWithBinding = typeof d.conversations[number] & { bound_row_id?: number | null };
    const c = (d.conversations as ConvWithBinding[]).find(x => x.id === cid);
    return c?.bound_row_id ?? null;
  }, [d.conversations, d.currentConversationId]);

  const enabled = !!docs?.tableId;
  const { data: columns = [] } = useTableColumns(docs?.tableId ? String(docs.tableId) : undefined);
  const pageSize = d.isWideMode ? PAGE_SIZE_WIDE : PAGE_SIZE_BOTTOM;

  const {
    data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage,
  } = useInfiniteQuery<PageResult>({
    queryKey: ['documents-panel-rows', docs?.tableId, search, pageSize],
    enabled,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const page = (pageParam as number) ?? 1;
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      params.append('page', String(page));
      params.append('limit', String(pageSize));
      const r = await apiClient.get<{ success: boolean; data: { rows: RowInfo[]; pagination?: { page: number; pages: number; total?: number } } }>(
        `/tables/${docs!.tableId}/rows?${params}`
      );
      if (!r.success) return { rows: [], page, pages: page, total: 0 };
      return {
        rows: r.data.rows || [],
        page: r.data.pagination?.page ?? page,
        pages: r.data.pagination?.pages ?? page,
        total: r.data.pagination?.total ?? (r.data.rows?.length ?? 0),
      };
    },
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
    maxPages: 10,
  });

  // Server-side total for header `(N)`. Falls back to loaded-rows count if the
  // API didn't return one. Search is server-side, so this naturally reflects
  // search-scoped totals — only the client-side filter chips trim further.
  const total = data?.pages?.[0]?.total ?? 0;

  const rawRows: RowInfo[] = useMemo(
    () => (data?.pages || []).flatMap(p => p.rows),
    [data]
  );

  const rows: RowInfo[] = useMemo(() => {
    const keys = Object.keys(filters);
    if (keys.length === 0) return rawRows;
    return rawRows.filter(r => {
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
  }, [rawRows, filters]);

  const activeFilterCount = useMemo(
    () => Object.values(filters).reduce((s, arr) => s + (arr?.length || 0), 0),
    [filters]
  );

  if (!docs?.tableId) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)] flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <FileText className="w-3.5 h-3.5" />
            <span>Документы</span>
          </div>
          <button
            onClick={() => d.setActivePanel('none')}
            className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            title="Закрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">Источник документов не настроен</div>
      </div>
    );
  }

  const handleCreateConfirm = async (rowData: Record<string, unknown>) => {
    try {
      await apiClient.post(`/tables/${docs.tableId}/rows`, { data: rowData });
      qc.invalidateQueries({ queryKey: ['documents-panel-rows', docs.tableId] });
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск документов..."
              className="w-full pl-7 pr-7 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
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
            title="Создать документ"
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
        source={{
          tableId: docs.tableId,
          tableName: docs.tableName || 'Документы',
          tableIcon: docs.tableIcon,
          iconColumn: docs.iconColumn,
          displayColumn: docs.displayColumn,
          descriptionColumn: docs.descriptionColumn,
          statusColumn: docs.statusColumn,
          priorityColumn: docs.priorityColumn,
          categoryColumn: docs.categoryColumn,
        }}
        rows={rows}
        isLoading={isLoading}
        hasMore={hasNextPage}
        isLoadingMore={isFetchingNextPage}
        onLoadMore={() => fetchNextPage()}
        currentConversationId={d.currentConversationId}
        currentBoundRowId={currentBoundRowId}
        selectConversation={d.selectConversation}
        openTaskChat={d.openTaskChat}
        closePanel={() => d.setActivePanel('none')}
        setBoundRows={d.setBoundRows}
        setShowBoundRowsBar={d.setShowBoundRowsBar}
        onAttachToMessage={d.attachRowToMessage}
        total={total}
        panelMode={d.panelMode}
        onTogglePanelMode={d.togglePanelMode}
      />

      <AddRowModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onConfirm={handleCreateConfirm}
        columns={columns as Parameters<typeof AddRowModal>[0]['columns']}
        tableId={docs.tableId}
        tableName={docs.tableName || 'Документы'}
      />
    </div>
  );
}
