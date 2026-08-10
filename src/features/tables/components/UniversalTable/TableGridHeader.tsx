import { EyeOff, Eye } from 'lucide-react';
import { flexRender, type Table as ReactTable } from '@tanstack/react-table';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import type { RowModel, ColumnModel } from '../../types/table.types';
import { DraggableColumnHeader } from './DraggableColumnHeader';
import { HeaderSelectionCheckbox } from './HeaderSelectionCheckbox';
import { cn } from '@/shared/utils/cn';

interface TableGridHeaderProps {
  table: ReactTable<RowModel>;
  columns: ColumnModel[];
  columnIds: string[];
  hiddenColumns: ColumnModel[];
  showHiddenTemporarily: boolean;
  setShowHiddenTemporarily: (v: boolean) => void;
  isScrolledHorizontally: boolean;
  groupByColumn: string | null;
  rawMode: boolean;
  readOnly: boolean;
  onAddColumn?: () => void;
  onOpenColumnSettings?: (columnId: string) => void;
  // Row selection
  onToggleRowSelection?: (rowId: string | number) => void;
  onSelectAllRows?: () => void;
  onDeselectAllRows?: () => void;
  isAllSelected: boolean;
  isSelectionIndeterminate: boolean;
  // Actions column presence
  hasActionsColumn: boolean;
}

export const TableGridHeader = ({
  table,
  columns,
  columnIds,
  hiddenColumns,
  showHiddenTemporarily,
  setShowHiddenTemporarily,
  isScrolledHorizontally,
  groupByColumn,
  rawMode,
  readOnly,
  onAddColumn,
  onOpenColumnSettings,
  onToggleRowSelection,
  onSelectAllRows,
  onDeselectAllRows,
  isAllSelected,
  isSelectionIndeterminate,
  hasActionsColumn,
}: TableGridHeaderProps) => {
  // flexRender unused intentionally but kept for potential future refs
  void flexRender;
  return (
    <thead
      className="sticky top-0 z-30 bg-[var(--bg-secondary)]"
      style={{
        boxShadow: '0 1px 0 0 var(--border-primary), 0 4px 30px rgba(0,0,0,0.1)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {table.getHeaderGroups().map((headerGroup) => (
        <tr key={headerGroup.id}>
          {/* Selection checkbox column header */}
          {onToggleRowSelection && (
            <th className="sticky left-0 z-40 w-7">
              <div
                className={cn(
                  'flex items-center justify-center h-full transition-opacity',
                  isScrolledHorizontally ? 'opacity-50 hover:opacity-100' : 'opacity-100'
                )}
              >
                <HeaderSelectionCheckbox
                  isAllSelected={isAllSelected}
                  isIndeterminate={isSelectionIndeterminate}
                  onSelectAll={onSelectAllRows || (() => {})}
                  onDeselectAll={onDeselectAllRows || (() => {})}
                  disabled={readOnly}
                />
              </div>
            </th>
          )}
          <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            {headerGroup.headers
              .filter(header => !groupByColumn || header.id !== groupByColumn)
              .map((header, headerIndex) => {
                const column = columns.find(col => col.id === header.id);
                return (
                  <DraggableColumnHeader
                    key={header.id}
                    header={header}
                    column={column}
                    isFirst={headerIndex === 0 && !onToggleRowSelection}
                    rawMode={rawMode}
                  />
                );
              })}
          </SortableContext>

          {/* Hidden columns toggle button */}
          {hiddenColumns.length > 0 && !showHiddenTemporarily && (
            <th
              className="sticky top-0 z-20 w-[50px] px-2 py-1"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)' }}
            >
              <button
                type="button"
                onClick={() => setShowHiddenTemporarily(true)}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition"
                title={`Показать ${hiddenColumns.length} скрытых столбцов`}
              >
                <EyeOff className="h-4 w-4" />
              </button>
            </th>
          )}

          {/* Temporarily shown hidden columns */}
          {hiddenColumns.length > 0 && showHiddenTemporarily && (
            <>
              <th
                className="sticky top-0 z-20 w-[50px] px-2 py-1"
                style={{ backgroundColor: 'rgba(245, 158, 11, 0.25)' }}
              >
                <button
                  type="button"
                  onClick={() => setShowHiddenTemporarily(false)}
                  className="flex items-center justify-center w-7 h-7 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-500/30 transition"
                  title="Скрыть столбцы"
                >
                  <Eye className="h-4 w-4" />
                </button>
              </th>
              {hiddenColumns.map((col) => (
                <th
                  key={`hidden-${col.id}`}
                  className="sticky top-0 z-20 min-w-[120px] px-3 py-1"
                  style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)' }}
                >
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                    <button
                      type="button"
                      onClick={() => onOpenColumnSettings?.(col.id)}
                      className="text-sm hover:scale-110 transition-transform cursor-pointer"
                      title={`Настройки: ${col.displayName || col.name}`}
                    >
                      {col.config?.appearance?.indicator?.value || '📋'}
                    </button>
                    <span className="text-xs font-medium truncate flex-1">
                      {rawMode ? col.name : (col.displayName || col.name)}
                    </span>
                  </div>
                </th>
              ))}
            </>
          )}

          {hasActionsColumn && (
            <th
              className="sticky top-0 right-0 z-30 w-[50px] px-2 py-1 border-r border-[var(--border-primary)] rounded-tr-xl bg-[var(--bg-secondary)]"
              style={{
                boxShadow: 'inset 1px 0 0 0 var(--border-primary), -4px 0 8px rgba(0,0,0,0.1)',
              }}
            >
              {onAddColumn && (
                <button
                  data-testid="add-column-btn"
                  type="button"
                  onClick={onAddColumn}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-lg text-[var(--text-secondary)] transition hover:bg-white/30 dark:hover:bg-white/10 hover:text-[var(--color-primary-500)]"
                  title="Add column"
                >
                  +
                </button>
              )}
            </th>
          )}
        </tr>
      ))}
    </thead>
  );
};
