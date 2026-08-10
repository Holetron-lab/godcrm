import { useRef, useState, useCallback, Fragment } from 'react';
import { flexRender, Row as TanstackRow } from '@tanstack/react-table';
import type { RowModel, ColumnModel } from '../../types/table.types';
import { RowActionsMenu } from './RowActionsMenu';
import { RowSelectionCheckbox, buildRowQuickActions } from './RowSelectionCheckbox';
import { SelectEditor } from '../cells/SelectEditor';
import { RelationEditor } from '../cells/RelationEditor';
import { DateEditor } from '../cells/DateEditor';
import { NumberEditor } from '../cells/NumberEditor';
import { ColorEditor } from '../cells/ColorEditor';
import { JsonEditor } from '../cells/JsonEditor';
import { validateCell, getColumnValidationRules } from '../../utils/validation';
import { InlineNestedTable } from '../cells/InlineNestedTable';
import { DateCell } from '../cells/DateCell';
import { useTablesStore } from '../../store/tablesStore';
import { cn } from '@/shared/utils/cn';
import { getRowColorStyle } from '../../utils/rowColorStyle';
import { getSystemColumnRowField } from '../../utils/systemColumns';

export interface TableGridRowProps {
  row: TanstackRow<RowModel>;
  rowIndex: number;
  columns: ColumnModel[];
  hiddenColumns: ColumnModel[];
  editingCell: { rowId: string; columnId: string } | null;
  draftValue: string;
  rowsVersion: number;
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
  onNavigateToRelatedRow?: (tableId: string, rowId: string, valueColumn?: string) => void;
  readOnly: boolean;
  rawMode: boolean;
  isScrolledHorizontally: boolean;
  // Inline expanded tables
  expandedForRow?: { tableId: string; filterColumn: string; filterValue: string; columnId: string };
  onToggleInlineTable?: (rowId: string, columnId: string, tableId: string, filterColumn: string, filterValue: string) => void;
  totalColumns: number;
  // Row selection
  selectedRowIds?: Set<string | number>;
  onToggleRowSelection?: (rowId: string | number) => void;
  // Row height settings
  minRowHeight: number;
  maxRowHeight: number;
  fixedRowHeight: number | null;
  // Row chat
  onOpenRowChat?: (rowId: string) => void;
  onAttachRowToChat?: (rowId: string) => void;
  onAttachRowToMessage?: (rowId: string) => void;
  // Grouping
  groupByColumn?: string | null;
  displayColumns: ColumnModel[];
  // Hidden columns visibility
  showHiddenTemporarily: boolean;
}

export const TableGridRow = ({
  row,
  rowIndex,
  columns,
  hiddenColumns,
  editingCell,
  draftValue,
  rowsVersion,
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
  onNavigateToRelatedRow,
  readOnly,
  rawMode,
  isScrolledHorizontally,
  expandedForRow,
  onToggleInlineTable,
  totalColumns,
  selectedRowIds,
  onToggleRowSelection,
  minRowHeight,
  maxRowHeight,
  fixedRowHeight,
  onOpenRowChat,
  onAttachRowToChat,
  onAttachRowToMessage,
  groupByColumn,
  displayColumns,
  showHiddenTemporarily,
}: TableGridRowProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const isSelected = selectedRowIds?.has(row.original.id) ?? false;

  // Get success flash cells from store
  const successCells = useTablesStore((state) => state.successCells);

  // Validate current draft value
  const validateDraft = useCallback((value: string, columnId: string, rowData?: Record<string, unknown>) => {
    const column = columns.find(c => c.id === columnId);
    if (!column) return { valid: true, errors: [] as string[] };
    const rules = getColumnValidationRules(column.config as unknown as Record<string, unknown>);
    return validateCell(value, rules, rowData);
  }, [columns]);

  const hasActionsColumn = onAddColumn || (!readOnly && (onDuplicateRow || onDeleteRow));

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

        {row.getVisibleCells()
          .filter(cell => !groupByColumn || cell.column.id !== groupByColumn)
          .map((cell, cellIndex) => {
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
              onDoubleClick={groupByColumn ? (() =>
                !isExternal && !isIdColumn && !readOnly &&
                onCellDoubleClick(row.original.id, cell.column.id, cell.getValue())
              ) : undefined}
            >
              {isEditing ? (
                // Editing mode
                rawMode ? (
                  <input
                    type="text"
                    value={String(draftValue ?? '')}
                    onChange={(e) => onDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onCommitEdit(draftValue);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        onCancelEdit();
                      }
                    }}
                    onBlur={() => onCommitEdit(draftValue)}
                    autoFocus
                    className="w-full h-full px-2 py-1 text-sm bg-transparent border-none outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:ring-inset font-mono"
                  />
                ) : (column?.type === 'relation' && column.config?.relation?.enabled) ? (
                  <div className="relative h-full w-full">
                    <RelationEditor
                      value={draftValue}
                      relation={column.config.relation}
                      onChange={onDraftChange}
                      onCommit={onCommitEdit}
                      onCancel={onCancelEdit}
                      onNavigateToRow={onNavigateToRelatedRow}
                    />
                  </div>
                ) : (column?.type === 'select' && (column.config?.options || column.config?.relation?.enabled)) ? (
                  <div className="relative h-full w-full">
                    <SelectEditor
                      value={draftValue}
                      options={column.config?.options || []}
                      relation={column.config?.relation}
                      onChange={onDraftChange}
                      onCommit={onCommitEdit}
                      onCancel={onCancelEdit}
                    />
                  </div>
                ) : (column?.type === 'multi-select' && column.config?.options) ? (
                  <div className="relative h-full w-full">
                    <SelectEditor
                      value={draftValue}
                      options={column.config?.options || []}
                      relation={column.config?.relation}
                      onChange={onDraftChange}
                      onCommit={onCommitEdit}
                      onCancel={onCancelEdit}
                      multiple
                    />
                  </div>
                ) : column?.type === 'color' ? (
                  <div className="relative h-full w-full">
                    <ColorEditor
                      value={draftValue}
                      config={column.config?.color}
                      onChange={onDraftChange}
                      onCommit={onCommitEdit}
                      onCancel={onCancelEdit}
                    />
                  </div>
                ) : column?.type === 'json' ? (
                  // ADR-0017 Phase 3: JSON editor (Code/Tree/Form modes)
                  <div className="relative h-full w-full">
                    <JsonEditor
                      value={String(draftValue ?? '')}
                      config={column.config?.json}
                      onChange={onDraftChange}
                      onCommit={onCommitEdit}
                      onCancel={onCancelEdit}
                    />
                  </div>
                ) : column?.type === 'datetime' ? (
                  <div className="relative h-full w-full">
                    <DateEditor
                      value={draftValue}
                      onChange={onDraftChange}
                      onCommit={onCommitEdit}
                      onCancel={onCancelEdit}
                      showTime={column?.type === 'datetime'}
                      dateFormat={column?.config?.date?.storageFormat ?? column?.config?.date?.dateFormat ?? 'iso'}
                      mode={column?.config?.date?.mode}
                    />
                  </div>
                ) : column?.type === 'number' ? (
                  <div className="relative h-full w-full">
                    <NumberEditor
                      value={draftValue}
                      step={column?.config?.number?.step ?? 1}
                      min={column?.config?.number?.min}
                      max={column?.config?.number?.max}
                      onChange={(v) => onDraftChange(String(v))}
                      onCommit={(v) => onCommitEdit(v != null ? String(v) : undefined)}
                      onCancel={onCancelEdit}
                    />
                  </div>
                ) : (
                  <div className="relative h-full w-full">
                    <input
                      data-testid="cell-input"
                      ref={inputRef}
                      value={draftValue}
                      onChange={(event) => {
                        const newValue = event.target.value;
                        onDraftChange(newValue);
                        const result = validateDraft(newValue, cell.column.id, row.original.data);
                        setValidationError(result.valid ? null : result.errors[0] || null);
                      }}
                      onBlur={() => {
                        const result = validateDraft(draftValue, cell.column.id, row.original.data);
                        if (result.valid) {
                          setValidationError(null);
                          onCommitEdit();
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          const result = validateDraft(draftValue, cell.column.id, row.original.data);
                          if (result.valid) {
                            setValidationError(null);
                            onCommitEdit();
                          }
                        } else if (event.key === 'Escape') {
                          setValidationError(null);
                          onCancelEdit();
                        }
                      }}
                      className={`h-full w-full rounded border px-2 py-1 text-sm ${
                        validationError
                          ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                          : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
                      }`}
                    />
                    {validationError && (
                      <div className="absolute left-0 top-full z-50 mt-1 px-2 py-1 text-xs text-white bg-red-500 rounded shadow-lg whitespace-nowrap">
                        {validationError}
                      </div>
                    )}
                  </div>
                )
              ) : column?.type === 'number' && !readOnly && onNumberStep && (column?.config?.number as any)?.showStepButtons ? (
                // Number cell with +/- buttons
                (() => {
                  const colorConfig = column?.config?.number as any;
                  let buttonColor = 'var(--bg-tertiary)';
                  let textColor = 'var(--text-secondary)';

                  if (colorConfig?.stepButtonColorType === 'fixed' && colorConfig?.stepButtonColor) {
                    buttonColor = colorConfig.stepButtonColor;
                    textColor = 'white';
                  } else if (colorConfig?.stepButtonColorType === 'column' && colorConfig?.stepButtonColorColumn) {
                    const colorFromRow = row.original.data[colorConfig.stepButtonColorColumn];
                    if (colorFromRow && typeof colorFromRow === 'string') {
                      buttonColor = colorFromRow;
                      textColor = 'white';
                    }
                  }

                  return (
                    <div className="flex items-center justify-center h-full w-full group px-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNumberStep(
                            row.original.id,
                            cell.column.id,
                            cell.getValue(),
                            -1,
                            column?.config?.number
                          );
                        }}
                        style={{ backgroundColor: buttonColor, color: textColor }}
                        className="flex items-center justify-center w-6 h-6 rounded opacity-0 group-hover:opacity-100 transition-all shrink-0 hover:brightness-110"
                      >
                        <span className="text-sm font-bold">&minus;</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onCellDoubleClick(row.original.id, cell.column.id, cell.getValue() ?? '')}
                        className="flex-1 min-w-0 h-full flex items-center justify-center hover:bg-[var(--bg-tertiary)] rounded transition-colors px-2"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNumberStep(
                            row.original.id,
                            cell.column.id,
                            cell.getValue(),
                            1,
                            column?.config?.number
                          );
                        }}
                        style={{ backgroundColor: buttonColor, color: textColor }}
                        className="flex items-center justify-center w-6 h-6 rounded opacity-0 group-hover:opacity-100 transition-all shrink-0 hover:brightness-110"
                      >
                        <span className="text-sm font-bold">+</span>
                      </button>
                    </div>
                  );
                })()
              ) : groupByColumn ? (
                // Grouped mode: render cell in a div (onDoubleClick is on td)
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
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis'
                    })
                  }}
                >
                  <div className="w-full overflow-hidden">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                </div>
              ) : (
                // Non-grouped mode: render cell in a button
                <button
                  type="button"
                  className={`h-full w-full px-4 py-2 transition hover:bg-[var(--bg-tertiary)] ${
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
                    justifyContent: column?.config?.appearance?.align === 'center' ? 'center' :
                                   column?.config?.appearance?.align === 'right' ? 'flex-end' : 'flex-start',
                    ...(column?.config?.cellFormat?.textWrap === 'nowrap' ? {
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    } : column?.config?.cellFormat?.textWrap === 'wrap' ? {
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    } : column?.config?.cellFormat?.textWrap === 'wrap-ellipsis' ? {
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as const,
                      overflow: 'hidden'
                    } : {})
                  }}
                  onClick={(event) => {
                    if (column?.type === 'checkbox' && onCheckboxToggle) {
                      onCheckboxToggle(row.original.id, cell.column.id, cell.getValue(), column?.config?.checkbox);
                    } else if (
                      (column?.type === 'select' && (column.config?.options || column.config?.relation?.enabled)) ||
                      (column?.type === 'relation' && column.config?.relation?.enabled) ||
                      (column?.config?.relation?.enabled && column.config?.relation?.type === 'lookup')
                    ) {
                      onCellDoubleClick(row.original.id, cell.column.id, cell.getValue() ?? '');
                    } else {
                      onCellClick?.(cell.getValue(), cell.column.id, event);
                    }
                  }}
                  onDoubleClick={() => {
                    if (column?.type !== 'checkbox') {
                      onCellDoubleClick(row.original.id, cell.column.id, cell.getValue() ?? '');
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      onCellDoubleClick(row.original.id, cell.column.id, cell.getValue() ?? '');
                      event.preventDefault();
                    }
                  }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </button>
              )}
            </td>
          );
        })}

        {/* Spacer when hidden columns collapsed */}
        {hiddenColumns.length > 0 && !showHiddenTemporarily && (
          <td
            className="w-[50px] bg-amber-50/20 dark:bg-amber-950/10 border-l border-[var(--border-primary)]"
          />
        )}

        {/* Hidden columns data when expanded */}
        {hiddenColumns.length > 0 && showHiddenTemporarily && (
          <>
            <td className="w-[50px] bg-amber-100/50 dark:bg-amber-900/30 border-l border-[var(--border-primary)]" />
            {hiddenColumns.map((col) => {
              const sysField = getSystemColumnRowField(col.id);
              const rowAny = row.original as unknown as Record<string, unknown>;
              const cellValue = sysField
                ? rowAny[sysField] ?? rowAny[sysField === 'created_at' ? 'createdAt' : 'updatedAt'] ?? ''
                : row.original.data[col.name] ?? row.original.data[col.id] ?? '';
              return (
                <td
                  key={`hidden-cell-${col.id}`}
                  className="min-w-[100px] bg-amber-50/50 dark:bg-amber-950/20 border-l border-[var(--border-primary)] px-3 py-2"
                >
                  <span className="text-sm text-amber-800 dark:text-amber-200">
                    {sysField ? (
                      <DateCell
                        value={cellValue}
                        showTime
                        mode="datetime"
                        storageFormat="iso"
                        displayFormat="dd.MM.yyyy HH:mm"
                        rawMode={rawMode}
                      />
                    ) : (
                      String(cellValue)
                    )}
                  </span>
                </td>
              );
            })}
          </>
        )}

        {/* Actions column */}
        {hasActionsColumn && (
          <td
            className="sticky right-0 z-20 backdrop-blur-xl bg-white/80 dark:bg-gray-900/60 px-2 py-2 text-center align-middle border-l border-[var(--border-primary)]"
            style={{ boxShadow: 'inset 1px 0 0 0 rgba(255, 255, 255, 0.3), -2px 0 8px rgba(0,0,0,0.05)' }}
          >
            {!readOnly && (onEditRow || onDuplicateRow || onDeleteRow) && (
              <RowActionsMenu
                onEdit={onEditRow ? () => onEditRow(row.original.id) : undefined}
                onDuplicate={onDuplicateRow ? () => onDuplicateRow(row.original.id) : () => {}}
                onDelete={onDeleteRow ? () => onDeleteRow(row.original.id) : () => {}}
                onOpenChat={onOpenRowChat ? () => onOpenRowChat(row.original.id) : undefined}
                onAttachToChat={onAttachRowToChat ? () => onAttachRowToChat(row.original.id) : undefined}
                onAttachToMessage={onAttachRowToMessage ? () => onAttachRowToMessage(row.original.id) : undefined}
                onToggleSelection={onToggleRowSelection ? () => onToggleRowSelection(row.original.id) : undefined}
                isSelected={isSelected}
              />
            )}
          </td>
        )}
      </tr>

      {/* Inline expanded table row */}
      {expandedForRow && (
        <InlineNestedTable
          tableId={expandedForRow.tableId}
          filterColumn={expandedForRow.filterColumn}
          filterValue={expandedForRow.filterValue}
          colSpan={totalColumns}
          onClose={() => onToggleInlineTable?.(row.original.id, expandedForRow.columnId, expandedForRow.tableId, expandedForRow.filterColumn, expandedForRow.filterValue)}
        />
      )}
    </Fragment>
  );
};
