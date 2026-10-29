import { useEffect, useMemo, useState, useRef, Fragment } from 'react';
import { Table as ReactTable } from '@tanstack/react-table';
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
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { RowModel, ColumnModel } from '../../types/table.types';
import type { RelationsMap } from '../../utils/resolveLens';
import { SelectionSummaryBar } from './SelectionSummaryBar';
import { TableGridHeader } from './TableGridHeader';
import { TableGridFooter } from './TableGridFooter';
import { LoadPreviousRow, LoadNextRow, LoadingSkeletonRows } from './TablePaginationRows';
import { useGroupedRows } from './useGroupedRows';
import { useColumnSummaries, useRelationOptions } from './useColumnSummaries';
import { IDLE_SUMMARY, type TableSummaryState } from '../../hooks/useTableSummary';
import { TableGridRow } from './TableGridRow';

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
  // Server totals (whole filtered table / explicit selection), see useTableSummary
  tableSummary?: TableSummaryState;
  selectionSummary?: TableSummaryState;
  /** Server relation lens map of the loaded rows (ADR-205 D2); spares the footer/group lookups a download. */
  relations?: RelationsMap;
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
  relations,
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
  tableSummary = IDLE_SUMMARY,
  selectionSummary = IDLE_SUMMARY,
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
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Get column IDs for sortable context
  const columnIds = useMemo(() => (columns || []).map(col => col.id), [columns]);
  
  // Get active column for overlay
  const activeColumn = useMemo(() => 
    activeColumnId ? columns.find(col => col.id === activeColumnId) : null,
    [activeColumnId, columns]
  );

  // Relation options for footer summaries, group headers and select footer chips.
  // The server map covers the loaded rows; the related table loads only on a miss or while grouping.
  const relationOptionsMap = useRelationOptions(columns, rows.length, { relations, groupByColumn, summary: tableSummary });

  // Grouping: groupedRows (null when no grouping) + displayColumns (columns minus the group column)
  const { groupedRows, displayColumns } = useGroupedRows(
    rows,
    columns,
    groupByColumn,
    relationOptionsMap
  );

  const columnSummaries = useColumnSummaries(tableSummary, columns, relationOptionsMap);

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
            summary={selectionSummary}
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
                        <span className="text-xs text-[var(--text-secondary)]">
                          {group.rows.length} {group.rows.length === 1 ? 'запись' : group.rows.length < 5 ? 'записи' : 'записей'}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {/* Group rows */}
                  {groupTableRows.map((row, rowIndex) => {
                    const expandedForRow = expandedInlineTables?.[row.original.id];
                    return (
                      <TableGridRow
                        key={`${row.original.tableId}:${row.id}`}
                        row={row}
                        rowIndex={rowIndex}
                        columns={columns}
                        hiddenColumns={hiddenColumns}
                        editingCell={editingCell}
                        draftValue={draftValue}
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
                  key={`${row.original.tableId}:${row.id}`}
                  row={row}
                  rowIndex={rowIndex}
                  columns={columns}
                  hiddenColumns={hiddenColumns}
                  editingCell={editingCell}
                  draftValue={draftValue}
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
            key={`${columns[0]?.tableId}:${rowsVersion}:${rowsLimit}`}
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
