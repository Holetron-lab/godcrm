import { useMemo } from 'react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { ColumnModel, RowModel, ColumnOption } from '../../types/table.types';
import type { SelectionSortMode } from '../../types/selection.types';
import type { ServerColumnSummary, TableSummaryState } from '../../hooks/useTableSummary';
import { SelectionContainer } from './SelectionContainer';
import { topValueCounts, useRelationOptions } from './useColumnSummaries';

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
  /** Server totals for the explicit selection (covers selected rows that are not loaded). */
  summary: TableSummaryState;
}

interface ColumnSummary {
  columnName: string;
  summary: string;
}

const IGNORED_COLUMN_TYPES = new Set([
  'button', 'password', 'file', 'image', 'audio', 'vector',
  'table', 'relation'
]);

/**
 * Formats the server totals of one column for the selection bar
 */
function calculateColumnSummary(
  column: ColumnModel,
  values: ServerColumnSummary,
  relationOptions?: ColumnOption[]
): ColumnSummary | null {
  // Skip system columns and ignored types
  if (IGNORED_COLUMN_TYPES.has(column.type) || column.name === 'id' || column.id === 'id') {
    return null;
  }

  const columnName = column.displayName || column.name;

  // Numbers: sum, avg
  if (['number', 'integer', 'float', 'decimal'].includes(column.type)) {
    if (values.numericCount === 0 || values.avg === null) return null;
    const roundedSum = Math.round(values.sum * 100) / 100;
    const roundedAvg = Math.round(values.avg * 100) / 100;
    return {
      columnName,
      summary: `Σ${roundedSum} μ${roundedAvg}`
    };
  }

  // Checkbox: checked/unchecked count (an empty checkbox counts as unchecked)
  if (column.type === 'checkbox') {
    return {
      columnName,
      summary: `✓${values.checked} ✗${values.count - values.checked}`
    };
  }

  // Select/Multi-select: value distribution
  if (['select', 'multi-select', 'multi_select'].includes(column.type)) {
    // Show top 2 values
    const sorted = topValueCounts(values.valueCounts, 2);
    if (sorted.length === 0) return null;

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
  readOnly = false,
  summary
}: SelectionSummaryBarProps) => {
  const { t } = useLanguage();
  const selectedCount = selectedRowIds.size;

  // Relation options for select columns (ADR-205 D4: shared lookup; loads only while something is selected)
  const relationOptionsMap = useRelationOptions(columns, selectedCount);

  // Format server totals for all eligible columns
  const summaries = useMemo(() => {
    if (selectedCount === 0 || summary.status !== 'ready' || !summary.data) return [];

    const result: ColumnSummary[] = [];
    for (const col of columns) {
      const values = summary.data.columns[col.id];
      if (!values) continue;
      const relationOptions = relationOptionsMap?.get(col.id);
      const columnSummary = calculateColumnSummary(col, values, relationOptions);
      if (columnSummary) {
        result.push(columnSummary);
      }
    }
    return result;
  }, [columns, summary, selectedCount, relationOptionsMap]);

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

      {/* Summary - server totals for the selection, two rows layout */}
      {summary.status === 'loading' && (
        <div className="text-xs text-[var(--text-tertiary)] py-1.5 ml-[10px]" aria-busy="true">…</div>
      )}
      {summary.status === 'unavailable' && (
        <div className="text-xs text-[var(--text-tertiary)] py-1.5 ml-[10px]" title={summary.reason}>{t('table.summaryUnavailable')}</div>
      )}
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
