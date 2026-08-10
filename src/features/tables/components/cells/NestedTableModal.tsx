import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { X, Plus, RefreshCw, Table2 } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnRelationConfig, ColumnModel, RowModel } from '../../types/table.types';
import { UniversalTable } from '../UniversalTable/UniversalTable';

interface NestedTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  filterColumn: string;
  filterValue: string;
  config?: ColumnRelationConfig['nested'];
  parentLabel?: string;
}

interface TableData {
  columns: ColumnModel[];
  rows: RowModel[];
  total: number;
}

export const NestedTableModal = ({
  isOpen,
  onClose,
  tableId,
  filterColumn,
  filterValue,
  config,
  parentLabel,
}: NestedTableModalProps) => {
  const [page, setPage] = useState(1);
  const limit = 50;

  // Reset page when modal opens
  useEffect(() => {
    if (isOpen) setPage(1);
  }, [isOpen]);

  // Load table metadata
  const { data: tableInfo } = useQuery({
    queryKey: ['nested-table-info', tableId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: { name: string; displayName: string; columns: ColumnModel[] } }>(
        `/tables/${tableId}`
      );
      return response.data;
    },
    enabled: isOpen && Boolean(tableId),
    staleTime: 300000, // 5 minutes
  });

  // Load filtered rows
  const { data: tableData, isLoading, refetch } = useQuery({
    queryKey: ['nested-table-rows', tableId, filterColumn, filterValue, page],
    queryFn: async () => {
      // Build filter query
      const filterParam = encodeURIComponent(JSON.stringify({ [filterColumn]: filterValue }));
      const response = await apiClient.request<{ 
        data: { rows: RowModel[]; pagination: { total: number } } | RowModel[]
      }>(`/tables/${tableId}/rows?filter=${filterParam}&page=${page}&limit=${limit}`);
      
      // Handle both response formats
      if (Array.isArray(response.data)) {
        return { rows: response.data, total: response.data.length };
      }
      return { 
        rows: response.data.rows || [], 
        total: response.data.pagination?.total || response.data.rows?.length || 0 
      };
    },
    enabled: isOpen && Boolean(tableId && filterColumn && filterValue),
    staleTime: 30000,
  });

  // Filter columns to display
  // First try tableInfo columns, fallback to extracting from row data
  let displayColumns: Array<{ id?: string; name: string; displayName?: string }> = [];
  
  if (config?.displayColumns?.length && tableInfo?.columns?.length) {
    displayColumns = tableInfo.columns.filter(c => config.displayColumns!.includes(c.id || c.name));
  } else if (tableInfo?.columns?.length) {
    displayColumns = tableInfo.columns;
  } else if (tableData?.rows?.length) {
    // Fallback: extract columns from first row's data
    const firstRow = tableData.rows[0];
    const rowData = firstRow.data || firstRow;
    displayColumns = Object.keys(rowData).map(key => ({ name: key, displayName: key }));
  }
  
  // Build modal title
  const title = config?.modalTitle
    ? config.modalTitle.replace('{label}', parentLabel || filterValue)
    : `${tableInfo?.displayName || 'Записи'} (${filterColumn}: ${parentLabel || filterValue})`;

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-[var(--bg-primary)] rounded-xl shadow-2xl border border-[var(--border-primary)] w-[90vw] max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            <Table2 className="w-5 h-5 text-[var(--color-primary-500)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {title}
            </h2>
            {tableData && (
              <span className="text-sm text-[var(--text-tertiary)]">
                ({tableData.total} записей)
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {config?.allowAdd && (
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Добавить
              </button>
            )}
            
            <button
              onClick={() => refetch()}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              title="Обновить"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* Table Content */}
        <div className="flex-1 overflow-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 text-[var(--text-tertiary)]">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Загрузка...</span>
              </div>
            </div>
          ) : !tableData?.rows?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-tertiary)]">
              <Table2 className="w-12 h-12 mb-3 opacity-50" />
              <span>Записи не найдены</span>
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
                name: col.name,
                displayName: col.displayName || col.name,
                type: (col as ColumnModel).type || 'text',
                width: 150,
                order: idx,
                visible: true,
              }))}
              rows={tableData.rows.map((row, idx) => ({
                id: row.id || `row_${idx}`,
                data: row.data || row,
              }))}
              readOnly={!config?.allowEdit}
              compact={true}
              disableNestedModals={true}
            />
          )}
        </div>
        
        {/* Pagination */}
        {tableData && tableData.total > limit && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
            <span className="text-sm text-[var(--text-tertiary)]">
              Страница {page} из {Math.ceil(tableData.total / limit)}
            </span>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Назад
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(tableData.total / limit)}
                className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Вперёд
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
