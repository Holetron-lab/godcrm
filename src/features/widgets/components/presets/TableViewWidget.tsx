import { useState, type ReactNode } from 'react';
import { CaptionedMedia } from '@/shared/components/CaptionedMedia';
import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff, Lock, LockOpen, MoreHorizontal, Table2 } from 'lucide-react';
import { DropdownMenu } from '@/shared/components/ui/DropdownMenu';
import { WidgetCellEditor, canEditWidgetColumn } from './WidgetCellEditor';
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
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import { PublicAttachmentPlaceholder } from '@/features/public/PublicAttachmentPlaceholder';

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
      return <RollupCell value={value} config={config} rowData={rowData} columns={columns} />;
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
export function TableViewWidget({ widget, data, columnsInfo, relationData, tableConfig, onRowClick, onRowDoubleClick, onConfigChange, onCellUpdate, savingConfig, tableColumns }: TableViewWidgetProps) {
  const publicReadOnly = useIsPublicReadOnly();
  const [sort, setSort] = useState<{ column: string; order: 'asc' | 'desc' } | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; column: string } | null>(null);
  const canConfigure = !!onConfigChange && !publicReadOnly;


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

  // Determine which columns to show:
  // 1. If widget config has visible_columns - use those
  // 2. Otherwise use schema order, independent of the table visibility
  // 3. Fallback to data keys
  let columns: string[];
  
  if (configVisibleColumns.length > 0) {
    // Use widget-configured columns
    columns = configVisibleColumns;
  } else if (safeColumnsInfo.length > 0) {
    // Table visibility belongs to the table, not this widget.
    columns = [...safeColumnsInfo]
      .sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999))
      .map(col => col.name);
  } else {
    // Fallback to data keys
    columns = Object.keys(rows[0]?.data || {})
      .filter(k => !k.startsWith('_') && k !== 'id' && k !== 'table_id' && k !== 'created_at' && k !== 'updated_at');
  }

  columns = columns.filter(name => isWidgetColumnVisible(config || {}, name));
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
    <div tabIndex={0} className="h-full overflow-auto rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--text-primary)]">
      {columns.length === 0 && <p className="p-4 text-sm text-[var(--text-secondary)]">Все колонки скрыты. Откройте «Видимость колонок в виджете».</p>}
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
          <tr>
            {columns.map((col) => {
              const type = getColumnType(col);
              const emoji = typeEmojiMap[type] || '📝';
              const width = getColumnWidth(col);
              const displayName = getDisplayName(col);
              
              return (
                <th
                  key={col}
                  aria-sort={sort?.column === col ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
                  style={width ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
                  className="px-4 py-3 text-left border-r border-[var(--border-primary)] last:border-r-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg" title={type}>
                      {emoji}
                    </span>
                    <span className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
                      {displayName}
                    </span>
                    <button type="button" disabled={!!editing} aria-label={`Сортировка: ${displayName}`} title="По возрастанию → по убыванию → сброс" className="ml-auto p-1 rounded hover:bg-[var(--bg-tertiary)]"
                      onClick={() => setSort(current => current?.column !== col ? { column: col, order: 'asc' } : current.order === 'asc' ? { column: col, order: 'desc' } : null)}>
                      {sort?.column === col ? (sort.order === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} />}
                    </button>
                    {canConfigure && <DropdownMenu trigger={<button type="button" disabled={savingConfig || !!editing} aria-label={`Меню колонки: ${displayName}`} className="p-1 rounded hover:bg-[var(--bg-tertiary)]"><MoreHorizontal size={16} /></button>}
                      items={[
                        { value: 'hide', label: 'Скрыть в виджете', icon: <EyeOff size={14} />, onSelect: () => onConfigChange?.({ hidden_columns: [...(config?.hidden_columns || []), col] }) },
                        ...(onCellUpdate && tableColumns?.some(c => c.name === col && canEditWidgetColumn(c)) && config?.actions?.edit !== false ? [{
                          value: 'edit', label: config?.editable_columns?.includes(col) ? 'Заблокировать колонку' : 'Активная колонка',
                          icon: config?.editable_columns?.includes(col) ? <LockOpen size={14} /> : <Lock size={14} />,
                          active: config?.editable_columns?.includes(col),
                          onSelect: () => onConfigChange?.({ editable_columns: config?.editable_columns?.includes(col) ? config.editable_columns.filter(name => name !== col) : [...(config?.editable_columns || []), col] }),
                        }] : []),
                      ]} />}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
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
              className={`border-b border-[var(--border-secondary)] last:border-none hover:bg-[var(--bg-tertiary)] transition-colors ${onRowClick || onRowDoubleClick ? 'cursor-pointer' : ''}`}
              style={{
                minHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${minRowHeight}px`,
                maxHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${maxRowHeight}px`,
                height: fixedRowHeight ? `${fixedRowHeight}px` : undefined,
                overflow: fixedRowHeight ? 'hidden' : undefined,
              }}
            >
              {columns.map((col) => {
                const value = row.data[col] ?? row[col];
                const type = getColumnType(col);
                const config = getColumnConfig(col);
                const width = getColumnWidth(col);
                const schemaColumn = tableColumns?.find(c => c.name === col);
                const active = !publicReadOnly && widget.config?.actions?.edit !== false && widget.config?.editable_columns?.includes(col) && !!onCellUpdate && !!schemaColumn && canEditWidgetColumn(schemaColumn) && row.id != null;
                const isEditing = active && editing?.rowId === String(row.id) && editing.column === col;
                // Prepare rowData for rollup formulas
                const cellRowData = row.data || row;
                
                return (
                  // Editable cells retain table semantics and support Enter/Space.
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
                  <td
                    key={col}
                    tabIndex={active ? 0 : undefined}
                    aria-label={active ? `Редактировать: ${getDisplayName(col)}` : undefined}
                    onClick={event => {
                      if (!active) return;
                      event.stopPropagation();
                      if (editing || (event.target as HTMLElement).closest('a, button, input, textarea, select, form')) return;
                      setEditing({ rowId: String(row.id), column: col });
                    }}
                    onDoubleClick={event => { if (active) event.stopPropagation(); }}
                    onKeyDown={event => {
                      if (!active || event.target !== event.currentTarget || editing) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault(); event.stopPropagation();
                        setEditing({ rowId: String(row.id), column: col });
                      }
                    }}
                    style={{
                      ...(width ? { width: `${width}px`, minWidth: `${width}px` } : {}),
                      minHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${minRowHeight}px`,
                      maxHeight: fixedRowHeight ? `${fixedRowHeight}px` : `${maxRowHeight}px`,
                      height: fixedRowHeight ? `${fixedRowHeight}px` : undefined,
                      overflowY: fixedRowHeight ? 'hidden' : 'auto',
                    }}
                    className="px-4 py-2 border-r border-[var(--border-primary)] last:border-r-0 overflow-hidden"
                  >
                    {isEditing && schemaColumn ? <WidgetCellEditor column={schemaColumn} value={value}
                      onSave={next => onCellUpdate!(String(row.id), col, next)} onClose={() => setEditing(null)} /> : renderCell(value, type, config, cellRowData, relationData, publicReadOnly, safeColumnsInfo)}

                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
