import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { ColumnDef, ColumnSizingState, SortingState, VisibilityState, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/shared/hooks/useToast';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { getColumnMinMaxSize, getDefaultColumnSize } from '../../utils/columnSizing';
import { ColumnHeader } from './ColumnHeader';
import { useActiveTable } from '../../hooks/useTable';
import { useColumnConfig } from '../../hooks/useColumnConfig';
import { useOpenColumnSettingsListener } from './useOpenColumnSettingsListener';
import { useTableData } from '../../hooks/useTableData';
import { useRowMutations, getPendingValue } from '../../hooks/useRowMutations';
import { useColumnMutations } from '../../hooks/useColumnMutations';
import { useRowSelection } from '../../hooks/useRowSelection';
import { useBulkReplace } from '../../hooks/useBulkReplace';
import { sortRowsWithSelection } from '../../utils/bulkReplaceUtils';
import type { ColumnModel, RowModel, ColumnConfig, TableModel } from '../../types/table.types';
import { useAuthStore } from '@/features/auth/store/authStore';
import { apiClient } from '@/shared/utils/apiClient';
import { useTablesStore } from '../../store/tablesStore';
import { renderCellValue, parseMultiSelectValue } from './renderCellValue';
import { useTableRowActions } from './useTableRowActions';
import {
  buildSystemColumns,
  getSystemColumnRowField,
  isSystemColumnId,
  setSystemColumnVisibility,
} from '../../utils/systemColumns';
import type { UniversalTableProps } from './types';

export const useUniversalTableState = ({
  table: externalTable,
  columns: externalColumns,
  rows: externalRows,
  searchQuery = '',
  searchColumns = [],
  selectFilters = {},
  dateFilters = {},
  groupByColumn = null,
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
  showSummaryBar = false,
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

  // Filter rows based on search query and filters
  const rows = useMemo(() => {
    const columnIdToName = columnsRaw.reduce((acc, col) => {
      acc[col.id] = col.name;
      return acc;
    }, {} as Record<string, string>);

    let filtered = allRows;

    // Apply search filter
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      filtered = filtered.filter(row => {
        if (searchColumns.length > 0) {
          return searchColumns.some(columnId => {
            const value = row.data[columnId] ?? row.data[columnIdToName[columnId]];
            return String(value ?? '').toLowerCase().includes(searchLower);
          });
        }
        return Object.values(row.data).some(value =>
          String(value).toLowerCase().includes(searchLower)
        );
      });
    }

    // Apply select filters
    const activeSelectFilters = Object.entries(selectFilters).filter(([_, values]) => values.length > 0);
    if (activeSelectFilters.length > 0) {
      filtered = filtered.filter(row => {
        return activeSelectFilters.every(([columnId, selectedValues]) => {
          const cellValue = row.data[columnId] ?? row.data[columnIdToName[columnId]];
          const parsedValues = parseMultiSelectValue(cellValue);
          return parsedValues.some(v => selectedValues.includes(v));
        });
      });
    }

    // Apply date filters
    const activeDateFilters = Object.entries(dateFilters).filter(([_, range]) => range.from || range.to);
    if (activeDateFilters.length > 0) {
      filtered = filtered.filter(row => {
        return activeDateFilters.every(([columnId, range]) => {
          const cellValue = row.data[columnId] ?? row.data[columnIdToName[columnId]];
          if (!cellValue) return false;

          const cellDate = new Date(String(cellValue));
          if (isNaN(cellDate.getTime())) return false;

          if (range.from) {
            const fromDate = new Date(range.from);
            if (cellDate < fromDate) return false;
          }

          if (range.to) {
            const toDate = new Date(range.to);
            toDate.setHours(23, 59, 59, 999);
            if (cellDate > toDate) return false;
          }

          return true;
        });
      });
    }

    return filtered;
  }, [allRows, searchQuery, searchColumns, selectFilters, dateFilters, rowsVersion]);
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
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [localSorting, setLocalSorting] = useState<SortingState>([]);

  const effectiveSorting = useMemo(() => {
    if (useServerSorting && storeSortColumn && storeSortDirection) {
      return [{ id: storeSortColumn, desc: storeSortDirection === 'desc' }];
    }
    return localSorting;
  }, [useServerSorting, storeSortColumn, storeSortDirection, localSorting]);

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
  const columns = useMemo(
    () => [
      ...realColumns,
      ...buildSystemColumns({ tableId: table?.id, createdLabel: t('systemColumns.created'), updatedLabel: t('systemColumns.updated') }),
    ],
    [realColumns, table?.id, t]
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

  // Bulk replace hook
  const { executeBulkReplace, isProcessing: isBulkReplacing } = useBulkReplace({
    tableId: table?.id ?? null as any,
    columns,
    rows: rows as any,
    selectedRowIds,
    filteredRowIds,
    allRowIds
  });

  const createColumnMutation = useMutation({
    mutationFn: async (data: { name: string; displayName: string; type: string; config?: Record<string, any> }) => {
      if (!table?.id) throw new Error('No table selected');
      const { tablesApi } = await import('../../api/tablesApi');
      return tablesApi.createColumn(String(table.id), data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['columns', table?.id] });
      setCreateColumnOpen(false);
      setTimeout(() => { showToast('Колонка успешно создана', 'success'); }, 0);
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

      columns.forEach((column: ColumnModel) => {
        const isSys = isSystemColumnId(column.id);
        const sizeConfig = isSys
          ? { minSize: 110, maxSize: 110 }
          : getColumnMinMaxSize(column);
        defs.push({
          id: column.id,
          header: ({ column: tableColumn }) => (
            <ColumnHeader
              column={column}
              onOpenSettings={() => handleOpenColumnSettings(column.id)}
              sortDirection={tableColumn.getIsSorted()}
              onSort={() => tableColumn.toggleSorting()}
              rawMode={rawMode}
              disableSettings={!canEditColumnSettings}
            />
          ),
          accessorFn: (row) => {
            const sysField = getSystemColumnRowField(column.id);
            if (sysField) {
              const r = row as unknown as Record<string, unknown>;
              return r[sysField] ?? r[sysField === 'created_at' ? 'createdAt' : 'updatedAt'] ?? '';
            }
            return row.data[column.id] !== undefined ? row.data[column.id] : row.data[column.name];
          },
          size: isSys ? 110 : getColumnSize(column),
          minSize: sizeConfig.minSize,
          maxSize: sizeConfig.maxSize,
          cell: (ctx) => {
            const rowId = ctx.row.original.id;
            const isInlineExpanded = expandedInlineTables[rowId]?.columnId === column.id;
            const rowDataWithId = { ...ctx.row.original.data, id: rowId, row_id: rowId };
            return renderCellValue({
              column,
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
              tableId: table?.id
            });
          },
          enableResizing: !isSys,
          enableSorting: true,
          sortingFn: column.type === 'number' ? 'alphanumeric' : 'auto'
        });
      });

      return defs;
    },
    [columns, handleOpenColumnSettings, rawMode, handleOpenNestedTable, expandedInlineTables, handleToggleInlineTable, rowMutation, rows]
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
    const currentSorting = useServerSorting ? effectiveSorting : localSorting;
    const newSorting = typeof updater === 'function' ? updater(currentSorting) : updater;
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
  }, [useServerSorting, effectiveSorting, localSorting, setStoreSorting]);

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
    manualSorting: useServerSorting,
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
        widthMutation.mutate({ columnId, width: size });
      }
    });
    prevColumnSizing.current = columnSizing;
  }, [columnSizing, table, tableInstance, widthMutation, isReadOnlyContext]);

  const handleCellClick = useCallback((value: unknown, columnId: string, event?: React.MouseEvent) => {
    if (!event?.ctrlKey && !event?.metaKey) return;
    const column = columns.find((col: ColumnModel) => col.id === columnId);
    if (column?.type === 'password') return;
    if (column?.config?.copyable === false) return;
    const textValue = value == null ? '' : String(value);
    if (!textValue || textValue === '—' || textValue === '🔓 Not set') return;
    navigator.clipboard.writeText(textValue).then(() => {
      setTimeout(() => showToast('Copied to clipboard', 'success'), 0);
    }).catch(() => {
      setTimeout(() => showToast('Failed to copy', 'error'), 0);
    });
  }, [columns]);

  const handleAddColumn = useCallback(() => { setCreateColumnOpen(true); }, []);

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
    if (isSystemColumnId(columnId)) return; // no backend row to update
    widthMutation.mutate({ columnId, width });
  };

  const handleCellDoubleClick = (rowId: string, columnId: string, initialValue: unknown) => {
    if (isReadOnlyContext || isViewerRole) return;
    const column = columns.find((col: ColumnModel) => col.id === columnId);
    if (!column) return;
    if (column.name.toLowerCase() === 'id') return;
    if ((column as any).is_external) return;
    if (column.isReadonly) return;
    if ((column as any)._readonly) return;
    setEditingCell({ rowId, columnId });
    // ADR-0017: JSON columns may store object/array directly — preserve via JSON.stringify
    setDraftValue(column.type === 'json' && initialValue && typeof initialValue === 'object' ? JSON.stringify(initialValue, null, 2) : (initialValue ? String(initialValue) : ''));
  };

  const isCommittingRef = useRef(false);

  const handleCommitEdit = (valueOverride?: string) => {
    if (isCommittingRef.current) {
      logger.debug('[UniversalTable] handleCommitEdit - already committing, skipping');
      return;
    }
    const finalValue = valueOverride !== undefined ? valueOverride : draftValue;
    if (!table || !editingCell || isReadOnlyContext) return;
    const row = rows.find((item) => item.id === editingCell.rowId);
    if (!row) return;
    isCommittingRef.current = true;
    const nextData = { ...row.data, [editingCell.columnId]: finalValue };
    rowMutation.mutate({ rowId: editingCell.rowId, columnId: editingCell.columnId, value: finalValue, data: nextData });
    setEditingCell(null);
    setTimeout(() => { isCommittingRef.current = false; }, 100);
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
    setDraftValue('');
  };

  const handleCheckboxToggle = useCallback((
    rowId: string, columnId: string, currentValue: unknown,
    config?: { trueValue?: unknown; falseValue?: unknown }
  ) => {
    if (isReadOnlyContext || isViewerRole || !table) return;
    const trueValue = config?.trueValue ?? 1;
    const falseValue = config?.falseValue ?? 0;
    const isChecked = currentValue === trueValue || currentValue === true || currentValue === 1 || currentValue === '1' || currentValue === 'true' || String(currentValue) === String(trueValue);
    const newValue = isChecked ? falseValue : trueValue;
    const row = rows.find((item) => item.id === rowId);
    if (!row) return;
    const nextData = { ...row.data, [columnId]: newValue };
    rowMutation.mutate({ rowId, columnId, value: newValue, data: nextData });
  }, [isReadOnlyContext, isViewerRole, table, rows, rowMutation]);

  const handleNumberStep = useCallback((
    rowId: string, columnId: string, currentValue: unknown, direction: 1 | -1,
    config?: { step?: number; min?: number; max?: number }
  ) => {
    if (isReadOnlyContext || isViewerRole || !table) return;
    const step = config?.step ?? 1;
    const min = config?.min;
    const max = config?.max;
    const currentTableId = String(table.id);

    let freshValue: unknown;
    const pendingVal = getPendingValue(currentTableId, rowId, columnId);
    if (pendingVal !== undefined) {
      freshValue = pendingVal;
    } else {
      const storeRows = useTablesStore.getState().rows[currentTableId] ?? [];
      const storeRow = storeRows.find((r) => String(r.id) === String(rowId));
      if (storeRow?.data?.[columnId] !== undefined) {
        freshValue = storeRow.data[columnId];
      } else {
        freshValue = currentValue;
      }
    }

    const numValue = freshValue === null || freshValue === undefined || freshValue === '' ? 0 : Number(freshValue);
    let newValue = (isNaN(numValue) ? 0 : numValue) + direction * step;
    if (min !== undefined && newValue < min) newValue = min;
    if (max !== undefined && newValue > max) newValue = max;

    if (onLocalCellUpdate) { onLocalCellUpdate(rowId, columnId, newValue); }

    const row = rows.find((item) => String(item.id) === String(rowId));
    if (!row) return;
    const nextData = { ...row.data, [columnId]: newValue };
    rowMutation.mutate({ rowId, columnId, value: newValue, data: nextData });
  }, [isReadOnlyContext, isViewerRole, table, rows, rowMutation, onLocalCellUpdate]);

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

  const handleColumnReorder = useCallback((columnId: string, newIndex: number) => {
    if (isReadOnlyContext || isSystemColumnId(columnId)) return; // system columns are fixed at the tail
    const sortedColumns = [...columns].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    const oldIndex = sortedColumns.findIndex(col => col.id === columnId);
    if (oldIndex === -1 || oldIndex === newIndex) return;
    const movedColumn = sortedColumns[oldIndex];
    sortedColumns.splice(oldIndex, 1);
    sortedColumns.splice(newIndex, 0, movedColumn);
    sortedColumns.forEach((col, idx) => {
      if (isSystemColumnId(col.id) || col.orderIndex === idx) return;
      reorderMutation.mutate({ columnId: col.id, newIndex: idx });
    });
  }, [columns, isReadOnlyContext, reorderMutation]);

  const handleSaveColumnSettings = (columnId: string, payload: Partial<ColumnModel>) => {
    if (isReadOnlyContext) return;
    if (payload.isVisible !== undefined) {
      setColumnVisibility((prev) => ({ ...prev, [columnId]: payload.isVisible !== false }));
    }
    if (isSystemColumnId(columnId)) {
      // System columns have no backend row; only visibility persists (in localStorage).
      if (payload.isVisible !== undefined) setSystemColumnVisibility(table?.id, columnId, payload.isVisible !== false);
      setInspectorOpen(false); setActiveColumn(null);
      return;
    }
    settingsMutation.mutate({ columnId, payload }, { onSuccess: () => { setInspectorOpen(false); setActiveColumn(null); } });
  };

  const handleLoadMore = () => {
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
  const rowsBelow = Math.max(0, totalRows - rows.length);
  const canLoadMore = rowsBelow > 0;
  const canLoadPrevious = rowsAbove > 0;

  // Report pagination info to parent
  useEffect(() => {
    onPaginationChange?.({
      rowsCount: rows.length, rowsLimit, currentPage, totalPages, canLoadMore
    });
  }, [rows.length, rowsLimit, currentPage, totalPages, canLoadMore, onPaginationChange]);

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
    handleLoadMore, handleLoadPrevious, handleRowsLimitChange,
    handleOpenNestedTable, handleToggleInlineTable, handleAutomationTrigger,
    // Row actions from extracted hook
    ...rowActions,
    isReadOnlyContext, isViewerRole, canEditColumnSettings, canEditCells,
    hiddenColumns, visibleColumnIds,
    rawMode, readOnly, compact, disableNestedModals, spaceId, spaceName, projectName,
    showSummaryBar, addRowModalOpen, onCloseAddRowModal, groupByColumn,
  };
};
