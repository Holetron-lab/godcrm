import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { CellContext, ColumnDef, ColumnSizingState, HeaderContext, SortingState, VisibilityState, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/shared/hooks/useToast';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { getColumnMinMaxSize, getDefaultColumnSize } from '../../utils/columnSizing';
import { ColumnHeader } from './ColumnHeader';
import { useActiveTable } from '../../hooks/useTable';
import { useColumnConfig } from '../../hooks/useColumnConfig';
import { useOpenColumnSettingsListener } from './useOpenColumnSettingsListener';
import { useTableData } from '../../hooks/useTableData';
import { useRowMutations } from '../../hooks/useRowMutations';
import { useColumnMutations } from '../../hooks/useColumnMutations';
import { useRowSelection } from '../../hooks/useRowSelection';
import { summarizeRows, useTableSummary, type TableSummaryState } from '../../hooks/useTableSummary';
import { useBulkReplace } from '../../hooks/useBulkReplace';
import { fetchAllTableRows } from '../../utils/fetchAllTableRows';
import { sortRowsWithSelection } from '../../utils/bulkReplaceUtils';
import type { ColumnModel, RowModel, ColumnConfig, TableModel } from '../../types/table.types';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { apiClient } from '@/shared/utils/apiClient';
import { useTablesStore } from '../../store/tablesStore';
import { renderCellValue } from './renderCellValue';
import { useTableCellActions } from './useTableCellActions';
import { useTableRowActions } from './useTableRowActions';
import {
  buildSystemColumns,
  getSystemColumnRowField,
  isSystemColumnId,
  setSystemColumnOverride,
  setSystemColumnVisibility,
} from '../../utils/systemColumns';
import { addressSortKey } from '../cells/AddressCell';
import type { UniversalTableProps } from './types';
import { filterTableRows } from './filterTableRows';
import { getDefaultTableSort } from '../../utils/defaultTableSort';

type UniversalCellMeta = {
  render: (context: CellContext<RowModel, unknown>) => ReturnType<typeof renderCellValue>;
  renderHeader: (context: HeaderContext<RowModel, unknown>) => React.ReactNode;
};

// Same type rules the toolbar (TableFilters) uses for search scope and group-by
const isSearchableColumn = (column: ColumnModel) =>
  ['text', 'number', 'email', 'url', 'phone', 'select', 'relation', 'textarea'].includes(column.type);
const isGroupableColumn = (column: ColumnModel) =>
  ['select', 'multi-select', 'multi_select'].includes(column.type);

// flexRender treats a function as a component type. Keep that type stable while
// reading the latest render inputs from the column definition on every render.
const UniversalTableCell = (context: CellContext<RowModel, unknown>) =>
  (context.column.columnDef.meta as UniversalCellMeta).render(context);
// Same for headers: an inline header component would remount (and close its open menu)
// every time columnDefs is rebuilt, e.g. when the server summary refreshes.
const UniversalTableHeader = (context: HeaderContext<RowModel, unknown>) =>
  (context.column.columnDef.meta as UniversalCellMeta).renderHeader(context);

export const useUniversalTableState = ({
  table: externalTable,
  columns: externalColumns,
  rows: externalRows,
  searchQuery = '',
  searchColumns = [],
  selectFilters = {},
  dateFilters = {},
  groupByColumn = null,
  onSearchColumnsChange,
  onGroupByColumnChange,
  addRowModalOpen = false,
  onCloseAddRowModal,
  onPaginationChange,
  onLoadMore,
  rawMode = false,
  readOnly = false,
  compact = false,
  disableNestedModals = false,
  spaceId,
  onLocalCellUpdate,
  bulkReplaceOpen,
  onBulkReplaceOpenChange,
  printOpen,
  onPrintOpenChange,
  spaceName,
  projectName,
}: UniversalTableProps = {}) => {
  const { t } = useLanguage();

  // Use external data if provided, otherwise use store
  const storeTable = useActiveTable();
  const storeColumnsRaw = useColumnConfig(externalTable ? null : storeTable?.id ?? null);
  const storeRows = useTableData(externalTable ? null : storeTable?.id ?? null);
  const table = externalTable || storeTable;
  const columnsRaw = externalColumns || storeColumnsRaw || [];
  const allRows = externalRows || storeRows || [];
  const rowsVersion = useTablesStore((state) => state.rowsVersion);
  // ADR-205: lens map delivered with the rows page; external rows carry none.
  const relations = useTablesStore((state) => (externalRows || !table?.id ? undefined : state.relations[String(table.id)]));

  // Filter rows based on search query and filters
  const rows = useMemo(() => filterTableRows(allRows, columnsRaw, {
    searchQuery, searchColumns, selectFilters, dateFilters,
  }), [allRows, searchQuery, searchColumns, selectFilters, dateFilters, rowsVersion]);
  const tableIdStr = String(table?.id ?? '');
  const rowsLimit = useTablesStore((state) => state.rowsLimit);
  const currentPage = useTablesStore((state) => state.currentPage);
  const totalPages = useTablesStore((state) => state.totalPages[tableIdStr] ?? 1);
  const totalRowsCount = useTablesStore((state) => state.totalRows[tableIdStr] ?? 0);
  const isLoadingMore = useTablesStore((state) => state.loadingMore);
  const setRowsLimit = useTablesStore((state) => state.setRowsLimit);
  const setCurrentPage = useTablesStore((state) => state.setCurrentPage);
  const setStoreSorting = useTablesStore((state) => state.setSorting);
  const storeSortColumn = useTablesStore((state) => state.sortColumn);
  const storeSortDirection = useTablesStore((state) => state.sortDirection);

  const useServerSorting = totalPages > 1 || totalRowsCount > rows.length;
  const exportModalOpen = useTablesStore((state) => state.exportModalOpen);
  const setExportModalOpen = useTablesStore((state) => state.setExportModalOpen);
  const importModalOpen = useTablesStore((state) => state.importModalOpen);
  const setImportModalOpen = useTablesStore((state) => state.setImportModalOpen);
  const [createColumnOpen, setCreateColumnOpen] = useState(false);
  const [columnInsertAt, setColumnInsertAt] = useState<{ id: string; side: 'left' | 'right' } | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [localSorting, setLocalSorting] = useState<SortingState>([]);

  const defaultSort = useMemo(() => getDefaultTableSort(columnsRaw), [columnsRaw]);
  useEffect(() => setLocalSorting([]), [table?.id]);

  const effectiveSorting = useMemo(() => {
    if (useServerSorting && storeSortColumn && storeSortDirection) {
      return [{ id: storeSortColumn, desc: storeSortDirection === 'desc' }];
    }
    if (localSorting.length > 0) return localSorting;
    return defaultSort ? [{ id: defaultSort.column, desc: defaultSort.direction === 'desc' }] : [];
  }, [useServerSorting, storeSortColumn, storeSortDirection, localSorting, defaultSort]);

  const prevColumnSizing = useRef<ColumnSizingState>({});
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [rowToDuplicate, setRowToDuplicate] = useState<RowModel | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [rowToEdit, setRowToEdit] = useState<RowModel | null>(null);
  const [internalBulkReplaceOpen, setInternalBulkReplaceOpen] = useState(false);
  const [internalPrintOpen, setInternalPrintOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const bulkReplaceModalOpen = bulkReplaceOpen !== undefined ? bulkReplaceOpen : internalBulkReplaceOpen;
  const setBulkReplaceModalOpen = onBulkReplaceOpenChange || setInternalBulkReplaceOpen;
  const printModalOpen = printOpen !== undefined ? printOpen : internalPrintOpen;
  const setPrintModalOpen = onPrintOpenChange || setInternalPrintOpen;

  // Row selection state
  const {
    selectedRowIds,
    selectionSort,
    toggleRowSelection,
    selectAll,
    selectAllFiltered,
    clearSelection,
    setSelectionSort,
    getSelectedCount,
    isRowSelected,
    isAllSelected,
    isIndeterminate
  } = useRowSelection();

  // Server totals: the whole filtered table and the explicit selection are computed
  // server-side, so they do not depend on how many pages are loaded (ticket 22367).
  // A data-source table is aggregated in its source for the whole table only: its search
  // and filters run in the browser, and its row ids are synthetic, so a filtered scope, a
  // selection, or a source the server cannot aggregate fall back to the loaded rows.
  const sourceTable = Boolean(table?.data_source_id);
  const scoped = Boolean(searchQuery)
    || Object.values(selectFilters ?? {}).some((values) => values.length > 0)
    || Object.values(dateFilters ?? {}).some((range) => range?.from || range?.to);
  const serverTableSummary = useTableSummary({
    tableId: table?.id, columns: columnsRaw, searchQuery, searchColumns, selectFilters, dateFilters,
    unsupported: sourceTable && scoped,
  });
  const serverSelectionSummary = useTableSummary({
    tableId: table?.id, columns: columnsRaw, rowIds: Array.from(selectedRowIds),
    enabled: selectedRowIds.size > 0, unsupported: sourceTable,
  });
  const tableSummary = useMemo<TableSummaryState>(() => (sourceTable && (scoped || serverTableSummary.status === 'unavailable')
    ? { status: 'ready', scope: 'loaded', data: summarizeRows(columnsRaw, rows) }
    : serverTableSummary), [sourceTable, scoped, columnsRaw, rows, serverTableSummary]);
  const selectionSummary = useMemo<TableSummaryState>(() => (sourceTable
    ? { status: 'ready', scope: 'loaded', data: summarizeRows(columnsRaw, rows.filter((row) => selectedRowIds.has(row.id))) }
    : serverSelectionSummary), [sourceTable, columnsRaw, rows, selectedRowIds, serverSelectionSummary]);

  // Fetch space data for tickets_config (auto-routing)
  const { data: spaceData } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: () => apiClient.get<{ data: { tickets_config?: { tableId?: number } } }>(`/spaces/${spaceId}`),
    enabled: !!spaceId,
    staleTime: 60000,
  });
  const ticketsTableId = useMemo(() => {
    const space = spaceData as { data?: { tickets_config?: { tableId?: number } } } | undefined;
    return space?.data?.tickets_config?.tableId ?? null;
  }, [spaceData]);

  const [relatedRowModal, setRelatedRowModal] = useState<{
    isOpen: boolean;
    tableId: string;
    rowId: string;
    valueColumn?: string;
  }>({ isOpen: false, tableId: '', rowId: '' });

  const [nestedTableModal, setNestedTableModal] = useState<{
    isOpen: boolean;
    tableId: string;
    filterColumn: string;
    filterValue: string;
    config?: ColumnConfig;
    parentLabel?: string;
  }>({
    isOpen: false,
    tableId: '',
    filterColumn: '',
    filterValue: '',
  });

  // Inline expanded tables state
  const [expandedInlineTables, setExpandedInlineTables] = useState<
    Record<string, { tableId: string; filterColumn: string; filterValue: string; columnId: string }>
  >({});

  // Handler for triggering automation from ButtonCell
  const handleAutomationTrigger = useCallback(async (automationId: string, rowId: string, rowData: Record<string, unknown>) => {
    await apiClient.post(`/automations/${automationId}/execute`, {
      rowId: parseInt(rowId),
      rowData,
      project_id: table?.projectId
    });
  }, [table?.projectId]);

  const handleOpenNestedTable = useCallback((
    tableId: string,
    filterColumn: string,
    filterValue: string,
    config?: ColumnConfig
  ) => {
    setNestedTableModal({ isOpen: true, tableId, filterColumn, filterValue, config });
  }, []);

  const handleToggleInlineTable = useCallback((
    rowId: string,
    columnId: string,
    tableId: string,
    filterColumn: string,
    filterValue: string
  ) => {
    setExpandedInlineTables(prev => {
      if (prev[rowId]) {
        const { [rowId]: removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [rowId]: { tableId, filterColumn, filterValue, columnId } };
    });
  }, []);

  const realColumns = columnsRaw as ColumnModel[];
  // System columns live in localStorage; bump to rebuild them after a settings save.
  const [systemColumnsVersion, bumpSystemColumns] = useReducer((n: number) => n + 1, 0);
  const columns = useMemo(
    () => [
      ...realColumns,
      ...buildSystemColumns({ tableId: table?.id, createdLabel: t('systemColumns.created'), updatedLabel: t('systemColumns.updated') }),
    ],
    [realColumns, table?.id, t, systemColumnsVersion]
  );
  const rowMutation = useRowMutations(table?.id ?? null as any);
  const { visibilityMutation, widthMutation, settingsMutation, reorderMutation } = useColumnMutations(table?.id ?? null as any);
  const queryClient = useQueryClient();

  // Row IDs for selection
  const filteredRowIds = useMemo(() => rows.map(r => r.id), [rows]);
  const allRowIds = useMemo(() => allRows.map(r => r.id), [allRows]);

  // Sort rows based on selection
  const sortedRows = useMemo(() => {
    return sortRowsWithSelection(rows, selectionSort, selectedRowIds);
  }, [rows, selectionSort, selectedRowIds]);

  // Every row of the table in the current sort order (print, "all rows" replace) —
  // the view only holds the loaded window.
  const fetchAllRows = useCallback(() => {
    const sort = effectiveSorting[0];
    return fetchAllTableRows(tableIdStr, {
      rawMode,
      sortColumn: sort?.id ?? null,
      sortDirection: sort ? (sort.desc ? 'desc' : 'asc') : null,
    });
  }, [tableIdStr, rawMode, effectiveSorting]);

  // Bulk replace hook
  const { executeBulkReplace, isProcessing: isBulkReplacing } = useBulkReplace({
    tableId: table?.id ?? null as any,
    columns,
    rows: rows as any,
    selectedRowIds,
    filteredRowIds,
    fetchAllRows
  });

  const createColumnMutation = useMutation({
    mutationFn: async (data: { name: string; displayName: string; type: string; config?: Record<string, unknown> }) => {
      if (!table?.id || !canManageColumns) throw new Error('Column creation is not allowed');
      const { tablesApi } = await import('../../api/tablesApi');
      const created: { id: string | number } = await tablesApi.createColumn(String(table.id), data);
      if (!columnInsertAt) return true;
      const ordered = [...realColumns].sort((a, b) => a.orderIndex - b.orderIndex);
      const anchor = ordered.findIndex(col => col.id === columnInsertAt.id);
      if (anchor === -1) return false;
      const ids = ordered.map(col => col.id);
      ids.splice(anchor + (columnInsertAt.side === 'right' ? 1 : 0), 0, String(created.id));
      const results = await Promise.allSettled(ids.map((id, orderIndex) =>
        ordered.find(col => col.id === id)?.orderIndex === orderIndex ? Promise.resolve() :
          tablesApi.updateColumn(String(table.id), id, { orderIndex })));
      return results.every(result => result.status === 'fulfilled');
    },
    onSuccess: (positionSaved) => {
      queryClient.invalidateQueries({ queryKey: ['columns', table?.id] });
      setCreateColumnOpen(false);
      setColumnInsertAt(null);
      setTimeout(() => { showToast(positionSaved ? 'Колонка успешно создана' : 'Колонка создана, но её порядок не сохранён. Обновите таблицу и переместите колонку через меню.', positionSaved ? 'success' : 'error'); }, 0);
    },
    onError: (error: Error) => {
      logger.error('Create column error:', error);
      setTimeout(() => { showToast(`Ошибка создания колонки: ${error.message}`, 'error'); }, 0);
    }
  });

  const [activeColumn, setActiveColumn] = useState<ColumnModel | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const deleteColumnMutation = useMutation({
    mutationFn: async (columnId: string) => {
      if (!table?.id) throw new Error('No table selected');
      const { tablesApi } = await import('../../api/tablesApi');
      return tablesApi.deleteColumn(String(table.id), columnId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['columns', table?.id] });
      setInspectorOpen(false);
      setActiveColumn(null);
      setTimeout(() => { showToast('Колонка успешно удалена', 'success'); }, 0);
    },
    onError: (error: Error) => {
      logger.error('Delete column error:', error);
      setTimeout(() => { showToast(`Ошибка удаления колонки: ${error.message}`, 'error'); }, 0);
    }
  });

  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const contextUserId = useTablesStore((state) => state.contextUserId);
  const tableRole = useTablesStore((state) => table?.id ? state.tableRoles[String(table.id)] : 'owner');
  const isReadOnlyContext =
    contextUserId !== null && Number(contextUserId) !== Number(viewerId ?? null);

  const canEditColumnSettings = tableRole === 'owner' || tableRole === 'admin';
  const publicReadOnly = useIsPublicReadOnly();
  const canManageColumns = canEditColumnSettings && !isReadOnlyContext && !readOnly && !publicReadOnly;
  const canEditCells = tableRole !== 'viewer';
  const isViewerRole = tableRole === 'viewer';

  // --- Row actions (extracted hook) ---
  const rowActions = useTableRowActions({
    table,
    columns,
    columnsRaw,
    rows,
    isReadOnlyContext,
    isViewerRole,
    ticketsTableId,
    setDuplicateModalOpen,
    setRowToDuplicate,
    setEditModalOpen,
    setRowToEdit,
    setDeleteConfirmOpen,
    selectedRowIds,
    clearSelection,
    rowToEdit,
  });

  const handleOpenColumnSettings = useCallback(
    (columnId: string) => {
      const columnToEdit = columns.find((col: ColumnModel) => col.id === columnId) ?? null;
      if (isReadOnlyContext || !canEditColumnSettings) return;
      setActiveColumn(columnToEdit);
      setInspectorOpen(Boolean(columnToEdit));
    },
    [columns, isReadOnlyContext, canEditColumnSettings]
  );

  useOpenColumnSettingsListener(table?.id, handleOpenColumnSettings);

  const getColumnSize = (column: ColumnModel) => {
    if (column.width) return column.width;
    return getDefaultColumnSize(column);
  };

  const handleColumnReorder = useCallback(async (columnId: string, newIndex: number) => {
    if (!canManageColumns || isSystemColumnId(columnId)) return; // system columns are fixed at the tail
    const sortedColumns = columns.filter(col => !isSystemColumnId(col.id)).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    const oldIndex = sortedColumns.findIndex(col => col.id === columnId);
    if (oldIndex === -1 || oldIndex === newIndex) return;
    const movedColumn = sortedColumns[oldIndex];
    sortedColumns.splice(oldIndex, 1);
    sortedColumns.splice(newIndex, 0, movedColumn);
    const results = await Promise.allSettled(sortedColumns.map((col, idx) =>
      col.orderIndex === idx ? Promise.resolve() : reorderMutation.mutateAsync({ columnId: col.id, newIndex: idx })));
    if (results.some(result => result.status === 'rejected')) showToast('Не удалось сохранить порядок колонок. Обновите таблицу и повторите перемещение.', 'error');
  }, [columns, canManageColumns, reorderMutation]);

  // Column-menu shortcuts (mirror the toolbar / settings drawer; same type rules as TableFilters)
  const handleHideColumn = useCallback((columnId: string) => {
    if (!canManageColumns || (table as TableModel)?.data_source_id) return;
    setColumnVisibility((prev) => ({ ...prev, [columnId]: false }));
    if (isSystemColumnId(columnId)) { setSystemColumnVisibility(table?.id, columnId, false); return; }
    visibilityMutation.mutate({ columnId, isVisible: false });
  }, [canManageColumns, table, visibilityMutation]);

  const handleToggleColumnLock = useCallback((column: ColumnModel) => {
    if (!canManageColumns || isSystemColumnId(column.id)) return;
    settingsMutation.mutate({ columnId: column.id, payload: { isReadonly: !column.isReadonly } });
  }, [canManageColumns, settingsMutation]);

  const handleDeleteColumn = useCallback((column: ColumnModel) => {
    if (!canManageColumns || isSystemColumnId(column.id) || column.is_locked || column.is_from_source) return;
    if (!window.confirm(t('columnHeader.deleteConfirm', { column: column.displayName || column.name }))) return;
    deleteColumnMutation.mutate(column.id);
  }, [canManageColumns, deleteColumnMutation, t]);

  // Primitive so a fresh `[]` default for searchColumns does not invalidate columnDefs each render
  const scopedSearchColumnId = searchColumns.length === 1 ? searchColumns[0] : null;

  const columnDefs = useMemo<ColumnDef<RowModel, unknown>[]>(
    () => {
      const defs: ColumnDef<RowModel, unknown>[] = [];

      if (rawMode) {
        defs.push({
          id: '__base_id',
          header: () => (<div className="text-xs font-mono text-[var(--text-tertiary)]">base_id</div>),
          accessorFn: (row) => row.base_id || row.id,
          size: 100, minSize: 80, maxSize: 150,
          cell: (ctx) => (<div className="text-xs font-mono text-[var(--text-tertiary)] select-all">{ctx.getValue() as string}</div>),
          enableResizing: true, enableSorting: true
        });
        defs.push({
          id: '__row_id',
          header: () => (<div className="text-xs font-mono text-[var(--text-tertiary)]">row_id</div>),
          accessorFn: (row) => row.id,
          size: 80, minSize: 60, maxSize: 120,
          cell: (ctx) => (<div className="text-xs font-mono text-primary-400 select-all font-semibold">{ctx.getValue() as string}</div>),
          enableResizing: true, enableSorting: true
        });
      }

      const ordered = columns.filter(col => !isSystemColumnId(col.id)).sort((a, b) => a.orderIndex - b.orderIndex);
      const visible = ordered.filter(col => columnVisibility[col.id] !== false && col.isVisible && col.id !== groupByColumn);
      columns.forEach((column: ColumnModel) => {
        const visibleIndex = visible.findIndex(col => col.id === column.id);
        const left = visible[visibleIndex - 1];
        const right = visibleIndex >= 0 ? visible[visibleIndex + 1] : undefined;
        const isSys = isSystemColumnId(column.id);
        const isSearchScoped = scopedSearchColumnId === column.id;
        const isGrouped = groupByColumn === column.id;
        const sizeConfig = getColumnMinMaxSize(column);
        defs.push({
          id: column.id,
          header: UniversalTableHeader,
          accessorFn: (row) => {
            const sysField = getSystemColumnRowField(column.id);
            if (sysField) {
              const r = row as unknown as Record<string, unknown>;
              return r[sysField] ?? r[sysField === 'created_at' ? 'createdAt' : 'updatedAt'] ?? '';
            }
            return row.data[column.id] !== undefined ? row.data[column.id] : row.data[column.name];
          },
          size: getColumnSize(column),
          minSize: sizeConfig.minSize,
          maxSize: sizeConfig.maxSize,
          cell: UniversalTableCell,
          meta: { render: (ctx: CellContext<RowModel, unknown>) => {
            const rowId = ctx.row.original.id;
            const isInlineExpanded = expandedInlineTables[rowId]?.columnId === column.id;
            const rowDataWithId = { ...ctx.row.original.data, id: rowId, row_id: rowId };
            return renderCellValue({
              column,
              columns,
              value: ctx.getValue(),
              rowId,
              rowData: rowDataWithId,
              rawMode,
              isInlineExpanded,
              onOpenNestedTable: handleOpenNestedTable,
              onToggleInlineExpand: (tblId, filterColumn, filterValue) =>
                handleToggleInlineTable(rowId, column.id, tblId, filterColumn, filterValue),
              onNavigateToRow: (tblId, rowIdToOpen, valueColumn) => {
                setRelatedRowModal({ isOpen: true, tableId: tblId, rowId: rowIdToOpen, valueColumn });
              },
              onAutomationTrigger: handleAutomationTrigger,
              rowMutation,
              rows,
              tableId: table?.id,
              relations
            });
          },
          renderHeader: ({ column: tableColumn }: HeaderContext<RowModel, unknown>) => (
            <ColumnHeader
              column={column}
              onOpenSettings={() => handleOpenColumnSettings(column.id)}
              sortDirection={tableColumn.getIsSorted()}
              onSort={() => tableColumn.toggleSorting()}
              rawMode={rawMode}
              disableSettings={!canManageColumns}
              onMoveLeft={!isSys && left ? () => { void handleColumnReorder(column.id, ordered.indexOf(left)); } : undefined}
              onMoveRight={!isSys && right ? () => { void handleColumnReorder(column.id, ordered.indexOf(right)); } : undefined}
              onAddColumn={isSys ? undefined : (side) => {
                setColumnInsertAt({ id: column.id, side });
                setCreateColumnOpen(true);
              }}
              onHide={() => handleHideColumn(column.id)}
              onSearchHere={onSearchColumnsChange && !isSys && isSearchableColumn(column)
                ? () => onSearchColumnsChange(isSearchScoped ? [] : [column.id])
                : undefined}
              isSearchScoped={isSearchScoped}
              onGroupBy={onGroupByColumnChange && !isSys && isGroupableColumn(column)
                ? () => onGroupByColumnChange(isGrouped ? null : column.id)
                : undefined}
              isGrouped={isGrouped}
              onToggleLock={isSys ? undefined : () => handleToggleColumnLock(column)}
              onDelete={isSys || column.is_locked || column.is_from_source ? undefined : () => handleDeleteColumn(column)}
            />
          ) } satisfies UniversalCellMeta,
          enableResizing: true,
          enableSorting: true,
          sortingFn: column.type === 'number' ? 'alphanumeric'
            // ADR-0035-A: an address sorts alphabetically by its stored `formatted` line (client-side sort only).
            : column.type === 'address' ? (a, b, id) => addressSortKey(a.getValue(id)).localeCompare(addressSortKey(b.getValue(id)))
            : 'auto'
        });
      });

      return defs;
    },
    [columns, columnVisibility, groupByColumn, scopedSearchColumnId, onSearchColumnsChange, onGroupByColumnChange, canManageColumns, handleColumnReorder, handleOpenColumnSettings, handleHideColumn, handleToggleColumnLock, handleDeleteColumn, rawMode, handleOpenNestedTable, expandedInlineTables, handleToggleInlineTable, rowMutation, rows, relations]
  );

  const data = useMemo(() => [...rows], [rows, rowsVersion]);

  // Initialize column visibility and sizing
  const columnsInitialized = useRef(false);
  const prevColumnIds = useRef<string[]>([]);
  const prevTableId = useRef<string | null>(null);

  useEffect(() => {
    if (columns.length === 0) return;
    const currentTableId = table?.id != null ? String(table.id) : null;
    const currentColumnIds = columns.map((c: ColumnModel) => c.id).sort().join(',');
    const prevIds = prevColumnIds.current.sort().join(',');
    if (currentTableId !== prevTableId.current) {
      columnsInitialized.current = false;
      prevTableId.current = currentTableId;
    }
    const columnListChanged = currentColumnIds !== prevIds;
    if (!columnsInitialized.current || columnListChanged) {
      const initialVisibility: VisibilityState = {};
      const initialSizing: ColumnSizingState = {};
      columns.forEach((column: ColumnModel) => {
        initialVisibility[column.id] = column.isVisible !== false;
        initialSizing[column.id] = getColumnSize(column);
      });
      setColumnVisibility(initialVisibility);
      setColumnSizing(initialSizing);
      prevColumnSizing.current = initialSizing;
      columnsInitialized.current = true;
      prevColumnIds.current = columns.map((c: ColumnModel) => c.id);
    }
  }, [columns, table?.id]);

  const handleSortingChange = useCallback((updater: SortingState | ((old: SortingState) => SortingState)) => {
    const newSorting = typeof updater === 'function' ? updater(effectiveSorting) : updater;
    if (useServerSorting) {
      if (newSorting.length > 0) {
        const { id, desc } = newSorting[0];
        setStoreSorting(id, desc ? 'desc' : 'asc');
      } else {
        setStoreSorting(null, null);
      }
    } else {
      setLocalSorting(newSorting);
    }
  }, [useServerSorting, effectiveSorting, setStoreSorting]);

  const tableInstance = useReactTable({
    data,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
    state: { columnVisibility, columnSizing, sorting: effectiveSorting },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onSortingChange: handleSortingChange,
    columnResizeMode: 'onChange',
    // Keep loaded rows in saved order immediately after optimistic status edits.
    manualSorting: useServerSorting && !defaultSort,
    meta: { rowsVersion }
  });

  // Track actual resize operations
  const hasUserResized = useRef(false);

  useEffect(() => {
    if (!table) return;
    if ((table as TableModel).type === 'system') return;
    const isResizing = tableInstance.getState().columnSizingInfo.isResizingColumn;
    if (isResizing) { hasUserResized.current = true; }
    if (!hasUserResized.current || isResizing || isReadOnlyContext) return;
    Object.entries(columnSizing).forEach(([columnId, size]) => {
      const previous = prevColumnSizing.current[columnId];
      if (previous !== undefined && previous !== size && typeof size === 'number') {
        if (isSystemColumnId(columnId)) setSystemColumnOverride(table?.id, columnId, { width: size });
        else widthMutation.mutate({ columnId, width: size });
      }
    });
    prevColumnSizing.current = columnSizing;
  }, [columnSizing, table, tableInstance, widthMutation, isReadOnlyContext]);

  const handleAddColumn = useCallback(() => { if (!canManageColumns) return; setColumnInsertAt(null); setCreateColumnOpen(true); }, [canManageColumns]);

  const handleColumnVisibilityChange = (visibleIds: string[]) => {
    if (isReadOnlyContext || (table as TableModel)?.type === 'system' || (table as TableModel)?.data_source_id) return;
    const nextVisibility: VisibilityState = {};
    const visibleSet = new Set(visibleIds);
    columns.forEach((column: ColumnModel) => {
      const isVisible = visibleSet.has(column.id);
      nextVisibility[column.id] = isVisible;
      if (column.isVisible !== isVisible) {
        if (isSystemColumnId(column.id)) {
          setSystemColumnVisibility(table?.id, column.id, isVisible);
        } else {
          visibilityMutation.mutate({ columnId: column.id, isVisible });
        }
      }
    });
    setColumnVisibility(nextVisibility);
  };

  const handleToggleVisibility = (columnId: string, isVisible: boolean) => {
    if (isReadOnlyContext || (table as TableModel)?.data_source_id) return;
    setColumnVisibility((prev) => ({ ...prev, [columnId]: isVisible }));
    if (isSystemColumnId(columnId)) { setSystemColumnVisibility(table?.id, columnId, isVisible); return; }
    visibilityMutation.mutate({ columnId, isVisible });
  };

  const handleWidthChange = (columnId: string, width: number) => {
    if (isReadOnlyContext || (table as TableModel)?.data_source_id) return;
    setColumnSizing((prev) => ({ ...prev, [columnId]: width }));
    prevColumnSizing.current = { ...prevColumnSizing.current, [columnId]: width };
    if (isSystemColumnId(columnId)) { setSystemColumnOverride(table?.id, columnId, { width }); return; }
    widthMutation.mutate({ columnId, width });
  };

  const {
    editingCell, draftValue, setDraftValue, handleCellClick, handleCellDoubleClick,
    handleCommitEdit, handleCancelEdit, handleCheckboxToggle, handleNumberStep,
  } = useTableCellActions({ table, columns, rows, rowMutation, isReadOnlyContext, isViewerRole, onLocalCellUpdate });

  const visibleColumnIds = Object.entries(columnVisibility)
    .filter(([, isVisible]) => isVisible !== false)
    .map(([columnId]) => columnId);

  const hiddenColumns = useMemo(() =>
    columns.filter((col: ColumnModel) => columnVisibility[col.id] === false),
    [columns, columnVisibility]
  );

  const handleShowColumn = useCallback((columnId: string) => {
    setColumnVisibility((prev) => ({ ...prev, [columnId]: true }));
    if (isSystemColumnId(columnId)) { setSystemColumnVisibility(table?.id, columnId, true); return; }
    visibilityMutation.mutate({ columnId, isVisible: true });
    const visibleColumns = columns.filter((col: ColumnModel) => columnVisibility[col.id] !== false && col.id !== columnId);
    const maxOrderIndex = Math.max(...visibleColumns.map((col: ColumnModel) => col.orderIndex ?? 0), 0);
    reorderMutation.mutate({ columnId, newIndex: maxOrderIndex + 1 });
  }, [columns, columnVisibility, visibilityMutation, reorderMutation, table?.id]);

  const handleSaveColumnSettings = (columnId: string, payload: Partial<ColumnModel>) => {
    if (isReadOnlyContext) return;
    if (payload.isVisible !== undefined) {
      setColumnVisibility((prev) => ({ ...prev, [columnId]: payload.isVisible !== false }));
    }
    if (isSystemColumnId(columnId)) {
      // No backend row: presentation persists in localStorage; key, type and read-only stay fixed.
      const { displayName, width, config, isVisible } = payload;
      setSystemColumnOverride(table?.id, columnId, { displayName, width, config, isVisible });
      if (typeof width === 'number') {
        setColumnSizing((prev) => ({ ...prev, [columnId]: width }));
        prevColumnSizing.current = { ...prevColumnSizing.current, [columnId]: width };
      }
      bumpSystemColumns();
      setInspectorOpen(false); setActiveColumn(null);
      return;
    }
    settingsMutation.mutate({ columnId, payload }, { onSuccess: () => { setInspectorOpen(false); setActiveColumn(null); } });
  };

  const handleLoadMore = () => {
    if (isLoadingMore) return;
    const pageQueries = queryClient.getQueryCache().findAll({ queryKey: ['rows', tableIdStr, currentPage] });
    if (pageQueries.some(query => query.state.fetchStatus === 'fetching')) return;
    if (pageQueries.some(query => query.state.status === 'error')) {
      void queryClient.refetchQueries({ queryKey: ['rows', tableIdStr, currentPage], type: 'active' });
      return;
    }
    if (currentPage < totalPages) { setCurrentPage(currentPage + 1); }
  };

  const handleLoadPrevious = () => {
    if (currentPage > 1) { setCurrentPage(currentPage - 1); }
  };

  const handleRowsLimitChange = (limit: number) => { setRowsLimit(limit); };

  // Get total rows from store
  const totalRows = useTablesStore((state) => state.totalRows[tableIdStr] ?? 0);
  const minLoadedPage = useTablesStore((state) => state.minLoadedPage);
  const rowsAbove = (minLoadedPage - 1) * rowsLimit;
  // Rows after the loaded window: the window may start on a later page (?page=N / go-to-row).
  const rowsBelow = Math.max(0, totalRows - rowsAbove - allRows.length);
  const canLoadMore = rowsBelow > 0;
  const canLoadPrevious = rowsAbove > 0;

  // Report pagination info to parent
  useEffect(() => {
    onPaginationChange?.({
      rowsCount: rows.length, rowsLimit, currentPage, totalPages, totalRows, canLoadMore, minLoadedPage
    });
  }, [rows.length, rowsLimit, currentPage, totalPages, totalRows, canLoadMore, minLoadedPage, onPaginationChange]);

  useEffect(() => {
    if (onLoadMore) {
      (window as any).__tableLoadMore = handleLoadMore;
      (window as any).__tableLoadPrevious = handleLoadPrevious;
    }
    return () => {
      delete (window as any).__tableLoadMore;
      delete (window as any).__tableLoadPrevious;
    };
  }, [handleLoadMore, handleLoadPrevious, onLoadMore]);

  return {
    table, columns, columnsRaw, rows, allRows, sortedRows, rowsVersion,
    tableSummary, selectionSummary, relations,
    tableInstance, columnDefs,
    editingCell, draftValue, setDraftValue, columnVisibility, columnSizing,
    createColumnOpen, setCreateColumnOpen,
    duplicateModalOpen, setDuplicateModalOpen, rowToDuplicate, setRowToDuplicate,
    editModalOpen, setEditModalOpen, rowToEdit, setRowToEdit,
    deleteConfirmOpen, setDeleteConfirmOpen,
    relatedRowModal, setRelatedRowModal,
    nestedTableModal, setNestedTableModal,
    expandedInlineTables,
    activeColumn, inspectorOpen, setInspectorOpen, setActiveColumn,
    currentPage, rowsLimit, totalPages, totalRowsCount, totalRows,
    isLoadingMore, canLoadMore, canLoadPrevious, rowsAbove, rowsBelow,
    exportModalOpen, setExportModalOpen, importModalOpen, setImportModalOpen,
    bulkReplaceModalOpen, setBulkReplaceModalOpen, executeBulkReplace, isBulkReplacing,
    printModalOpen, setPrintModalOpen,
    selectedRowIds, selectionSort, toggleRowSelection, selectAll, selectAllFiltered,
    clearSelection, setSelectionSort, getSelectedCount, isRowSelected, isAllSelected, isIndeterminate,
    filteredRowIds, allRowIds,
    rowMutation, createColumnMutation, deleteColumnMutation, settingsMutation, widthMutation, visibilityMutation, reorderMutation,
    handleCellClick, handleCellDoubleClick, handleCommitEdit, handleCancelEdit,
    handleCheckboxToggle, handleNumberStep, handleAddColumn,
    handleSaveColumnSettings, handleColumnVisibilityChange, handleToggleVisibility,
    handleWidthChange, handleColumnReorder, handleShowColumn, handleOpenColumnSettings,
    handleLoadMore, handleLoadPrevious, handleRowsLimitChange, fetchAllRows,
    handleOpenNestedTable, handleToggleInlineTable, handleAutomationTrigger,
    // Row actions from extracted hook
    ...rowActions,
    isReadOnlyContext, isViewerRole, canEditColumnSettings, canEditCells,
    hiddenColumns, visibleColumnIds,
    rawMode, readOnly, compact, disableNestedModals, spaceId, spaceName, projectName,
    addRowModalOpen, onCloseAddRowModal, groupByColumn,
  };
};
