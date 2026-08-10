import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table2, ChevronRight, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnModel, ColumnRelationConfig, RowModel } from '../../types/table.types';

interface TableCellProps {
  value: unknown;
  column: ColumnModel;
  rowData?: Record<string, unknown>;
  rowId?: string;
  rawMode?: boolean;
  isExpanded?: boolean;
  onOpenNestedTable?: (tableId: string, filterColumn: string, filterValue: string, config?: ColumnRelationConfig['nested']) => void;
  onToggleInlineExpand?: (tableId: string, filterColumn: string, filterValue: string) => void;
}

/**
 * EmbeddedTableView - compact CSV-style table view inside cell
 * Shows first 3 rows with configurable "show all" action
 */
interface EmbeddedTableViewProps {
  tableId: string;
  filterColumn: string;
  filterValue: string;
  label: string;
  expandAction: 'modal' | 'inline' | 'expand'; // modal opens modal, inline opens between rows, expand shows all in cell
  onOpenNestedTable?: (tableId: string, filterColumn: string, filterValue: string, config?: ColumnRelationConfig['nested']) => void;
  onToggleInlineExpand?: (tableId: string, filterColumn: string, filterValue: string) => void;
  nestedConfig?: ColumnRelationConfig['nested'];
}

const EmbeddedTableView = ({
  tableId,
  filterColumn,
  filterValue,
  label,
  expandAction,
  onOpenNestedTable,
  onToggleInlineExpand,
  nestedConfig,
}: EmbeddedTableViewProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Load table metadata
  const { data: tableInfo } = useQuery({
    queryKey: ['embedded-table-info', tableId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: { name: string; displayName: string; columns: ColumnModel[] } }>(
        `/tables/${tableId}`
      );
      return response.data;
    },
    enabled: Boolean(tableId),
    staleTime: 300000,
  });

  // Load filtered rows
  const { data: tableData, isLoading } = useQuery({
    queryKey: ['embedded-table-rows', tableId, filterColumn, filterValue],
    queryFn: async () => {
      let url = `/tables/${tableId}/rows?limit=100`;
      // Only add filter if we have both filterColumn and filterValue
      if (filterColumn && filterValue) {
        const filterParam = encodeURIComponent(JSON.stringify({ [filterColumn]: filterValue }));
        url += `&filter=${filterParam}`;
      }
      const response = await apiClient.request<{ 
        data: { rows: RowModel[]; pagination: { total: number } } | RowModel[]
      }>(url);
      
      if (Array.isArray(response.data)) {
        return { rows: response.data, total: response.data.length };
      }
      return { 
        rows: response.data.rows || [], 
        total: response.data.pagination?.total || response.data.rows?.length || 0 
      };
    },
    enabled: Boolean(tableId),
    staleTime: 30000,
  });

  // Get columns to display (first 4)
  // Try from tableInfo first, then extract from row data
  let displayColumns: Array<{ id?: string; name: string; displayName?: string }> = [];
  
  if (tableInfo?.columns?.length) {
    displayColumns = tableInfo.columns.slice(0, 4);
  } else if (tableData?.rows?.length) {
    // Extract columns from first row data
    const firstRow = tableData.rows[0];
    const rowData = firstRow.data || firstRow;
    displayColumns = Object.keys(rowData).slice(0, 4).map((key, idx) => ({
      id: String(idx),
      name: key,
      displayName: key,
    }));
  }
  const rows = tableData?.rows || [];
  const totalRows = tableData?.total || 0;
  
  // Show first 3 rows or all if expanded
  const visibleRows = isExpanded ? rows : rows.slice(0, 3);
  const hasMore = rows.length > 3;

  const handleShowAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (expandAction === 'modal' && onOpenNestedTable) {
      onOpenNestedTable(tableId, filterColumn, filterValue, nestedConfig);
    } else if (expandAction === 'inline' && onToggleInlineExpand) {
      onToggleInlineExpand(tableId, filterColumn, filterValue);
    } else if (expandAction === 'expand') {
      setIsExpanded(!isExpanded);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center py-2">
        <div className="w-4 h-4 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="w-full text-center py-2 text-[10px] text-[var(--text-tertiary)]">
        Нет записей
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Compact table */}
      <div className="flex-1 overflow-hidden">
        <table className="w-full border-collapse text-[9px]">
          <thead>
            <tr className="bg-[var(--bg-tertiary)]">
              {displayColumns.map((col, i) => (
                <th 
                  key={col.id || i} 
                  className="px-1.5 py-0.5 text-left font-medium text-[var(--text-tertiary)] truncate border-b border-[var(--border-primary)]"
                >
                  {col.displayName || col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIdx) => {
              const rowData = row.data || row;
              return (
                <tr key={row.id || rowIdx} className="hover:bg-[var(--bg-tertiary)]/50">
                  {displayColumns.map((col, colIdx) => {
                    const value = rowData[col.name] ?? rowData[col.id] ?? '';
                    return (
                      <td 
                        key={`${row.id}-${col.id || colIdx}`}
                        className="px-1.5 py-0.5 text-[var(--text-secondary)] truncate border-b border-[var(--border-primary)]/50"
                      >
                        {String(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {/* Show all button - using div to avoid nested button issue */}
      {(hasMore || totalRows > 3) && (
        <div
          onClick={handleShowAll}
          className="w-full flex items-center justify-center gap-1 py-1 text-[9px] text-primary-500 hover:bg-primary-500/10 transition-colors border-t border-[var(--border-primary)] cursor-pointer"
        >
          {expandAction === 'expand' && isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              <span>Свернуть</span>
            </>
          ) : (
            <>
              {expandAction === 'modal' && <ExternalLink className="w-3 h-3" />}
              {expandAction === 'inline' && <ChevronDown className="w-3 h-3" />}
              {expandAction === 'expand' && <ChevronDown className="w-3 h-3" />}
              <span>{label} ({totalRows})</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * TableCell - displays embedded table with filtering by key
 * 
 * Configuration (column.config):
 * - tableId: ID of the table to embed
 * - filterColumn: column in embedded table to filter by (e.g. "parent_id")
 * - filterValue: value to filter by (can use ${id} for current row id)
 * - displayMode: 'modal' | 'inline' | 'embedded'
 *   - modal: button that opens modal with full table
 *   - inline: expands below row (Notion-style)
 *   - embedded: compact CSV view inside cell (4 cols × 3 rows)
 * - label: custom label for the button
 */
export const TableCell = ({ value, column, rowData, rowId, rawMode, isExpanded = false, onOpenNestedTable, onToggleInlineExpand }: TableCellProps) => {
  const [isHovered, setIsHovered] = useState(false);
  
  // Конфигурация может быть в разных местах:
  // - relation.tableId - ID связанной таблицы (устанавливается в "Источник данных")
  // - table.* - настройки отображения (устанавливаются в "Тип")
  const relationConfig = column.config?.relation || {};
  const tableConfig = column.config?.table || {};
  
  const tableId = relationConfig.tableId || tableConfig.tableId;
  const filterColumn = tableConfig.filterColumn || relationConfig.valueColumn || 'parent_id';
  const filterSourceColumn = tableConfig.filterSourceColumn || 'id';
  const displayMode = tableConfig.displayMode || 'modal';
  const label = tableConfig.buttonLabel || tableConfig.label || 'Показать записи';
  
  // Получаем значение для фильтрации из указанной колонки текущей строки
  // Приоритет: originalId > row_id > id (для внешних таблиц originalId содержит числовой ID)
  let filterValue = '';
  if (rowData) {
    const sourceValue = rowData[filterSourceColumn];
    // Если значение начинается с 'ext_', это внутренний ID - нужно извлечь оригинальный ID
    if (typeof sourceValue === 'string' && sourceValue.startsWith('ext_')) {
      // ext_148_2_7958 -> 7958 (последняя часть)
      const parts = sourceValue.split('_');
      filterValue = parts[parts.length - 1];
    } else if (rowData.originalId !== undefined) {
      filterValue = String(rowData.originalId);
    } else {
      filterValue = String(sourceValue ?? '');
    }
  } else {
    filterValue = String(value || '');
  }
  
  // RAW mode
  if (rawMode) {
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {JSON.stringify({ tableId, filterColumn, value: String(value || '') })}
      </span>
    );
  }
  
  // If no table configured, show placeholder
  if (!tableId) {
    return (
      <span className="text-xs text-[var(--text-tertiary)] italic">
        Таблица не настроена
      </span>
    );
  }
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (displayMode === 'inline') {
      if (onToggleInlineExpand && tableId) {
        onToggleInlineExpand(String(tableId), filterColumn, filterValue);
      }
      return;
    }
    
    if (displayMode === 'modal' && onOpenNestedTable && tableId) {
      onOpenNestedTable(
        String(tableId), 
        filterColumn, 
        filterValue,
        tableConfig.nested
      );
    }
  };
  
  // Embedded CSV-style view inside cell
  if (displayMode === 'embedded') {
    return (
      <EmbeddedTableView
        tableId={String(tableId)}
        filterColumn={filterColumn}
        filterValue={filterValue}
        label={label}
        expandAction={tableConfig.expandAction || 'modal'}
        onOpenNestedTable={onOpenNestedTable}
        onToggleInlineExpand={onToggleInlineExpand}
        nestedConfig={tableConfig.nested}
      />
    );
  }
  
  // Modal mode - button to open modal
  if (displayMode === 'modal') {
    return (
      <div
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
          transition-all duration-150 cursor-pointer
          ${isHovered 
            ? 'bg-primary-500/20 text-primary-600 shadow-sm' 
            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-primary-500/10'
          }
        `}
      >
        <Table2 className="w-3.5 h-3.5" />
        <span>{label}</span>
        <ExternalLink className="w-3 h-3" />
      </div>
    );
  }
  
  // Inline mode - expandable view (Notion-style)
  // The actual expanded table is rendered by TableGrid between rows
  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium
        transition-all duration-150 cursor-pointer
        ${isExpanded
          ? 'bg-primary-500/20 text-primary-600 shadow-sm'
          : isHovered 
            ? 'bg-primary-500/20 text-primary-600 shadow-sm' 
            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-primary-500/10'
        }
      `}
    >
      <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
      <Table2 className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
};
