import { useEffect, useMemo, useState, useRef, Fragment } from 'react';
import { flexRender, Table as ReactTable } from '@tanstack/react-table';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import type { RowModel, ColumnModel } from '../../types/table.types';
import { RowActionsMenu } from './RowActionsMenu';
import { RowSelectionCheckbox, buildRowQuickActions } from './RowSelectionCheckbox';
import { SelectionSummaryBar } from './SelectionSummaryBar';
import { TableGridHeader } from './TableGridHeader';
import { TableGridFooter } from './TableGridFooter';
import { LoadPreviousRow, LoadNextRow, LoadingSkeletonRows } from './TablePaginationRows';
import { useGroupedRows } from './useGroupedRows';
import { useColumnSummaries, useRelationOptions } from './useColumnSummaries';
import { TableGridRow } from './TableGridRow';
import { InlineNestedTable } from '../cells/InlineNestedTable';
import { useTablesStore } from '../../store/tablesStore';
import { cn } from '@/shared/utils/cn';
import { getRowColorStyle } from '../../utils/rowColorStyle';

interface TableGridProps {
  table: ReactTable<RowModel>;
  columns: ColumnModel[];
  rows: RowModel[];
  hiddenColumns?: ColumnModel[];
  editingCell: { rowId: string; columnId: string } | null;
  isLoadingMore?: boolean;
  draftValue: string;
  rowsVersion?: number; // Force re-render when cells update
  onCellDoubleClick: (rowId: string, columnId: string, initialValue: unknown) => void;
  onDraftChange: (value: string) => void;
  onCommitEdit: (valueOverride?: string) => void;
  onCancelEdit: () => void;
  onAddColumn?: () => void;
  onCellClick?: (value: unknown, columnId: string, event?: React.MouseEvent) => void;
  onCheckboxToggle?: (rowId: string, columnId: string, currentValue: unknown, config?: { trueValue?: unknown; falseValue?: unknown }) => void;
  onNumberStep?: (rowId: string, columnId: string, currentValue: unknown, direction: 1 | -1, config?: { step?: number; min?: number; max?: number }) => void;
  onEditRow?: (rowId: string) => void;
  onDuplicateRow?: (rowId: string) => void;
  onDeleteRow?: (rowId: string) => void;
  onColumnReorder?: (columnId: string, newIndex: number) => void;
  onShowColumn?: (columnId: string) => void;
  onOpenColumnSettings?: (columnId: string) => void;
  readOnly?: boolean;
  rawMode?: boolean;
  // Inline expanded tables state (from parent)
  expandedInlineTables?: Record<string, { tableId: string; filterColumn: string; filterValue: string; columnId: string }>;
  onToggleInlineTable?: (rowId: string, columnId: string, tableId: string, filterColumn: string, filterValue: string) => void;
  // Navigate to related row (open edit modal)
  onNavigateToRelatedRow?: (tableId: string, rowId: string, valueColumn?: string) => void;
  // Row selection
  selectedRowIds?: Set<string | number>;
  onToggleRowSelection?: (rowId: string | number) => void;
  onSelectAllRows?: () => void;
  onDeselectAllRows?: () => void;
  isAllSelected?: boolean;
  isSelectionIndeterminate?: boolean;
  // Selection summary bar props
  selectionSort?: 'default' | 'selected-first' | 'selected-last';
  onSelectionSortChange?: (sort: 'default' | 'selected-first' | 'selected-last') => void;
  onClearSelection?: () => void;
  onSelectAllFiltered?: () => void;
  onDeleteSelected?: () => void;
  filteredCount?: number;
  totalCount?: number;
  // Grouping
  groupByColumn?: string | null;
  // Load more
  canLoadMore?: boolean;
  onLoadMore?: () => void;
  canLoadPrevious?: boolean;
  onLoadPrevious?: () => void;
  currentPage?: number;
  rowsLimit?: number;
  totalRows?: number;
  rowsAbove?: number;
  rowsBelow?: number;
  // Row height settings
  minRowHeight?: number;
  maxRowHeight?: number;
  fixedRowHeight?: number | null;
  // Row chat
  onOpenRowChat?: (rowId: string) => void;
  onAttachRowToChat?: (rowId: string) => void;
  onAttachRowToMessage?: (rowId: string) => void;
}

export const TableGrid = ({
  table,
  columns,
  rows,
  hiddenColumns = [],
  editingCell,
  draftValue,
  rowsVersion = 0,
  onCellDoubleClick,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
  onAddColumn,
  onCellClick,
  onCheckboxToggle,
  onNumberStep,
  onEditRow,
  onDuplicateRow,
  onDeleteRow,
  onColumnReorder,
  onShowColumn,
  onOpenColumnSettings,
  readOnly = false,
  rawMode = false,
  isLoadingMore = false,
  expandedInlineTables = {},
  onToggleInlineTable,
  onNavigateToRelatedRow,
  // Row selection
  selectedRowIds,
  onToggleRowSelection,
  onSelectAllRows,
  onDeselectAllRows,
  isAllSelected = false,
  isSelectionIndeterminate = false,
  // Selection summary bar
  selectionSort = 'default',
  onSelectionSortChange,
  onClearSelection,
  onSelectAllFiltered,
  onDeleteSelected,
  filteredCount = 0,
  totalCount = 0,
  // Grouping
  groupByColumn = null,
  // Load more
  canLoadMore = false,
  onLoadMore,
  canLoadPrevious = false,
  onLoadPrevious,
  currentPage = 1,
  rowsLimit = 50,
  totalRows = 0,
  rowsAbove = 0,
  rowsBelow = 0,
  // Row height settings
  minRowHeight = 24,
  maxRowHeight = 1200,
  fixedRowHeight = null,
  // Row chat
  onOpenRowChat,
  onAttachRowToChat,
  onAttachRowToMessage
}: TableGridProps) => {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [showHiddenTemporarily, setShowHiddenTemporarily] = useState(false);
  const [isScrolledHorizontally, setIsScrolledHorizontally] = useState(false);

  // Success-flash cells (used only by the grouped read-only render path; the
  // editable ungrouped row owns its own copy via useTablesStore).
  const successCells = useTablesStore((state) => state.successCells);

  // Track horizontal scroll position
  useEffect(() => {
    const scrollContainer = tableRef.current?.closest('.overflow-x-auto');
    if (!scrollContainer) return;
    
    const handleHorizontalScroll = () => {
      const scrolled = scrollContainer.scrollLeft > 5;
      setIsScrolledHorizontally(scrolled);
    };
    
    // Initial check
    handleHorizontalScroll();
    
    scrollContainer.addEventListener('scroll', handleHorizontalScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleHorizontalScroll);
  }, []);

  // Auto-scroll right when hidden columns are shown
  useEffect(() => {
    if (showHiddenTemporarily && tableRef.current) {
      const scrollContainer = tableRef.current.closest('.overflow-auto');
      if (scrollContainer) {
        // Scroll to the right to show hidden columns
        setTimeout(() => {
          scrollContainer.scrollTo({
            left: scrollContainer.scrollWidth,
            behavior: 'smooth'
          });
        }, 100);
      }
    }
  }, [showHiddenTemporarily]);

  // Setup dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5 // Smaller distance for more responsive drag
      }
    }),
    useSensor(KeyboardSensor)
  );

  // Get column IDs for sortable context
  const columnIds = useMemo(() => (columns || []).map(col => col.id), [columns]);
  
  // Get active column for overlay
  const activeColumn = useMemo(() => 
    activeColumnId ? columns.find(col => col.id === activeColumnId) : null,
    [activeColumnId, columns]
  );

  // Load relation options for footer summaries + select column footer chips
  const relationOptionsMap = useRelationOptions(columns, rows.length);

  // Grouping: groupedRows (null when no grouping) + displayColumns (columns minus the group column)
  const { groupedRows, displayColumns } = useGroupedRows(
    rows,
    columns,
    groupByColumn,
    relationOptionsMap
  );

  const columnSummaries = useColumnSummaries(rows, columns, relationOptionsMap);

  // Whether actions column (add-column / row duplicate / row delete) is present
  const hasActionsColumn = Boolean(onAddColumn || (!readOnly && (onDuplicateRow || onDeleteRow)));

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    setActiveColumnId(String(event.active.id));
  };

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveColumnId(null);
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const oldIndex = columnIds.indexOf(String(active.id));
      const newIndex = columnIds.indexOf(String(over.id));
      
      if (oldIndex !== -1 && newIndex !== -1) {
        onColumnReorder?.(String(active.id), newIndex);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div 
        ref={tableRef}
        data-testid="table-grid"
        className="bg-[var(--bg-primary)] relative"
      >
        {/* Loading overlay when loading more pages */}
        {isLoadingMore && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)]/60 backdrop-blur-[2px]">
            <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-lg">
              <div className="w-5 h-5 border-2 border-[var(--color-primary-500)] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[var(--text-secondary)]">Загрузка...</span>
            </div>
          </div>
        )}
        
        {/* Selection Summary Bar - shows stats for selected rows */}
        {selectedRowIds && selectedRowIds.size > 0 && onSelectionSortChange && onClearSelection && onSelectAllFiltered && (
          <SelectionSummaryBar
            columns={columns}
            rows={rows}
            selectedRowIds={selectedRowIds as Set<string>}
            selectionSort={selectionSort}
            onSortChange={onSelectionSortChange}
            onClearSelection={onClearSelection}
            onSelectAllFiltered={onSelectAllFiltered}
            onDeleteSelected={onDeleteSelected}
            filteredCount={filteredCount}
            totalCount={totalCount}
            readOnly={readOnly}
          />
        )}
        
        <table className="min-w-max border-collapse text-sm border-r border-b border-[var(--border-primary)]" style={{ borderSpacing: 0, tableLayout: 'fixed' }}>
          <TableGridHeader
            table={table}
            columns={columns}
            columnIds={columnIds}
            hiddenColumns={hiddenColumns}
            showHiddenTemporarily={showHiddenTemporarily}
            setShowHiddenTemporarily={setShowHiddenTemporarily}
            isScrolledHorizontally={isScrolledHorizontally}
            groupByColumn={groupByColumn}
            rawMode={rawMode}
            readOnly={readOnly}
            onAddColumn={onAddColumn}
            onOpenColumnSettings={onOpenColumnSettings}
            onToggleRowSelection={onToggleRowSelection}
            onSelectAllRows={onSelectAllRows}
            onDeselectAllRows={onDeselectAllRows}
            isAllSelected={isAllSelected}
            isSelectionIndeterminate={isSelectionIndeterminate}
            hasActionsColumn={hasActionsColumn}
          />
        <tbody>
          <LoadPreviousRow
            canLoadPrevious={canLoadPrevious}
            rowsAbove={rowsAbove}
            isLoadingMore={isLoadingMore}
            rowsLimit={rowsLimit}
            onLoadPrevious={onLoadPrevious}
          />


          {/* Render with grouping or without */}
          {groupedRows ? (
            // Grouped rendering
            groupedRows.map((group) => {
              // Get row IDs for this group
              const groupRowIds = new Set(group.rows.map(r => r.id));
              // Filter table rows to this group
              const groupTableRows = table.getRowModel().rows.filter(r => groupRowIds.has(r.original.id));
              const totalColumns = displayColumns.length + (hiddenColumns.length > 0 ? 1 : 0) + ((onAddColumn || (!readOnly && (onDuplicateRow || onDeleteRow))) ? 1 : 0) + (onToggleRowSelection ? 1 : 0);
              
              return (
                <Fragment key={`group-${group.key}`}>
                  {/* Group header row */}
                  <tr className="bg-[var(--bg-secondary)] border-b-2 border-[var(--border-primary)]">
                    <td 
                      colSpan={totalColumns}
                      className="px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        {group.color ? (
                          <span 
                            className="px-3 py-1 rounded-lg text-sm font-medium"
                            style={{ 
                              backgroundColor: `${group.color}20`, 
                              color: group.color 
                            }}
                          >
                            {group.label}
                          </span>
                        ) : (
                          <span className="text-sm font-medium text-[var(--text-primary)]">
                            {group.label}
                          </span>
                        )}
                        <span className="text-xs text-[var(--text-tertiary)]">
                          {group.rows.length} {group.rows.length === 1 ? 'запись' : group.rows.length < 5 ? 'записи' : 'записей'}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {/* Group rows */}
                  {groupTableRows.map((row, rowIndex) => {
                    const expandedForRow = expandedInlineTables?.[row.original.id];
                    const isSelected = selectedRowIds?.has(row.original.id) ?? false;
                    
                    return (
                    <Fragment key={`${row.id}_v${rowsVersion}`}>
                    <tr
                      data-testid="table-row"
                      data-row-id={row.original.id}
                      className={cn(
                        "group/row border-b border-[var(--border-secondary)] last:border-none transition-colors"
                      )}
                      style={{
                        minHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${minRowHeight}px`,
                        maxHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${maxRowHeight}px`,
                        height: fixedRowHeight ? `${fixedRowHeight}px` : undefined,
                        overflow: fixedRowHeight ? 'hidden' : undefined,
                        ...(isSelected ? { backgroundColor: 'rgba(59, 130, 246, 0.2)' } : {}),
                        ...getRowColorStyle(row.original.data, columns)
                      }}
                    >
                      {/* Selection checkbox cell */}
                      {onToggleRowSelection && (
                        <td className="sticky left-0 z-10 w-7 overflow-visible">
                          <div className={cn(
                            "flex items-center justify-center h-full transition-opacity",
                            !isScrolledHorizontally || isSelected
                              ? "opacity-100"
                              : "opacity-0 group-hover/row:opacity-100"
                          )}>
                            <RowSelectionCheckbox
                              rowId={row.original.id}
                              isSelected={isSelected}
                              onToggle={onToggleRowSelection}
                              disabled={readOnly}
                              quickActions={buildRowQuickActions({
                                onOpenChat: onOpenRowChat ? () => onOpenRowChat(row.original.id) : undefined,
                                onAttachToChat: onAttachRowToChat ? () => onAttachRowToChat(row.original.id) : undefined,
                                onAttachToMessage: onAttachRowToMessage ? () => onAttachRowToMessage(row.original.id) : undefined,
                                onEdit: onEditRow ? () => onEditRow(row.original.id) : undefined,
                                onDuplicate: onDuplicateRow ? () => onDuplicateRow(row.original.id) : undefined,
                                onDelete: onDeleteRow ? () => onDeleteRow(row.original.id) : undefined,
                              })}
                              quickActionsPosition={rowIndex < 2 ? 'below' : 'above'}
                            />
                          </div>
                        </td>
                      )}
                      {row.getVisibleCells().filter(cell => cell.column.id !== groupByColumn).map((cell, cellIndex) => {
                        const column = columns.find(col => col.id === cell.column.id) 
                          || columns.find(col => col.name === cell.column.id);
                        
                        const isEditing =
                          editingCell?.rowId === row.original.id && editingCell?.columnId === cell.column.id;
                        const isExternal = (column as any)?.is_external;
                        const isIdColumn = column?.name.toLowerCase() === 'id';
                        const columnColor = column?.config?.appearance?.columnColor;
                        const cellKey = `${row.original.id}-${cell.column.id}`;
                        const isSuccessFlash = successCells.has(cellKey);
                        const cellWidth = cell.column.getSize();
                        
                        return (
                          <td 
                            data-testid="table-cell" 
                            key={cell.id}
                            style={{ 
                              width: cellWidth,
                              minWidth: cellWidth,
                              maxWidth: cellWidth,
                              ...(columnColor && !isSuccessFlash ? { backgroundColor: `${columnColor}10` } : {}),
                              color: column?.config?.appearance?.textColor || 'var(--text-primary)',
                              fontFamily: column?.config?.appearance?.fontFamily || undefined,
                              fontSize: column?.config?.appearance?.fontSize || undefined
                            }}
                            className={`relative border-r border-[var(--border-primary)] px-0 py-0 last:border-r-0 transition-colors duration-300 overflow-hidden ${
                              cellIndex === 0 ? 'border-l border-l-[var(--border-primary)]' : ''
                            } ${
                              isSuccessFlash ? 'bg-green-100/50 dark:bg-green-900/30' : (
                                columnColor ? '' : (
                                  isExternal ? 'bg-primary-50/20 dark:bg-primary-950/10' : 
                                  isIdColumn ? 'bg-gray-50/20 dark:bg-gray-900/10' : ''
                                )
                              )
                            }`}
                            onDoubleClick={() =>
                              !isExternal && !isIdColumn && !readOnly &&
                              onCellDoubleClick(row.original.id, cell.column.id, cell.getValue())
                            }
                          >
                            <div
                              className={`h-full w-full px-4 py-2 overflow-hidden ${
                                column?.config?.appearance?.align === 'center' ? 'text-center' :
                                column?.config?.appearance?.align === 'right' ? 'text-right' : 'text-left'
                              }`}
                              style={{
                                minHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${minRowHeight}px`,
                                maxHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${maxRowHeight}px`,
                                height: fixedRowHeight ? `${fixedRowHeight}px` : undefined,
                                // overflow:hidden (not auto): a per-cell scroll container is a
                                // composited layer that macOS/Chrome drops on repaint (blank cells);
                                // clip-to-maxHeight is the only real intent here.
                                overflowY: 'hidden',
                                display: 'flex',
                                alignItems: 'flex-start',
                                ...(column?.config?.appearance?.align === 'center' ? { justifyContent: 'center' } :
                                   column?.config?.appearance?.align === 'right' ? { justifyContent: 'flex-end' } : {}),
                                ...(column?.config?.cellFormat?.textWrap === 'nowrap' ? {
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis'
                                } : column?.config?.cellFormat?.textWrap === 'wrap' ? {
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word'
                                } : column?.config?.cellFormat?.textWrap === 'wrap-ellipsis' ? {
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical' as const,
                                } : {
                                  // Default: truncate with ellipsis
                                  whiteSpace: 'nowrap',
                                  textOverflow: 'ellipsis'
                                })
                              }}
                            >
                              <div className="w-full overflow-hidden">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                      {/* Actions column for grouped rows */}
                      {(onAddColumn || (!readOnly && (onDuplicateRow || onDeleteRow))) && (
                        <td 
                          className="sticky right-0 z-20 backdrop-blur-xl bg-white/80 dark:bg-gray-900/60 border-l border-[var(--border-primary)] w-[50px]"
                          style={{ boxShadow: 'inset 1px 0 0 0 rgba(255, 255, 255, 0.3)' }}
                        >
                          <div className="flex items-center justify-center h-full">
                            {!readOnly && (onEditRow || onDuplicateRow || onDeleteRow) && (
                              <RowActionsMenu
                                onEdit={onEditRow ? () => onEditRow(row.original.id) : undefined}
                                onDuplicate={onDuplicateRow ? () => onDuplicateRow(row.original.id) : undefined}
                                onDelete={onDeleteRow ? () => onDeleteRow(row.original.id) : undefined}
                                onOpenChat={onOpenRowChat ? () => onOpenRowChat(row.original.id) : undefined}
                                onAttachToChat={onAttachRowToChat ? () => onAttachRowToChat(row.original.id) : undefined}
                                onAttachToMessage={onAttachRowToMessage ? () => onAttachRowToMessage(row.original.id) : undefined}
                                onToggleSelection={onToggleRowSelection ? () => onToggleRowSelection(row.original.id) : undefined}
                                isSelected={isSelected}
                              />
                            )}
                          </div>
                        </td>
                      )}
                    </tr>

                    {/* Inline expanded table row for grouped rows */}
                    {expandedForRow && (
                      <InlineNestedTable
                        tableId={expandedForRow.tableId}
                        filterColumn={expandedForRow.filterColumn}
                        filterValue={expandedForRow.filterValue}
                        colSpan={displayColumns.length + (hiddenColumns.length > 0 ? 1 : 0) + ((onAddColumn || (!readOnly && (onDuplicateRow || onDeleteRow))) ? 1 : 0) + (onToggleRowSelection ? 1 : 0)}
                        onClose={() => onToggleInlineTable?.(row.original.id, expandedForRow.columnId, expandedForRow.tableId, expandedForRow.filterColumn, expandedForRow.filterValue)}
                      />
                    )}
                    </Fragment>
                    );
                  })}
                </Fragment>
              );
            })
          ) : (
            // Regular rendering without grouping
            table.getRowModel().rows.map((row, rowIndex) => {
              const expandedForRow = expandedInlineTables?.[row.original.id];
              const totalColumns = columns.length + (hiddenColumns.length > 0 ? 1 : 0) + ((onAddColumn || (!readOnly && (onDuplicateRow || onDeleteRow))) ? 1 : 0) + (onToggleRowSelection ? 1 : 0);

              return (
                <TableGridRow
                  key={`${row.id}_v${rowsVersion}`}
                  row={row}
                  rowIndex={rowIndex}
                  columns={columns}
                  hiddenColumns={hiddenColumns}
                  editingCell={editingCell}
                  draftValue={draftValue}
                  rowsVersion={rowsVersion}
                  onCellDoubleClick={onCellDoubleClick}
                  onDraftChange={onDraftChange}
                  onCommitEdit={onCommitEdit}
                  onCancelEdit={onCancelEdit}
                  onAddColumn={onAddColumn}
                  onCellClick={onCellClick}
                  onCheckboxToggle={onCheckboxToggle}
                  onNumberStep={onNumberStep}
                  onEditRow={onEditRow}
                  onDuplicateRow={onDuplicateRow}
                  onDeleteRow={onDeleteRow}
                  onNavigateToRelatedRow={onNavigateToRelatedRow}
                  readOnly={readOnly}
                  rawMode={rawMode}
                  isScrolledHorizontally={isScrolledHorizontally}
                  expandedForRow={expandedForRow}
                  onToggleInlineTable={onToggleInlineTable}
                  totalColumns={totalColumns}
                  selectedRowIds={selectedRowIds}
                  onToggleRowSelection={onToggleRowSelection}
                  minRowHeight={minRowHeight}
                  maxRowHeight={maxRowHeight}
                  fixedRowHeight={fixedRowHeight}
                  onOpenRowChat={onOpenRowChat}
                  onAttachRowToChat={onAttachRowToChat}
                  onAttachRowToMessage={onAttachRowToMessage}
                  groupByColumn={groupByColumn}
                  displayColumns={displayColumns}
                  showHiddenTemporarily={showHiddenTemporarily}
                />
              );
            })
          )}
          
          <LoadingSkeletonRows
            isLoadingMore={isLoadingMore}
            columns={columns}
            hasActionsColumn={hasActionsColumn}
          />

          <LoadNextRow
            canLoadMore={canLoadMore}
            rowsBelow={rowsBelow}
            isLoadingMore={isLoadingMore}
            rowsLimit={rowsLimit}
            totalRows={totalRows}
            onLoadMore={onLoadMore}
          />
        </tbody>
        
        {/* Summary Footer */}
        {rows.length > 0 && (
          <TableGridFooter
            table={table}
            columnSummaries={columnSummaries}
            hiddenColumns={hiddenColumns}
            showHiddenTemporarily={showHiddenTemporarily}
            groupByColumn={groupByColumn}
            onToggleRowSelection={onToggleRowSelection}
            hasActionsColumn={hasActionsColumn}
          />
        )}
      </table>
      </div>
      
      {/* Drag Overlay - shows floating preview of dragged column */}
      <DragOverlay dropAnimation={{
        duration: 200,
        easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)'
      }}>
        {activeColumn ? (
          <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--color-primary-500)] rounded-lg shadow-2xl text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            <GripVertical className="h-4 w-4 text-[var(--color-primary-500)]" />
            <span>{activeColumn.displayName || activeColumn.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
