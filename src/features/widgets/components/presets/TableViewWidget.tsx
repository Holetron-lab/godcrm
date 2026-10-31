import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CaptionedMedia } from '@/shared/components/CaptionedMedia';
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, EyeOff, Lock, LockOpen, MoreVertical, Table2 } from 'lucide-react';
import { DropdownMenu } from '@/shared/components/ui/DropdownMenu';
import { CellEditor } from '@/features/tables/components/UniversalTable/CellEditor';
import { getRowColorStyle } from '@/features/tables/utils/rowColorStyle';
import { isWidgetColumnVisible } from './WidgetColumnVisibility';
import type { WidgetConfig } from '../../types/widget.types';
import type { ColumnModel } from '../../../tables/types/table.types';
import { ProcurementWidget } from './procurement/ProcurementWidget';
import type { PresetWidgetProps } from '../../types/widget.types';
import type { ColumnType } from '../../../../shared/types';
import type { ColumnConfig } from '../../../tables/types/table.types';
import {
  ImageCell,
  TextCell,
  NumberCell,
  CheckboxCell,
  DateCell,
  SelectCell,
  MultiSelectCell,
  PasswordCell,
  EmailCell,
  UrlCell,
  PhoneCell,
  RollupCell,
  JsonCell,
  JsonTableCell
} from '../../../tables/components/cells';
import { resolveAttachmentUrl } from '../../../tables/components/cells/attachmentValue';
import { resolveLens } from '../../../tables/utils/resolveLens';
import type { TicketRowData } from '../../hooks/useTicketData';
import { canEditWidgetColumn } from '../../hooks/useWidgetTableControls';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import { PublicAttachmentPlaceholder } from '@/features/public/PublicAttachmentPlaceholder';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// Relation data map type
type RelationDataMap = Map<string, Map<string, { label: string; color?: string }>>;

// Column info passed from parent with real types from schema
export interface ColumnInfo {
  name: string;
  displayName?: string;
  type: string;
  config?: ColumnConfig & { relatedTableId?: number };
  isVisible?: boolean;
  orderIndex?: number;
  width?: number;
}

// Fallback type inference when columnsInfo is not provided
const inferColumnType = (columnName: string, value: unknown): ColumnType | 'date' => {
  const lowerName = columnName.toLowerCase();
  
  if (lowerName.includes('email')) return 'email';
  if (lowerName.includes('url') || lowerName.includes('link')) return 'url';
  if (lowerName.includes('phone') || lowerName.includes('tel')) return 'phone';
  if (lowerName.includes('date') && !lowerName.includes('time')) return 'date';
  if (lowerName.includes('datetime') || lowerName.includes('timestamp')) return 'datetime';
  if (lowerName.includes('password') || lowerName.includes('secret')) return 'password';
  
  // По значению
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  
  return 'text';
};

// Emoji для типов колонок
const typeEmojiMap: Partial<Record<string, string>> = {
  text: '📝',
  number: '🔢',
  email: '✉️',
  url: '🔗',
  phone: '📞',
  date: '📅',
  datetime: '⏱️',
  checkbox: '☑️',
  select: '🎯',
  'multi-select': '🧩',
  password: '🔐',
  formula: '∑',
  relation: '🫱🏻‍🫲🏽',
  person: '👤',
  file: '📎',
  rollup: '📊',
  image: '🖼️',
  content: '🖼️'
};

// Форматирование имени колонки (из snake_case в Title Case)
const formatColumnName = (name: string): string => {
  return name
    .split('_')
    .filter(Boolean)
    .map(word => (word.charAt(0)?.toUpperCase() ?? '') + word.slice(1).toLowerCase())
    .join(' ');
};

// Рендеринг ячейки в зависимости от типа
const renderCell = (
  value: unknown,
  type: string,
  config?: ColumnInfo['config'],
  rowData?: Record<string, unknown>,
  relationData?: RelationDataMap,
  publicReadOnly = false,
  columns?: ColumnInfo[],
  canEditRollupSource?: (sourceKey: string) => boolean,
  onRollupSourceEdit?: (sourceKey: string, source: HTMLButtonElement) => void,
): ReactNode => {
  // ADR-0060 AC13: public viewer cannot resolve authenticated uploads,
  // so render a non-fetching placeholder instead of <img>/<a>.
  if (publicReadOnly && (type === 'image' || type === 'file' || type === 'attachment' || type === 'content')) {
    const variant = type === 'image' ? 'image' : type === 'file' ? 'file' : 'attachment';
    return <PublicAttachmentPlaceholder value={value} variant={variant} />;
  }
  // FIRST: Check if this column has relation config (regardless of type).
  // ADR-205 D4: the same `resolveLens` as the grid, fed by the widget's per-table map.
  const relatedTableId = config?.relatedTableId || config?.relation?.tableId;
  if (relatedTableId && relationData) {
    if (value === null || value === undefined) {
      return <span className="text-[var(--text-tertiary)]">—</span>;
    }
    const tableMap = relationData.get(String(relatedTableId));
    if (tableMap) {
      const relation = { enabled: true, tableId: String(relatedTableId), ...config?.relation };
      const lensed = resolveLens(value, relation, tableMap, 'auto');
      // Image lens: the related row holds the path suffix, the column's prefix builds the URL.
      if (type !== 'image') {
        return (
          <div className="flex flex-wrap gap-1">
            {lensed.items.map((item, i) => (
              <span
                key={i}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                style={{
                  backgroundColor: item.color ? `${item.color}20` : 'var(--bg-tertiary)',
                  color: item.color || 'var(--text-secondary)',
                  border: item.color ? `1px solid ${item.color}40` : '1px solid var(--border-primary)'
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
        );
      }
      value = lensed.value;
    }
  }

  // Regular rendering by column type
  switch (type) {
    case 'textarea':
    case 'long_text':
    case 'richText':
    case 'text':
      return <TextCell value={value} cellFormat={config?.cellFormat} textConfig={config?.text} rowData={rowData} />;
    case 'number':
      return <NumberCell value={value} />;
    case 'email':
      return <EmailCell value={value} />;
    case 'url':
      return <UrlCell value={value} />;
    case 'phone':
      return <PhoneCell value={value} />;
    case 'date':
    case 'datetime':
      return <DateCell value={value} showTime={type === 'datetime'} displayFormat={config?.date?.displayFormat} storageFormat={config?.date?.storageFormat} mode={config?.date?.mode} />;
    case 'checkbox':
      return <CheckboxCell value={value} />;
    case 'password':
      return <PasswordCell value={value} />;
    case 'select':
      return <SelectCell value={value} options={config?.options || []} />;
    case 'multi-select':
      return <MultiSelectCell value={value} options={config?.options || []} />;
    case 'relation':
      // Fallback for relation type without loaded data
      return <TextCell value={value} />;
    case 'rollup':
      return <RollupCell value={value} config={config} rowData={rowData} columns={columns} canEditSource={canEditRollupSource} onSourceEdit={onRollupSourceEdit} />;
    case 'json':
      return config?.json?.cellView === 'table'
        ? <JsonTableCell value={value} config={config.json} />
        : <JsonCell value={value} config={config?.json} />;
    case 'content': {
      let items: unknown = value;
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch { return <TextCell value={value} />; }
      }
      if (!Array.isArray(items)) return <TextCell value={value} />;
      return <div className="flex flex-wrap gap-2">{items.map((item: unknown, index) => {
        if (!item || typeof item !== 'object' || !('url' in item) || typeof item.url !== 'string' || !('kind' in item)) return null;
        if (item.kind === 'image') return <span key={index}>{renderCell(item.url, 'image', config, rowData)}</span>;
        if (item.kind === 'audio' || item.kind === 'video') return <CaptionedMedia key={index} kind={item.kind} src={resolveAttachmentUrl(item.url, config?.file, rowData)} preload="none" style={{ maxHeight: config?.image?.rowHeight || 180 }} />;
        return null;
      })}</div>;
    }
    case 'image':
      return <ImageCell value={value} config={config} rowData={rowData} readOnly />;
    default:
      return <TextCell value={value} />;
  }
};

// Row height config from table settings
interface TableRowHeightConfig {
  min_row_height?: number;
  max_row_height?: number;
  fixed_row_height?: number | null;
}

// Extended props for TableViewWidget
interface TableViewWidgetProps extends PresetWidgetProps {
  isEditMode?: boolean;
  columnsInfo?: ColumnInfo[];
  relationData?: RelationDataMap;
  tableConfig?: TableRowHeightConfig | null;
  onConfigChange?: (patch: Partial<WidgetConfig>) => void;
  onCellUpdate?: (rowId: string, field: string, value: unknown) => Promise<void>;
  savingConfig?: boolean;
  tableColumns?: ColumnModel[];
  onRowClick?: (row: TicketRowData) => void;
  onRowDoubleClick?: (row: TicketRowData) => void;
}

/**
 * Table View Widget - displays table data with beautiful column headers and typed cells
 * Now supports real column types from schema via columnsInfo prop
 */
export function TableViewWidget({ widget, data, columnsInfo, relationData, tableConfig, onRowClick, onRowDoubleClick, onConfigChange, onCellUpdate, savingConfig, tableColumns, isEditMode = false }: TableViewWidgetProps) {
  const { t } = useLanguage();
  const publicReadOnly = useIsPublicReadOnly();
  const [sort, setSort] = useState<{ column: string; order: 'asc' | 'desc' } | null>(null);
  const [showHiddenTemporarily, setShowHiddenTemporarily] = useState(false);
  const [editing, setEditing] = useState<{ rowId: string; column: string; containerColumn?: string } | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);
  const editingCellRef = useRef<HTMLTableCellElement | null>(null);
  const editingSourceRef = useRef<string | null>(null);
  const showColumnControls = isEditMode && !publicReadOnly;
  const canConfigure = showColumnControls && !!onConfigChange;

  useLayoutEffect(() => {
    // Restore focus after unmounting the editor so Escape cannot trigger its blur-save.
    if (editing) return;
    const cell = editingCellRef.current;
    const sourceKey = editingSourceRef.current;
    const source = sourceKey
      ? Array.from(cell?.querySelectorAll<HTMLElement>('[data-rollup-source]') ?? []).find(element => element.dataset.rollupSource === sourceKey)
      : undefined;
    (source ?? cell)?.focus();
  }, [editing]);

  const startEditing = (rowId: string, column: string, value: unknown, cell: HTMLTableCellElement, containerColumn?: string, sourceColumn?: string) => {
    editingCellRef.current = cell;
    editingSourceRef.current = sourceColumn ?? null;
    setEditing({ rowId, column, containerColumn });
    setDraftValue(value == null ? '' : String(value));
    setSaveError('');
  };

  const closeEditor = () => {
    setEditing(null);
    setSaveError('');
  };

  const commitEdit = async (valueOverride?: string) => {
    if (!editing || !onCellUpdate || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await onCellUpdate(editing.rowId, editing.column, valueOverride !== undefined ? valueOverride : draftValue);
      closeEditor();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Не удалось сохранить. Попробуйте ещё раз.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };


  if (widget.config?.procurement) {
    if (publicReadOnly) return <p className="p-4">Поставки доступны в рабочем пространстве после входа.</p>;
    return <ProcurementWidget widget={widget} />;
  }

  const config = widget.config;
  const rows: Array<Record<string, unknown> & { id: string | number | undefined; data: Record<string, unknown> }> = (data ?? []).map((row) => {
    const fields = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? row.data as Record<string, unknown>
      : row;
    const id = row.id ?? fields.id;
    return { ...row, id: typeof id === 'string' || typeof id === 'number' ? id : undefined, data: fields };
  });

  // Row height settings from table config
  const minRowHeight = tableConfig?.min_row_height ?? 24;
  const maxRowHeight = tableConfig?.max_row_height ?? 1200;
  const fixedRowHeight = tableConfig?.fixed_row_height ?? null;
  const configVisibleColumns = config?.visible_columns || [];

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)]">
        <Table2 className="w-12 h-12 mb-2" />
        <p className="text-sm">No data available</p>
      </div>
    );
  }

  // Build column info map for easy lookup
  const columnInfoMap = new Map<string, ColumnInfo>();
  // Ensure columnsInfo is always an array
  const safeColumnsInfo = Array.isArray(columnsInfo) ? columnsInfo : [];
  if (safeColumnsInfo.length > 0) {
    safeColumnsInfo.forEach(col => columnInfoMap.set(col.name, col));
  }

  let columnCandidates: string[];
  if (safeColumnsInfo.length > 0) {
    columnCandidates = [...safeColumnsInfo]
      .sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999))
      .map(col => col.name);
  } else if (configVisibleColumns.length > 0) {
    columnCandidates = configVisibleColumns;
  } else {
    columnCandidates = Object.keys(rows[0]?.data || {})
      .filter(k => !k.startsWith('_') && k !== 'id' && k !== 'table_id' && k !== 'created_at' && k !== 'updated_at');
  }

  const isColumnVisible = (name: string) => isWidgetColumnVisible(config || {}, name) && columnInfoMap.get(name)?.isVisible !== false;
  const columns = columnCandidates.filter(isColumnVisible);
  const hiddenColumns = columnCandidates.filter(name => !isColumnVisible(name));
  const showHiddenColumns = showColumnControls && showHiddenTemporarily;
  const displayedColumns = showHiddenColumns ? [...columns, ...hiddenColumns] : columns;
  const sortedRows = sort ? [...rows].sort((a, b) => {
    const left = a.data[sort.column] ?? a[sort.column];
    const right = b.data[sort.column] ?? b[sort.column];
    const order = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true });
    return sort.order === 'asc' ? order : -order;
  }) : rows;

  // Get column type - prefer real type from columnsInfo, fallback to inference
  const getColumnType = (colName: string): string => {
    const info = columnInfoMap.get(colName);
    if (info?.type) {
      return info.type;
    }
    // Fallback to inference
    const firstValue = rows[0]?.data[colName];
    return inferColumnType(colName, firstValue);
  };

  // Get column config (for select options etc)
  const getColumnConfig = (colName: string) => {
    return columnInfoMap.get(colName)?.config;
  };

  // Get display name - prefer from columnsInfo
  const getDisplayName = (colName: string): string => {
    const info = columnInfoMap.get(colName);
    if (info?.displayName) return info.displayName;
    return formatColumnName(colName);
  };
  
  // Get column width
  const getColumnWidth = (colName: string): number | undefined => {
    return columnInfoMap.get(colName)?.width;
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll the table container.
    <div tabIndex={0} className="isolate h-full overflow-auto rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--text-primary)]">
      {columns.length === 0 && <p className="p-4 text-sm text-[var(--text-secondary)]">{t('widgets.tableControls.allColumnsHidden')}</p>}
      <table className="w-full text-sm border-collapse border-b border-[var(--border-primary)]">
        <thead className="sticky top-0 z-30 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
          <tr>
            {displayedColumns.map((col, columnIndex) => {
              const isHidden = columnIndex >= columns.length;
              const type = getColumnType(col);
              const width = getColumnWidth(col);
              const displayName = getDisplayName(col);
              const appearance = getColumnConfig(col)?.appearance;
              const indicator = appearance?.indicator;

              return (
                <Fragment key={col}>
                  {isHidden && columnIndex === columns.length && (
                    <th className="sticky top-0 z-20 w-[50px] px-2 py-1" style={{ backgroundColor: 'rgba(245, 158, 11, 0.25)' }}>
                      <button
                        type="button"
                        onClick={() => setShowHiddenTemporarily(false)}
                        className="flex items-center justify-center w-7 h-7 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-500/30 transition"
                        aria-label={t('widgets.tableControls.hideColumns')}
                        title={t('widgets.tableControls.hideColumns')}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </th>
                  )}
                  <th
                    aria-sort={!isHidden && sort?.column === col ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{
                      ...(width ? { width: `${width}px`, minWidth: `${width}px` } : {}),
                      background: isHidden
                        ? 'rgba(245, 158, 11, 0.1)'
                        : appearance?.columnColor
                          ? `linear-gradient(to right, ${appearance.columnColor}40, ${appearance.columnColor}25)`
                          : undefined,
                      ...(!isHidden && appearance?.columnColor ? { borderLeft: `3px solid ${appearance.columnColor}` } : {}),
                    }}
                    className="px-3 py-1 text-left border-r border-[var(--border-primary)] last:border-r-0"
                  >
                    <div className={`flex items-center gap-2 ${isHidden ? 'text-amber-700 dark:text-amber-300' : ''}`}>
                      <span className="text-lg" title={type} style={{ color: indicator?.color ?? appearance?.color ?? 'var(--text-secondary)' }}>
                        {indicator?.value ?? typeEmojiMap[type] ?? '📝'}
                      </span>
                      {appearance?.showHeader !== false && <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
                        {displayName}
                      </span>}
                      {showColumnControls && !isHidden && <button type="button" disabled={!!editing} aria-label={t('widgets.tableControls.sortColumn', { column: displayName })} title={t('widgets.tableControls.sortHint')} className="ml-auto p-1 rounded hover:bg-[var(--bg-tertiary)]"
                        onClick={() => setSort(current => current?.column !== col ? { column: col, order: 'asc' } : current.order === 'asc' ? { column: col, order: 'desc' } : null)}>
                        {sort?.column === col ? (sort.order === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} />}
                      </button>}
                      {canConfigure && !isHidden && <DropdownMenu trigger={<button type="button" disabled={savingConfig || !!editing} aria-label={t('widgets.tableControls.columnMenu', { column: displayName })} className="p-1 rounded hover:bg-[var(--bg-tertiary)]"><MoreVertical size={16} /></button>}
                        items={[
                          { value: 'hide', label: t('widgets.tableControls.hideInWidget'), icon: <EyeOff size={14} />, onSelect: () => onConfigChange?.({ hidden_columns: [...(config?.hidden_columns || []), col] }) },
                          ...(onCellUpdate && tableColumns?.some(c => c.name === col && canEditWidgetColumn(c)) && config?.actions?.edit !== false ? [{
                            value: 'edit', label: config?.editable_columns?.includes(col) ? t('widgets.tableControls.lockColumn') : t('widgets.tableControls.activeColumn'),
                            icon: config?.editable_columns?.includes(col) ? <LockOpen size={14} /> : <Lock size={14} />,
                            active: config?.editable_columns?.includes(col),
                            onSelect: () => onConfigChange?.({ editable_columns: config?.editable_columns?.includes(col) ? config.editable_columns.filter(name => name !== col) : [...(config?.editable_columns || []), col] }),
                          }] : []),
                        ]} />}
                    </div>
                  </th>
                </Fragment>
              );
            })}
            {showColumnControls && hiddenColumns.length > 0 && !showHiddenColumns && (
              <th className="sticky top-0 z-20 w-[50px] px-2 py-1" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)' }}>
                <button
                  type="button"
                  onClick={() => setShowHiddenTemporarily(true)}
                  className="flex items-center justify-center w-7 h-7 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition"
                  aria-label={t('widgets.tableControls.showHiddenColumns', { count: hiddenColumns.length })}
                  title={t('widgets.tableControls.showHiddenColumns', { count: hiddenColumns.length })}
                >
                  <EyeOff className="h-4 w-4" />
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="bg-[var(--bg-primary)]">
          {sortedRows.map((row, idx) => (
            <tr
              key={row.id ?? idx}
              tabIndex={onRowClick || onRowDoubleClick ? 0 : undefined}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  (onRowClick ?? onRowDoubleClick)?.(row);
                }
              }}
              onClick={() => onRowClick?.(row)}
              onDoubleClick={() => onRowDoubleClick?.(row)}
              className={`border-b border-[var(--border-secondary)] last:border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] transition-colors ${onRowClick || onRowDoubleClick ? 'cursor-pointer' : ''}`}
              style={{
                minHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${minRowHeight}px`,
                maxHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${maxRowHeight}px`,
                height: fixedRowHeight ? `${fixedRowHeight}px` : undefined,
                overflow: fixedRowHeight ? 'hidden' : undefined,
                ...getRowColorStyle(row.data, safeColumnsInfo),
              }}
            >
              {displayedColumns.map((col, columnIndex) => {
                const isHidden = columnIndex >= columns.length;
                const value = row.data[col] ?? row[col];
                const type = getColumnType(col);
                const columnConfig = getColumnConfig(col);
                const appearance = columnConfig?.appearance;
                const width = getColumnWidth(col);
                const schemaColumn = tableColumns?.find(c => c.name === col);
                const active = !isHidden && !publicReadOnly && widget.config?.actions?.edit !== false && widget.config?.editable_columns?.includes(col) && !!onCellUpdate && !!schemaColumn && canEditWidgetColumn(schemaColumn) && row.id != null;
                const isEditing = !isHidden && editing?.rowId === String(row.id) && (editing.containerColumn ?? editing.column) === col && (editing.containerColumn ? true : active);
                const editorColumn = isEditing ? tableColumns?.find(c => c.name === editing?.column) : schemaColumn;
                const cellRowData = row.data || row;
                const canEditRollupSource = (sourceName: string) => {
                  const sourceColumn = tableColumns?.find(c => c.name === sourceName);
                  return Boolean(!isHidden && !publicReadOnly && widget.config?.actions?.edit !== false && widget.config?.editable_columns?.includes(sourceName) && !!onCellUpdate && !!sourceColumn && canEditWidgetColumn(sourceColumn) && row.id != null);
                };
                const startRollupSourceEditing = (sourceName: string, cell: HTMLTableCellElement) => {
                  if (row.id == null) return;
                  startEditing(String(row.id), sourceName, cellRowData[sourceName], cell, col, sourceName);
                };

                return (
                  <Fragment key={col}>
                    {isHidden && columnIndex === columns.length && <td className="w-[50px] bg-amber-100/50 dark:bg-amber-900/30 border-l border-[var(--border-primary)]" />}
                    {/* Editable cells retain table semantics and support Enter/Space. */}
                    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
                    <td
                      tabIndex={active ? 0 : undefined}
                      aria-label={active ? t('widgets.tableControls.editCell', { column: getDisplayName(col) }) : undefined}
                      aria-busy={isEditing && saving ? true : undefined}
                      onClick={event => {
                        if (isEditing) {
                          event.stopPropagation();
                          return;
                        }
                        if (!active) return;
                        event.stopPropagation();
                        if (editing || (event.target as HTMLElement).closest('a, button, input, textarea, select, form')) return;
                        startEditing(String(row.id), col, value, event.currentTarget);
                      }}
                      onDoubleClick={event => {
                        if (editing) {
                          event.stopPropagation();
                          return;
                        }
                        if (type === 'rollup') {
                          const sourceName = (event.target as HTMLElement).closest<HTMLElement>('[data-rollup-source]')?.dataset.rollupSource;
                          if (!sourceName || !canEditRollupSource(sourceName)) return;
                          event.stopPropagation();
                          startRollupSourceEditing(sourceName, event.currentTarget);
                          return;
                        }
                        if (active) event.stopPropagation();
                      }}
                      onKeyDown={event => {
                        if (!active || event.target !== event.currentTarget || editing) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault(); event.stopPropagation();
                          startEditing(String(row.id), col, value, event.currentTarget);
                        }
                      }}
                      style={{
                        ...(width ? { width: `${width}px`, minWidth: `${width}px` } : {}),
                        minHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${minRowHeight}px`,
                        maxHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${maxRowHeight}px`,
                        height: fixedRowHeight ? `${fixedRowHeight}px` : undefined,
                        overflowY: fixedRowHeight ? 'hidden' : 'auto',
                        ...(!isHidden && appearance?.columnColor ? { backgroundColor: `${appearance.columnColor}10` } : {}),
                        color: isHidden ? undefined : appearance?.textColor || 'var(--text-primary)',
                        fontFamily: isHidden ? undefined : appearance?.fontFamily,
                        fontSize: isHidden ? undefined : appearance?.fontSize,
                        fontWeight: isHidden ? undefined : appearance?.fontWeight,
                        fontStyle: isHidden ? undefined : appearance?.fontStyle,
                        textDecoration: isHidden ? undefined : appearance?.textDecoration,
                        textAlign: isHidden ? undefined : appearance?.align,
                      }}
                      className={`${isEditing ? 'relative px-0 py-0' : 'px-4 py-2'} border-r border-[var(--border-primary)] last:border-r-0 overflow-hidden ${isHidden ? 'bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200 [&_span]:text-amber-800 dark:[&_span]:text-amber-200' : ''}`}
                    >
                      {isEditing && editorColumn ? (
                        <>
                          <div className="relative min-h-8">
                            <CellEditor
                              column={editorColumn}
                              draftValue={draftValue}
                              onDraftChange={setDraftValue}
                              onCommitEdit={commitEdit}
                              onCancelEdit={() => { if (!savingRef.current) closeEditor(); }}
                              rowData={cellRowData}
                              minRowHeight={minRowHeight}
                              fixedRowHeight={fixedRowHeight}
                            />
                          </div>
                          {saveError && <p role="alert" className="bg-[var(--bg-primary)] p-1 text-xs text-[var(--color-error)]">{saveError}</p>}
                        </>
                      ) : renderCell(
                        value,
                        type,
                        columnConfig,
                        cellRowData,
                        relationData,
                        publicReadOnly,
                        safeColumnsInfo,
                        canEditRollupSource,
                        (sourceName, source) => {
                          const cell = source.closest('td');
                          if (cell) startRollupSourceEditing(sourceName, cell);
                        },
                      )}
                    </td>
                  </Fragment>
                );
              })}
              {showColumnControls && hiddenColumns.length > 0 && !showHiddenColumns && <td className="w-[50px] bg-amber-50/20 dark:bg-amber-950/10 border-l border-[var(--border-primary)]" />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
