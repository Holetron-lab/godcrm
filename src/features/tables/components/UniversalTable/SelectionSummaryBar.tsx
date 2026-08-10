import { useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnModel, RowModel, ColumnOption } from '../../types/table.types';
import type { SelectionSortMode } from '../../types/selection.types';
import { SelectionContainer } from './SelectionContainer';

interface SelectionSummaryBarProps {
  columns: ColumnModel[];
  rows: RowModel[];
  selectedRowIds: Set<string>;
  selectionSort: SelectionSortMode;
  onSortChange: (sort: SelectionSortMode) => void;
  onClearSelection: () => void;
  onSelectAllFiltered: () => void;
  onDeleteSelected?: () => void;
  filteredCount: number;
  totalCount: number;
  readOnly?: boolean;
}

interface ColumnSummary {
  columnName: string;
  summary: string;
}

const SUMMARY_COLUMN_TYPES = new Set([
  'number', 'integer', 'float', 'decimal',
  'select', 'multi-select', 'multi_select',
  'checkbox'
]);

const IGNORED_COLUMN_TYPES = new Set([
  'button', 'password', 'file', 'image', 'audio', 'vector',
  'table', 'relation'
]);

/**
 * Calculates summary string for a column
 */
function calculateColumnSummary(
  column: ColumnModel,
  rows: RowModel[],
  selectedIds: Set<string>,
  relationOptions?: ColumnOption[]
): ColumnSummary | null {
  // Skip system columns and ignored types
  if (IGNORED_COLUMN_TYPES.has(column.type) || column.name === 'id' || column.id === 'id') {
    return null;
  }

  const selectedRows = rows.filter(r => selectedIds.has(r.id));
  if (selectedRows.length === 0) return null;

  // Access data by column.name first, then fallback to column.id (consistent with TableGrid)
  const values = selectedRows.map(r => r.data[column.name] ?? r.data[column.id]);
  const columnName = column.displayName || column.name;

  // Numbers: sum, avg
  if (['number', 'integer', 'float', 'decimal'].includes(column.type)) {
    const numbers = values
      .filter(v => v !== null && v !== undefined && v !== '')
      .map(v => Number(v))
      .filter(n => !isNaN(n));
    
    if (numbers.length === 0) return null;

    const sum = numbers.reduce((a, b) => a + b, 0);
    const avg = sum / numbers.length;
    const roundedSum = Math.round(sum * 100) / 100;
    const roundedAvg = Math.round(avg * 100) / 100;
    
    return {
      columnName,
      summary: `Σ${roundedSum} μ${roundedAvg}`
    };
  }

  // Checkbox: checked/unchecked count
  if (column.type === 'checkbox') {
    const checked = values.filter(v => v === true || v === 1 || v === '1' || v === 'true').length;
    const unchecked = selectedRows.length - checked;
    return {
      columnName,
      summary: `✓${checked} ✗${unchecked}`
    };
  }

  // Select/Multi-select: value distribution
  if (['select', 'multi-select', 'multi_select'].includes(column.type)) {
    const valueCounts: Record<string, number> = {};
    
    for (const val of values) {
      if (val === null || val === undefined || val === '') continue;
      
      const arr = Array.isArray(val) ? val : [val];
      for (const v of arr) {
        const key = String(v);
        valueCounts[key] = (valueCounts[key] || 0) + 1;
      }
    }
    
    if (Object.keys(valueCounts).length === 0) return null;

    // Show top 2 values
    const sorted = Object.entries(valueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    
    // Use relation options if available, otherwise fall back to column.config.options
    const options = relationOptions?.length ? relationOptions : (column.config?.options || []);
    const formatted = sorted.map(([val, count]) => {
      const option = options.find(o => String(o.value) === val);
      const label = option?.label || val;
      const shortLabel = label.length > 10 ? label.slice(0, 8) + '…' : label;
      return `${shortLabel}:${count}`;
    });
    
    return {
      columnName,
      summary: formatted.join(' ')
    };
  }

  return null;
}

/**
 * Summary bar showing aggregate stats for selected rows
 */
export const SelectionSummaryBar = ({
  columns,
  rows,
  selectedRowIds,
  selectionSort,
  onSortChange,
  onClearSelection,
  onSelectAllFiltered,
  onDeleteSelected,
  filteredCount,
  totalCount,
  readOnly = false
}: SelectionSummaryBarProps) => {
  const selectedCount = selectedRowIds.size;
  
  // Find columns with relation configs that need data loading
  const relationColumns = useMemo(() => {
    return columns.filter(col => 
      ['select', 'multi-select', 'multi_select'].includes(col.type) &&
      col.config?.relation?.enabled &&
      col.config?.relation?.tableId &&
      col.config?.relation?.valueColumn &&
      col.config?.relation?.labelColumn
    );
  }, [columns]);
  
  // Load relation options for all relation columns
  const { data: relationOptionsMap } = useQuery({
    queryKey: ['summary-relation-options', relationColumns.map(c => `${c.id}:${c.config?.relation?.tableId}`).join(',')],
    queryFn: async () => {
      const map = new Map<string, ColumnOption[]>();
      
      for (const col of relationColumns) {
        const relation = col.config?.relation;
        if (!relation?.tableId || !relation?.valueColumn || !relation?.labelColumn) continue;
        
        try {
          const response = await apiClient.request<{ 
            data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
          }>(`/tables/${relation.tableId}/rows?limit=5000`);
          
          // Handle different response formats
          const responseData = response.data as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
          const rowsData = Array.isArray(responseData) 
            ? responseData 
            : ((responseData as { rows?: Array<Record<string, unknown>>; data?: { rows: Array<Record<string, unknown>> } })?.rows || 
               (responseData as { data?: { rows: Array<Record<string, unknown>> } })?.data?.rows || []);
          
          type RowItem = { id?: string | number; data?: Record<string, unknown>; originalId?: string | number };
          const options: ColumnOption[] = rowsData.map((row: RowItem) => {
            const rowData = row.data && typeof row.data === 'object' ? row.data : (row as Record<string, unknown>);
            const rowId = row.id;
            const originalId = row.originalId;
            
            let val: string;
            if (relation.valueColumn === 'id') {
              val = String(originalId ?? rowData['id'] ?? rowId ?? '');
            } else {
              val = String(rowData[relation.valueColumn] ?? '');
            }
            
            return {
              value: val,
              label: String(rowData[relation.labelColumn] ?? ''),
              color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined
            };
          });
          
          map.set(col.id, options);
        } catch (e) {
          logger.error('Failed to load relation options for column', col.id, e);
        }
      }
      
      return map;
    },
    enabled: relationColumns.length > 0 && selectedCount > 0,
    staleTime: 60000,
  });
  
  // Calculate summaries for all eligible columns
  const summaries = useMemo(() => {
    if (selectedCount === 0) return [];
    
    const result: ColumnSummary[] = [];
    for (const col of columns) {
      const relationOptions = relationOptionsMap?.get(col.id);
      const summary = calculateColumnSummary(col, rows, selectedRowIds, relationOptions);
      if (summary) {
        result.push(summary);
      }
    }
    return result;
  }, [columns, rows, selectedRowIds, selectedCount, relationOptionsMap]);

  // Don't render if nothing selected
  if (selectedCount === 0) return null;

  // Split summaries into two roughly equal rows by character length
  const splitIntoBalancedRows = (items: ColumnSummary[]) => {
    if (items.length <= 3) return [items];
    
    // Calculate total length
    const lengths = items.map(s => s.columnName.length + s.summary.length + 2);
    const totalLength = lengths.reduce((a, b) => a + b, 0);
    const targetLength = totalLength / 2;
    
    let currentLength = 0;
    let splitIndex = 0;
    
    for (let i = 0; i < lengths.length; i++) {
      if (currentLength + lengths[i] / 2 >= targetLength) {
        splitIndex = i;
        break;
      }
      currentLength += lengths[i];
    }
    
    // Ensure at least one item per row
    if (splitIndex === 0) splitIndex = 1;
    if (splitIndex >= items.length) splitIndex = items.length - 1;
    
    return [items.slice(0, splitIndex), items.slice(splitIndex)];
  };

  const summaryRows = splitIntoBalancedRows(summaries);

  return (
    <div 
      className="relative z-40 bg-[var(--color-primary-500)]/10 dark:bg-[var(--color-primary-500)]/15 border-b border-[var(--color-primary-500)]/20"
      style={{ minHeight: 32 }}
    >
      {/* Sticky container - stays at left edge like checkboxes */}
      <div className="sticky left-0 z-10 flex items-start w-fit max-w-full bg-[var(--color-primary-500)]/10 dark:bg-[var(--color-primary-500)]/15 pr-3">
        {/* Selection Container */}
        <div className="flex-shrink-0 px-1 py-1">
        <SelectionContainer
          selectedCount={selectedCount}
          selectionSort={selectionSort}
          onSortChange={onSortChange}
          onClearSelection={onClearSelection}
          onSelectAllFiltered={onSelectAllFiltered}
          onDeleteSelected={onDeleteSelected}
          filteredCount={filteredCount}
          totalCount={totalCount}
          columns={columns}
          selectedRowIds={selectedRowIds}
          rows={rows}
          readOnly={readOnly}
        />
      </div>
      
      {/* Summary - two rows layout */}
      {summaries.length > 0 && (
        <div className="text-xs text-[var(--color-primary-700)] dark:text-[var(--color-primary-300)] py-1.5 ml-[10px]">
          {summaryRows.map((row, rowIdx) => (
            <div key={rowIdx} className="flex gap-x-3">
              {row.map((s, i) => (
                <span key={i} className="whitespace-nowrap">
                  <span className="font-medium">{s.columnName}:</span>{' '}
                  <span>{s.summary}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
};

export default SelectionSummaryBar;
