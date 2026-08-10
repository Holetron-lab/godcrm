/**
 * RowPickerFilters — collapsible filter strip for the attach/bind row picker
 * AND for the Tickets/Documents header panels.
 *
 * Renders one `MultiSelectFilterButton` per filterable column on the source
 * table — a compact button that opens a popover with checkbox list. Replaces
 * the previous chip-grid (every option as a chip) which got noisy on tables
 * with many options.
 *
 * Filterable column kinds:
 *   - `select` / `multi_select` with inline `config.options[]` (literal values)
 *   - `select` with `config.relation.tableId` (or `config.relatedTableId`) →
 *     dict-backed enums like tickets `type`/`state`/`priority`. Options are
 *     fetched from the dict table on demand.
 *
 * Active values are sent up as a flat `Record<columnName, string[]>` map; the
 * parent re-queries with those.
 *
 * Toggle button (`RowPickerFiltersToggle`) is a `Filter` icon with a count
 * badge — lives in the search row next to the `+` create button.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { MultiSelectFilterButton, type MultiSelectFilterOption } from './AIChatPanel/components/shared/MultiSelectFilterButton';

interface ColumnLite {
  name: string;
  displayName?: string;
  type: string;
  config?: Record<string, unknown>;
}

export type FilterMap = Record<string, string[]>;

interface RowPickerFiltersProps {
  columns: ColumnLite[];
  value: FilterMap;
  onChange: (next: FilterMap) => void;
}

function readOptions(col: ColumnLite): MultiSelectFilterOption[] {
  const cfg = (col.config || {}) as Record<string, unknown>;
  const raw = Array.isArray(cfg.options) ? cfg.options : [];
  return (raw as Array<Record<string, unknown>>).map(o => ({
    value: String(o.value ?? o.label ?? ''),
    label: String(o.label ?? o.value ?? ''),
    color: typeof o.color === 'string' ? o.color : undefined,
  })).filter(o => o.value !== '');
}

function readRelationDictId(col: ColumnLite): number | undefined {
  const cfg = (col.config || {}) as Record<string, unknown>;
  const rel = (cfg.relation || {}) as Record<string, unknown>;
  const toNum = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  return toNum(cfg.relatedTableId)
    ?? toNum(cfg.relationTableId)
    ?? toNum(cfg.target_table_id)
    ?? toNum(rel.tableId)
    ?? toNum(rel.target_table_id);
}

function RelationFilterButton({
  label, dictId, value, onChange,
}: { label: string; dictId: number; value: string[]; onChange: (next: string[]) => void }) {
  const { data: options = [] } = useQuery<MultiSelectFilterOption[]>({
    queryKey: ['row-filter-relation-options', dictId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const r = await apiClient.get<{ success: boolean; data: { rows: Array<{ id: number; data: Record<string, unknown> }> } }>(
        `/tables/${dictId}/rows?limit=200`
      );
      if (!r.success) return [];
      return (r.data.rows || []).map(row => ({
        value: String(row.id),
        label: String(row.data.name || row.data.title || row.data.label || `#${row.id}`),
        color: (row.data.color || row.data.colour) as string | undefined,
      })).filter(o => o.label !== '');
    },
  });
  return (
    <MultiSelectFilterButton
      label={label}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

export function RowPickerFilters({ columns, value, onChange }: RowPickerFiltersProps) {
  const filterableCols = useMemo(() => {
    return columns.filter(c => {
      if (c.type === 'select' || c.type === 'multi_select') {
        if (readOptions(c).length > 0) return true;
        if (c.type === 'select' && readRelationDictId(c)) return true;
        return false;
      }
      return false;
    });
  }, [columns]);

  if (filterableCols.length === 0) {
    return (
      <div className="px-2 py-2 text-[11px] text-[var(--text-tertiary)] text-center border-t border-[var(--border-secondary)]">
        Нет колонок-селектов для фильтрации
      </div>
    );
  }

  const setColumn = (col: string, next: string[]) => {
    const merged: FilterMap = { ...value };
    if (next.length === 0) delete merged[col];
    else merged[col] = next;
    onChange(merged);
  };

  return (
    <div className="px-2 py-2 flex flex-wrap gap-1.5 border-t border-[var(--border-secondary)]">
      {filterableCols.map(col => {
        const label = col.displayName || col.name;
        const dictId = readRelationDictId(col);
        const inlineOpts = readOptions(col);
        const isRelation = inlineOpts.length === 0 && !!dictId;
        const colValue = value[col.name] || [];
        const onColChange = (next: string[]) => setColumn(col.name, next);
        if (isRelation) {
          return <RelationFilterButton key={col.name} label={label} dictId={dictId!} value={colValue} onChange={onColChange} />;
        }
        return (
          <MultiSelectFilterButton
            key={col.name}
            label={label}
            options={inlineOpts}
            value={colValue}
            onChange={onColChange}
          />
        );
      })}
    </div>
  );
}

interface RowPickerFiltersToggleProps {
  open: boolean;
  setOpen: (v: boolean) => void;
  activeCount: number;
  onClear: () => void;
  /** Compact (1.5 padding) when used in narrow panel headers. */
  compact?: boolean;
  /** Slim variant matches the inbox-style toolbar: borderless, p-1, primary tint when active. */
  slim?: boolean;
}

export function RowPickerFiltersToggle({ open, setOpen, activeCount, onClear, compact, slim }: RowPickerFiltersToggleProps) {
  const padCls = slim ? 'p-1' : compact ? 'p-1.5' : 'p-2';
  const iconCls = slim || compact ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const radiusCls = slim ? 'rounded' : 'rounded-lg';
  const isActive = activeCount > 0 || open;
  const activeCls = slim
    ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]'
    : 'bg-[var(--color-primary-500)]/15 text-[var(--color-primary-400)] border-[var(--color-primary-500)]/30';
  const inactiveCls = slim
    ? 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
    : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border-[var(--border-primary)] hover:text-[var(--text-primary)]';
  const borderCls = slim ? '' : 'border';
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={open ? 'Скрыть фильтры' : 'Показать фильтры'}
        className={cn(
          padCls,
          radiusCls,
          'transition-colors flex-shrink-0 relative',
          borderCls,
          isActive ? activeCls : inactiveCls
        )}
      >
        <Filter className={iconCls} />
        {activeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 rounded-full bg-[var(--color-primary-500)] text-[9px] text-white flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>
      {activeCount > 0 && (
        <button
          type="button"
          onClick={onClear}
          title="Сбросить фильтры"
          className="p-1 rounded text-[var(--text-tertiary)] hover:text-red-400"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
