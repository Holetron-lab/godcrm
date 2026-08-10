import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { UniversalTable, PaginationInfo } from '@/features/tables/components/UniversalTable/UniversalTable';
import { TableSkeleton } from '@/features/tables/components/UniversalTable/TableSkeleton';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useTablesBootstrap } from '@/features/tables/hooks/useTablesBootstrap';
import { SyncStatusBar } from '@/features/tables/components/SyncStatusBar';
import { TableFilters } from '@/features/tables/components/TableFilters';
import { EditTableModal } from '@/features/tables/components/EditTableModal';
import { useProjectStore } from '@/features/projects/store/projectStore';
import { useColumnConfig } from '@/features/tables/hooks/useColumnConfig';
import { useQueryClient } from '@tanstack/react-query';
import { setTableTitle } from '@/shared/utils/pageTitle';

// Helper to parse URL filters
const parseUrlFilters = (searchParams: URLSearchParams) => {
  const selectFilters: Record<string, string[]> = {};
  const dateFilters: Record<string, { from?: string; to?: string }> = {};
  const activeFilterColumns: string[] = [];
  
  // Parse select filters: f_columnId=value1,value2
  searchParams.forEach((value, key) => {
    if (key.startsWith('f_')) {
      const columnId = key.slice(2);
      selectFilters[columnId] = value.split(',').filter(v => v);
      if (!activeFilterColumns.includes(columnId)) {
        activeFilterColumns.push(columnId);
      }
    }
    // Parse date filters: d_columnId_from=2024-01-01 or d_columnId_to=2024-12-31
    if (key.startsWith('d_')) {
      const parts = key.slice(2).split('_');
      if (parts.length >= 2) {
        const columnId = parts.slice(0, -1).join('_');
        const field = parts[parts.length - 1] as 'from' | 'to';
        if (field === 'from' || field === 'to') {
          if (!dateFilters[columnId]) {
            dateFilters[columnId] = {};
          }
          dateFilters[columnId][field] = value;
          if (!activeFilterColumns.includes(columnId)) {
            activeFilterColumns.push(columnId);
          }
        }
      }
    }
  });
  
  return {
    search: searchParams.get('q') || '',
    searchColumns: searchParams.get('sc')?.split(',').filter(v => v) || [],
    selectFilters,
    dateFilters,
    activeFilterColumns,
    groupBy: searchParams.get('group') || null,
    page: parseInt(searchParams.get('page') || '1', 10),
    limit: parseInt(searchParams.get('limit') || '50', 10),
  };
};

// Helper to build URL from filters
const buildFilterUrl = (
  baseUrl: string,
  filters: {
    search?: string;
    searchColumns?: string[];
    selectFilters?: Record<string, string[]>;
    dateFilters?: Record<string, { from?: string; to?: string }>;
    groupBy?: string | null;
    page?: number;
    mode?: string | null;
  }
) => {
  const params = new URLSearchParams();
  
  if (filters.mode) {
    params.set('mode', filters.mode);
  }
  if (filters.search) {
    params.set('q', filters.search);
  }
  if (filters.searchColumns && filters.searchColumns.length > 0) {
    params.set('sc', filters.searchColumns.join(','));
  }
  if (filters.selectFilters) {
    Object.entries(filters.selectFilters).forEach(([columnId, values]) => {
      if (values.length > 0) {
        params.set(`f_${columnId}`, values.join(','));
      }
    });
  }
  if (filters.dateFilters) {
    Object.entries(filters.dateFilters).forEach(([columnId, range]) => {
      if (range.from) {
        params.set(`d_${columnId}_from`, range.from);
      }
      if (range.to) {
        params.set(`d_${columnId}_to`, range.to);
      }
    });
  }
  if (filters.groupBy) {
    params.set('group', filters.groupBy);
  }
  if (filters.page && filters.page > 1) {
    params.set('page', String(filters.page));
  }
  
  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
};

const TableViewPage = () => {
  const { tableId: tableIdParam } = useParams();
  // Normalize tableId to string for comparison (URL params are always strings)
  const tableId = tableIdParam;
  const [searchParams, setSearchParams] = useSearchParams();
  const rawMode = searchParams.get('mode') === 'raw';
  const navigate = useNavigate();
  const { loading } = useTablesBootstrap({ rawMode });
  const selectTable = useTablesStore((state) => state.selectTable);
  const activeTableId = useTablesStore((state) => state.activeTableId);
  const tables = useTablesStore((state) => state.tables);
  const projects = useProjectStore((state) => state.projects);
  const rowsLimit = useTablesStore((state) => state.rowsLimit);
  const setRowsLimit = useTablesStore((state) => state.setRowsLimit);
  const currentPage = useTablesStore((state) => state.currentPage);
  const setCurrentPage = useTablesStore((state) => state.setCurrentPage);
  const setMinLoadedPage = useTablesStore((state) => state.setMinLoadedPage);
  
  // Parse initial state from URL
  const initialFilters = useMemo(() => parseUrlFilters(searchParams), []);
  
  // Initialize currentPage from URL on mount
  const initialPageRef = useRef(initialFilters.page);
  const initialLimitRef = useRef(initialFilters.limit);
  useEffect(() => {
    // Always set page from URL (defaults to 1 if not present)
    setCurrentPage(initialPageRef.current);
    // Also set minLoadedPage to track where we started
    setMinLoadedPage(initialPageRef.current);
    if (initialLimitRef.current !== 50) {
      setRowsLimit(initialLimitRef.current);
    }
  }, [setCurrentPage, setMinLoadedPage, setRowsLimit]);
  
  const [searchQuery, setSearchQuery] = useState(initialFilters.search);
  const [searchColumns, setSearchColumns] = useState<string[]>(initialFilters.searchColumns);
  const [selectFilters, setSelectFilters] = useState<Record<string, string[]>>(initialFilters.selectFilters);
  const [dateFilters, setDateFilters] = useState<Record<string, { from?: string; to?: string }>>(initialFilters.dateFilters);
  const [activeFilterColumns, setActiveFilterColumns] = useState<string[]>(initialFilters.activeFilterColumns);
  const [groupByColumn, setGroupByColumn] = useState<string | null>(initialFilters.groupBy);
  const [addRowModalOpen, setAddRowModalOpen] = useState(false);
  const [bulkReplaceOpen, setBulkReplaceOpen] = useState(false);
  const [tableSettingsOpen, setTableSettingsOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [paginationInfo, setPaginationInfo] = useState<PaginationInfo | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Update URL when filters change
  useEffect(() => {
    const newParams = new URLSearchParams();
    
    if (rawMode) {
      newParams.set('mode', 'raw');
    }
    if (searchQuery) {
      newParams.set('q', searchQuery);
    }
    if (searchColumns.length > 0) {
      newParams.set('sc', searchColumns.join(','));
    }
    Object.entries(selectFilters).forEach(([columnId, values]) => {
      if (values.length > 0) {
        newParams.set(`f_${columnId}`, values.join(','));
      }
    });
    Object.entries(dateFilters).forEach(([columnId, range]) => {
      if (range.from) {
        newParams.set(`d_${columnId}_from`, range.from);
      }
      if (range.to) {
        newParams.set(`d_${columnId}_to`, range.to);
      }
    });
    if (groupByColumn) {
      newParams.set('group', groupByColumn);
    }
    // Add page to URL if > 1
    if (currentPage > 1) {
      newParams.set('page', String(currentPage));
    }
    // Add limit to URL if not default
    if (rowsLimit !== 50) {
      newParams.set('limit', String(rowsLimit));
    }
    
    // Only update if params actually changed
    const currentParams = searchParams.toString();
    const newParamsStr = newParams.toString();
    if (currentParams !== newParamsStr) {
      setSearchParams(newParams, { replace: true });
    }
  }, [searchQuery, searchColumns, selectFilters, dateFilters, groupByColumn, rawMode, currentPage, rowsLimit, searchParams, setSearchParams]);
  
  const handlePaginationChange = useCallback((info: PaginationInfo) => {
    setPaginationInfo(info);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, [setCurrentPage]);

  const handleLoadMore = useCallback(() => {
    // Store the row index we want to scroll to after loading
    // After loading next page, scroll to the first row of the new page
    // currentPage is still the old page, so new data starts at currentPage * rowsLimit
    (window as any).__scrollToRowIndex = currentPage * rowsLimit;
    (window as any).__scrollDirection = 'down';
    // Call the stored handler from UniversalTable
    (window as any).__tableLoadMore?.();
  }, [currentPage, rowsLimit]);

  const handleLoadPrevious = useCallback(() => {
    // After loading previous page, scroll to the last row of that page
    // (which is rowsLimit - 1, since it's the bottom of the previous page)
    (window as any).__scrollToRowIndex = rowsLimit - 1;
    (window as any).__scrollDirection = 'up';
    // Call the stored handler from UniversalTable
    (window as any).__tableLoadPrevious?.();
  }, [rowsLimit]);
  
  // Scroll to the correct row after loading completes
  const loadingMore = useTablesStore((state) => state.loadingMore);
  const prevLoadingMore = useRef(loadingMore);
  
  useEffect(() => {
    // When loadingMore changes from true to false, scroll to the target row
    if (prevLoadingMore.current && !loadingMore) {
      const scrollToRowIndex = (window as any).__scrollToRowIndex;
      const scrollDirection = (window as any).__scrollDirection;
      
      if (scrollToRowIndex !== undefined && scrollContainerRef.current) {
        // Use multiple requestAnimationFrames to ensure DOM has updated
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
              // Find the row by index - rows are in tbody (skip the "load previous" row if exists)
              const allRows = scrollContainerRef.current.querySelectorAll('tbody tr[data-row-id]');
              const targetRow = allRows[scrollToRowIndex];
              
              if (targetRow) {
                targetRow.scrollIntoView({ block: 'start', behavior: 'instant' });
              } else if (scrollDirection === 'down' && allRows.length > 0) {
                // Scroll to last row if target not found
                allRows[allRows.length - 1]?.scrollIntoView({ block: 'end', behavior: 'instant' });
              }
            }
            delete (window as any).__scrollToRowIndex;
            delete (window as any).__scrollDirection;
          });
        });
      }
    }
    prevLoadingMore.current = loadingMore;
  }, [loadingMore]);
  
  // Select table when component mounts or tableId changes
  useEffect(() => {
    if (!tableId) {
      return;
    }

    // Use String() to ensure type-safe comparison (table.id can be number or string)
    const requestedTable = tables.find((table) => String(table.id) === String(tableId));
    if (requestedTable && String(tableId) !== String(activeTableId)) {
      selectTable(tableId);
      // Reset page to 1 when switching tables (unless URL has page param)
      const urlPage = searchParams.get('page');
      if (!urlPage) {
        setCurrentPage(1);
        setMinLoadedPage(1);
      }
    }
  }, [tableId, activeTableId, selectTable, tables, searchParams, setCurrentPage, setMinLoadedPage]);

  // When requested table is missing but we have tables, redirect to the first available one
  useEffect(() => {
    if (!tableId && tables.length > 0) {
      const fallback = tables[0];
      selectTable(fallback.id);
      navigate(`/tables/${fallback.id}`, { replace: true });
      return;
    }

    if (!tableId || tables.length === 0) {
      return;
    }

    // Use String() to ensure type-safe comparison (table.id can be number or string)
    const requestedTable = tables.find((table) => String(table.id) === String(tableId));
    if (!requestedTable) {
      const fallback = tables.find((table) => String(table.id) === String(activeTableId)) ?? tables[0];
      if (fallback) {
        logger.warn('⚠️ Requested table not found, redirecting to available table', {
          requested: tableId,
          fallback: fallback.id,
          availableTables: tables.map(t => ({ id: t.id, name: t.name }))
        });
        selectTable(fallback.id);
        navigate(`/tables/${fallback.id}`, { replace: true });
      }
    }
  }, [tableId, tables, activeTableId, navigate, selectTable]);

  const currentTable = tables.find(t => String(t.id) === String(tableId));
  const currentProject = currentTable?.projectId ? projects.find(p => p.id === currentTable.projectId) : null;
  const workspaceId = currentProject?.space_id?.toString() || '1';
  const queryClient = useQueryClient();
  
  // Update page title when table changes
  useEffect(() => {
    if (currentTable) {
      setTableTitle(currentTable.display_name || currentTable.name, currentProject?.name);
    }
  }, [currentTable, currentProject]);
  
  // Load columns for filters
  const columns = useColumnConfig(currentTable?.id || null);
  
  const handleRefresh = () => {
    if (currentTable?.id) {
      queryClient.invalidateQueries({ queryKey: ['rows', currentTable.id] });
      queryClient.invalidateQueries({ queryKey: ['columns', currentTable.id] });
    }
  };

  if (loading || tables.length === 0) {
    return (
      <section className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden">
          <TableSkeleton rows={12} columns={6} />
        </div>
      </section>
    );
  }

  if (!currentTable || !currentTable.id) {
    return (
      <section className="space-y-6">
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--color-error)]">
          Table not found
        </div>
      </section>
    );
  }

  // Extra safety - ensure id exists before rendering
  const safeTableId = currentTable.id ? String(currentTable.id) : null;
  if (!safeTableId) {
    return (
      <section className="space-y-6">
        <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--color-error)]">
          Invalid table ID
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col h-full">
      {/* Fixed Filters with Add Row and Refresh */}
      <div className="flex-shrink-0">
        <TableFilters
          columns={columns}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchColumns={searchColumns}
          onSearchColumnsChange={setSearchColumns}
          selectFilters={selectFilters}
          onSelectFiltersChange={setSelectFilters}
          dateFilters={dateFilters}
          onDateFiltersChange={setDateFilters}
          activeFilterColumns={activeFilterColumns}
          onActiveFilterColumnsChange={setActiveFilterColumns}
          groupByColumn={groupByColumn}
          onGroupByColumnChange={setGroupByColumn}
          paginationInfo={paginationInfo}
          rowsLimit={rowsLimit}
          onRowsLimitChange={setRowsLimit}
          onPageChange={handlePageChange}
          onAddRow={() => {
            setAddRowModalOpen(true);
          }}
          onRefresh={handleRefresh}
          isExternal={!!currentTable.source_table_name}
          projectId={currentTable.projectId}
          rawMode={rawMode}
          tableIdProp={currentTable.id}
          showBulkReplace={true}
          onBulkReplace={() => setBulkReplaceOpen(true)}
          showTableSettings={true}
          onTableSettings={() => setTableSettingsOpen(true)}
          showPrint={true}
          onPrint={() => setPrintOpen(true)}
        />
      </div>

      {/* Fixed Sync Status */}
      <div className="flex-shrink-0">
        <SyncStatusBar table={currentTable} />
      </div>

      {/* Scrollable Table Area - container with horizontal scroll. Top border lives on TableFilters above. */}
      <div
        ref={scrollContainerRef}
        className="relative flex-1 min-w-0 min-h-0 overflow-x-auto overflow-y-auto rounded-b-2xl border-x-2 border-b border-[var(--border-primary)]"
      >
        <UniversalTable 
          searchQuery={searchQuery} 
          searchColumns={searchColumns}
          selectFilters={selectFilters}
          dateFilters={dateFilters}
          groupByColumn={groupByColumn}
          addRowModalOpen={addRowModalOpen} 
          onCloseAddRowModal={() => setAddRowModalOpen(false)}
          onPaginationChange={handlePaginationChange}
          onLoadMore={handleLoadMore}
          rawMode={rawMode}
          spaceId={currentProject?.space_id ?? undefined}
          bulkReplaceOpen={bulkReplaceOpen}
          onBulkReplaceOpenChange={setBulkReplaceOpen}
          printOpen={printOpen}
          onPrintOpenChange={setPrintOpen}
        />
      </div>
      
      {/* Table Settings Modal (opens on Editing tab) */}
      <EditTableModal
        open={tableSettingsOpen}
        onOpenChange={setTableSettingsOpen}
        tableId={currentTable.id}
        projectId={currentTable.projectId}
        spaceId={currentProject?.space_id ?? undefined}
        defaultTab="personalization"
      />
    </section>
  );
};

export default TableViewPage;
