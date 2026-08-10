import { useQuery } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Table2, X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnModel, RowModel } from '../../types/table.types';
import { UniversalTable } from '../UniversalTable/UniversalTable';

interface InlineNestedTableProps {
  tableId: string;
  filterColumn: string;
  filterValue: string;
  colSpan: number;
  onClose: () => void;
}

export const InlineNestedTable = ({
  tableId,
  filterColumn,
  filterValue,
  colSpan,
  onClose,
}: InlineNestedTableProps) => {
  // Local state for instant UI updates
  const [localRows, setLocalRows] = useState<RowModel[]>([]);
  
  // Load table metadata
  const { data: tableInfo } = useQuery({
    queryKey: ['inline-nested-table-info', tableId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: { name: string; displayName: string; emoji?: string; space_id?: number; project_id?: number } }>(
        `/tables/${tableId}`
      );
      return response.data;
    },
    enabled: Boolean(tableId),
    staleTime: 300000,
  });

  // Load columns separately
  const { data: columnsData } = useQuery({
    queryKey: ['inline-nested-table-columns', tableId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: Array<{
        id: number;
        table_id: number;
        name: string;
        display_name: string;
        column_type: string;
        config?: Record<string, unknown>;
        width?: number;
        order_index?: number;
        is_visible?: boolean;
      }> }>(
        `/tables/${tableId}/columns`
      );
      // Map snake_case API response to camelCase ColumnModel
      return response.data.map((col, idx) => ({
        id: String(col.id),
        tableId: String(col.table_id),
        name: col.name,
        displayName: col.display_name || col.name,
        type: col.column_type || 'text',
        config: col.config || {},
        width: col.width || 120,
        orderIndex: col.order_index ?? idx,
        isVisible: col.is_visible !== false,
        isRequired: false,
        isReadonly: false,
      })) as ColumnModel[];
    },
    enabled: Boolean(tableId),
    staleTime: 300000,
  });

  // Load filtered rows - load all and filter on frontend
  const { data: tableData, isLoading, refetch } = useQuery({
    queryKey: ['inline-nested-table-rows', tableId, filterColumn, filterValue],
    queryFn: async () => {
      // Load all rows without filter, we'll filter on frontend
      const response = await apiClient.request<{ 
        data: { rows: RowModel[]; pagination: { total: number } } | RowModel[]
      }>(`/tables/${tableId}/rows?limit=500`);
      
      let allRows: RowModel[] = [];
      if (Array.isArray(response.data)) {
        allRows = response.data;
      } else {
        allRows = response.data.rows || [];
      }
      
      // Debug log
      logger.debug('[InlineNestedTable] Filtering:', { 
        tableId, 
        filterColumn, 
        filterValue,
        allRowsCount: allRows.length,
        sampleRow: allRows[0] ? JSON.stringify(allRows[0].data || allRows[0]).substring(0, 200) : 'no rows'
      });
      
      // Filter rows on frontend by filterColumn = filterValue
      const filteredRows = allRows.filter(row => {
        const rowData = row.data || row;
        const cellValue = rowData[filterColumn];
        // Compare as strings to handle different types
        return String(cellValue) === String(filterValue);
      });
      
      logger.debug('[InlineNestedTable] Filtered result:', filteredRows.length, 'rows');
      
      return { 
        rows: filteredRows, 
        total: filteredRows.length 
      };
    },
    enabled: Boolean(tableId && filterColumn && filterValue),
    staleTime: 30000,
  });
  
  // Sync local rows with fetched data
  useEffect(() => {
    if (tableData?.rows) {
      setLocalRows(tableData.rows.map((row, idx) => ({
        id: row.id || `row_${idx}`,
        data: row.data || row,
      })));
    }
  }, [tableData]);
  
  // Handler for instant local updates (called from UniversalTable)
  const handleLocalCellUpdate = useCallback((rowId: string, columnId: string, value: unknown) => {
    setLocalRows(prev => prev.map(row => {
      if (String(row.id) === String(rowId)) {
        return { ...row, data: { ...row.data, [columnId]: value } };
      }
      return row;
    }));
  }, []);

  // Extract columns from data if columnsData not available
  let displayColumns: ColumnModel[] = [];
  
  if (columnsData?.length) {
    displayColumns = columnsData;
  } else if (tableData?.rows?.length) {
    const firstRow = tableData.rows[0];
    const rowData = firstRow.data || firstRow;
    displayColumns = Object.keys(rowData).map((key, idx) => ({ 
      id: String(idx),
      tableId: tableId,
      name: key, 
      displayName: key, 
      type: 'text',
      width: 120,
      orderIndex: idx,
      isVisible: true,
      isRequired: false,
      isReadonly: false,
      config: {},
    } as ColumnModel));
  }

  // Calculate total table width based on column widths (kept for reference)
  const totalWidth = displayColumns.reduce((sum, col) => sum + (col.width || 120), 0) + 50; // +50 for padding

  return (
    <tr className="bg-[var(--bg-secondary)]/50">
      <td colSpan={colSpan} className="p-0">
        <div 
          className="border-y-2 border-l-4 border-primary-500/30 bg-[var(--bg-primary)]"
          style={{ width: '100%' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-primary-500/10 border-b border-primary-500/20">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {tableInfo?.emoji ? (
                <span className="text-base flex-shrink-0">{tableInfo.emoji}</span>
              ) : (
                <Table2 className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
              )}
              <Link
                to={tableInfo?.space_id 
                  ? `/spaces/${tableInfo.space_id}/tables/${tableId}`
                  : `/tables/${tableId}`
                }
                className="text-sm font-medium text-[var(--color-primary-500)] hover:underline flex items-center gap-1 truncate"
              >
                {tableInfo?.displayName || tableInfo?.name || `Таблица #${tableId}`}
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </Link>
              <span className="text-xs text-[var(--text-tertiary)] flex-shrink-0">
                ({filterColumn}: {filterValue})
              </span>
              {tableData && (
                <span className="text-xs text-[var(--text-tertiary)] flex-shrink-0">
                  • {tableData.total} записей
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => refetch()}
                className="p-1.5 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                title="Обновить"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                title="Свернуть"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          
          {/* Content - vertical scroll only, scrollbar on left */}
          <div 
            className="max-h-[400px] overflow-auto inline-nested-table-scroll"
          >
            <div style={{ width: totalWidth }}>
              <style>{`
                .inline-nested-table-scroll table thead tr th:first-child,
                .inline-nested-table-scroll table tbody tr td:first-child {
                  position: sticky;
                  left: 0;
                  z-index: 2;
                  background-color: var(--bg-primary);
                }
                .inline-nested-table-scroll table thead tr th:first-child {
                  z-index: 3;
                  background-color: var(--bg-secondary);
                }
                .inline-nested-table-scroll table tbody tr:hover td:first-child {
                  background-color: var(--bg-tertiary);
                }
              `}</style>
              {isLoading && !localRows.length ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
                  <span className="ml-2 text-sm text-[var(--text-tertiary)]">Загрузка...</span>
                </div>
              ) : !localRows.length ? (
                <div className="flex flex-col items-center justify-center py-8 text-[var(--text-tertiary)]">
                  <Table2 className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-sm">Записи не найдены</span>
                </div>
              ) : (
                <UniversalTable
                  table={{
                    id: Number(tableId),
                    name: tableInfo?.name || 'nested',
                    displayName: tableInfo?.displayName || 'Записи',
                    projectId: 0,
                  }}
                  columns={displayColumns.map((col, idx) => ({
                    id: col.id || String(idx),
                    tableId: col.tableId || tableId,
                    name: col.name,
                    displayName: col.displayName || col.name,
                    type: col.type || 'text',
                    width: col.width || 120,
                    orderIndex: col.orderIndex ?? idx,
                    isVisible: col.isVisible !== false,
                    isRequired: col.isRequired || false,
                    isReadonly: col.isReadonly || false,
                    config: col.config || {},
                  }))}
                  rows={localRows}
                  onLocalCellUpdate={handleLocalCellUpdate}
                  readOnly={false}
                  compact={true}
                  disableNestedModals={true}
                />
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
};
