/**
 * TicketsListSettings — settings panel for the `tickets_list` preset.
 *
 * Stores these knobs in `widget.config`:
 *   - filter:        {column, value?, ids?, use_owner_id?} — when set, backend
 *                    returns only matching rows; otherwise all rows.
 *                    `ids` is honoured only when `column === 'id'` and lets
 *                    the user pin several tickets in a chosen order
 *                    (ADR-0012 §4.8: comma-separated input → number[] →
 *                    array_position() ordering on the backend).
 *   - show_filters:  boolean — toggles the stats-chip + sort row in the
 *                    rendered widget header (default: true).
 *   - default_expanded: boolean — accordion rows start expanded.
 *   - default_print_mode: 'snapshot' | 'live' | 'hybrid' — what gets rendered
 *                    when the widget is printed. `snapshot` = static rendering
 *                    of the widget as currently visible; `live` = QR code
 *                    pointing at the widget URL for real-time viewing;
 *                    `hybrid` = both side-by-side (planned, foundation only).
 *
 * The /ticket atom display mode is hardcoded to `live` (snapshots remain
 * available per-atom via the InsertTicketAtomModal's own mode picker).
 *
 * For columns with a `select` type that carry a `relation` config (e.g.
 * `adr_ref`), the value editor renders an inline row-picker pulling the first
 * 50 rows from the related table (search-as-you-type).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns3, Eye, Printer } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { useUpdateWidget } from '../../../hooks/useWidgets';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import type { Widget } from '../../../types/widget.types';
import { ticketsResolveKeys } from './useTicketsResolve';
import { useLockedFields, LOCKED_TOOLTIP_RU } from '../../../utils/lockedFieldsContext';
import { LockedFieldBadge } from '../../LockedFieldBadge';

type PrintMode = 'snapshot' | 'live' | 'hybrid';

const DEFAULT_TICKETS_TABLE_ID = 1708;

interface ColumnFilter {
  column: string;
  value?: string;
  /** Multi-id pin list (only when column === 'id'). Order = render order. */
  ids?: number[];
  use_owner_id?: boolean;
}

/** Parse the free-text id input into either a single value or an ordered
 *  array of unique ids. One value → single mode (backwards-compat with the
 *  pre-multi backend). Comma/whitespace separated → manual-ids mode.
 *  Bad fragments are dropped silently — the input is loose by design.
 */
function parseIdInput(input: string): { ids?: number[]; value: string } {
  const trimmed = input.trim();
  if (!trimmed) return { value: '' };
  const parts = trimmed.split(/[\s,]+/).map(p => p.trim()).filter(Boolean);
  const seen = new Set<number>();
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    nums.push(n);
  }
  if (nums.length === 0) return { value: '' };
  if (nums.length === 1) return { value: String(nums[0]) };
  return { ids: nums, value: trimmed };
}

interface RelationConfig {
  enabled?: boolean;
  tableId?: string | number;
  valueColumn?: string;
  labelColumn?: string;
}

function readColumnFilter(widget: Widget): ColumnFilter | null {
  const raw = (widget.config as Record<string, unknown> | undefined)?.filter;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.column !== 'string' || !obj.column) return null;
  // Only honour `ids` for the `id` pseudo-column — matches backend §4.8 guard.
  let ids: number[] | undefined;
  if (obj.column === 'id' && Array.isArray(obj.ids)) {
    const cleaned: number[] = [];
    const seen = new Set<number>();
    for (const item of obj.ids) {
      const n = Number(item);
      if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
      seen.add(n);
      cleaned.push(n);
    }
    if (cleaned.length > 0) ids = cleaned;
  }
  return {
    column: obj.column,
    value: typeof obj.value === 'string' ? obj.value : undefined,
    ids,
    use_owner_id: obj.use_owner_id === true ? true : undefined,
  };
}

function resolveTicketsTableId(widget: Widget): number {
  const cfg = (widget.config || {}) as Record<string, unknown>;
  const direct = cfg.tickets_table_id;
  if (direct != null && Number.isFinite(Number(direct))) return Number(direct);
  const binding = (cfg.ticket_binding || {}) as Record<string, unknown>;
  if (binding.table_id != null && Number.isFinite(Number(binding.table_id))) {
    return Number(binding.table_id);
  }
  if (binding.tickets_table_id != null && Number.isFinite(Number(binding.tickets_table_id))) {
    return Number(binding.tickets_table_id);
  }
  return DEFAULT_TICKETS_TABLE_ID;
}

const PRINT_MODE_OPTIONS: Array<{ value: PrintMode; label: string; description: string; soon?: boolean }> = [
  { value: 'snapshot', label: 'Snapshot', description: 'Печатать виджет как видно сейчас (статичный снимок).' },
  { value: 'live', label: 'Live', description: 'Печатать QR-код со ссылкой на виджет — для просмотра в реальном времени.' },
  { value: 'hybrid', label: 'Hybrid', description: 'Снимок + QR-код рядом (скоро).', soon: true },
];

function currentPrintMode(widget: Widget): PrintMode {
  const raw = (widget.config as Record<string, unknown> | undefined)?.default_print_mode;
  if (raw === 'snapshot' || raw === 'live' || raw === 'hybrid') return raw;
  return 'snapshot';
}

function readShowFilters(widget: Widget): boolean {
  const raw = (widget.config as Record<string, unknown> | undefined)?.show_filters;
  return raw !== false;
}

function readDefaultExpanded(widget: Widget): boolean {
  return (widget.config as Record<string, unknown> | undefined)?.default_expanded === true;
}

interface RelationRowOption {
  value: string;
  label: string;
}

/** Inline picker for a single related row. Lazy-fetches up to 50 rows from
 *  the related table; supports debounced search via the standard rows query. */
function RelationRowPicker({
  relation,
  value,
  onChange,
  disabled,
}: {
  relation: RelationConfig;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const tableId = relation.tableId != null ? String(relation.tableId) : '';
  const valueCol = relation.valueColumn || 'id';
  const labelCol = relation.labelColumn || 'name';

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebounced(search), 250);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [search]);

  const { data: items = [], isLoading } = useQuery<RelationRowOption[]>({
    queryKey: ['rel-row-picker', tableId, labelCol, valueCol, debounced],
    queryFn: async () => {
      if (!tableId) return [];
      const params = new URLSearchParams({ limit: '50' });
      if (debounced) {
        params.set('search', debounced);
        params.set('searchColumns', labelCol);
      }
      const response = await apiClient.request<{
        data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      }>(`/tables/${tableId}/rows?${params.toString()}`);
      const rows = Array.isArray(response.data) ? response.data : response.data.rows || [];
      return rows.map((row) => {
        const data = (row.data && typeof row.data === 'object'
          ? row.data
          : row) as Record<string, unknown>;
        const rid = (row as { id?: string | number }).id;
        const v = valueCol === 'id'
          ? String(rid ?? data['id'] ?? '')
          : String(data[valueCol] ?? '');
        return { value: v, label: String(data[labelCol] ?? `#${v}`) };
      });
    },
    enabled: Boolean(tableId),
    staleTime: 60_000,
  });

  // Ensure the currently-saved value appears in the dropdown even if it isn't
  // in the first 50 rows (so the select doesn't silently lose its selection).
  const options = useMemo(() => {
    if (!value) return items;
    const present = items.some(opt => opt.value === value);
    if (present) return items;
    return [{ value, label: `#${value}` }, ...items];
  }, [items, value]);

  return (
    <div className="space-y-1.5">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={disabled}
        placeholder="Поиск по записям…"
        className="w-full px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[11px] disabled:opacity-60"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || isLoading}
        className="w-full px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs disabled:opacity-60"
      >
        <option value="">— любая запись —</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {isLoading && (
        <p className="text-[10px] text-[var(--text-tertiary)]">Загрузка…</p>
      )}
    </div>
  );
}

export interface TicketsListSettingsProps {
  widget: Widget;
  /** Read-only mode mirrors the BDD toggle guard in WidgetSettingsSection. */
  isReadOnly?: boolean;
}

export function TicketsListSettings({ widget, isReadOnly = false }: TicketsListSettingsProps) {
  const updateWidget = useUpdateWidget();
  const queryClient = useQueryClient();
  const printMode = useMemo(() => currentPrintMode(widget), [widget]);
  const showFilters = useMemo(() => readShowFilters(widget), [widget]);
  const defaultExpanded = useMemo(() => readDefaultExpanded(widget), [widget]);

  // ADR-0005 C-4 — fields the document author has pinned via atom-level
  // settings_override are non-editable in this rail. Outside a widget-atom
  // (e.g. global widget settings) the provider is absent and isLocked()
  // returns false for every path.
  const { isLocked } = useLockedFields();
  const filterLocked = isLocked('filter');
  const showFiltersLocked = isLocked('show_filters');
  const defaultExpandedLocked = isLocked('default_expanded');
  const printModeLocked = isLocked('default_print_mode');

  const ticketsTableId = useMemo(() => resolveTicketsTableId(widget), [widget]);
  const columnsQuery = useTableColumns(String(ticketsTableId));
  const columns = columnsQuery.data ?? [];
  const ownerKind = (widget as unknown as { owner_kind?: string }).owner_kind ?? null;
  const ownerId = (widget as unknown as { owner_id?: number }).owner_id ?? null;
  const ownerIsDocument = ownerKind === 'document';

  const persisted = useMemo(() => readColumnFilter(widget), [widget]);
  const initialFilterText = (next: ColumnFilter | null): string => {
    if (!next) return '';
    if (next.ids && next.ids.length > 0) return next.ids.join(', ');
    return next.value ?? '';
  };
  const [filterColumn, setFilterColumn] = useState<string>(persisted?.column ?? '');
  const [filterValue, setFilterValue] = useState<string>(initialFilterText(persisted));
  const [useOwnerId, setUseOwnerId] = useState<boolean>(Boolean(persisted?.use_owner_id));

  useEffect(() => {
    const next = readColumnFilter(widget);
    setFilterColumn(next?.column ?? '');
    setFilterValue(initialFilterText(next));
    setUseOwnerId(Boolean(next?.use_owner_id));
  }, [widget]);

  // Special pseudo-column: `id` — filter by ticket number (table_rows.id).
  // Backend has a dedicated branch for this (resolveTicketsController.js).
  const isIdFilter = filterColumn === 'id';
  const selectedCol = useMemo(
    () => columns.find(c => c.name === filterColumn),
    [columns, filterColumn],
  );
  const colType = isIdFilter ? 'number' : selectedCol?.type;
  const colConfig = (selectedCol?.config as Record<string, unknown> | undefined) || {};
  const relation: RelationConfig | null = useMemo(() => {
    if (isIdFilter) return null;
    const raw = colConfig.relation as RelationConfig | undefined;
    if (raw && raw.enabled === true && raw.tableId) return raw;
    return null;
  }, [colConfig, isIdFilter]);
  const colOptions: Array<{ value: string; label?: string; color?: string }> = useMemo(() => {
    if (isIdFilter || relation) return []; // id is a number field; relation overrides static options
    if (colType !== 'select' && colType !== 'multi-select') return [];
    const raw = colConfig.options;
    return Array.isArray(raw) ? (raw as Array<{ value: string; label?: string; color?: string }>) : [];
  }, [colType, colConfig, relation, isIdFilter]);
  const isSelectLike = colOptions.length > 0;
  const isCheckboxCol = colType === 'checkbox';

  const persistFilter = useCallback(
    async (next: ColumnFilter | null) => {
      if (isReadOnly) return;
      const baseConfig = { ...(widget.config as Record<string, unknown>) };
      if (next == null) {
        delete baseConfig.filter;
      } else if (next.use_owner_id) {
        baseConfig.filter = { column: next.column, use_owner_id: true };
      } else if (next.ids && next.ids.length > 0 && next.column === 'id') {
        baseConfig.filter = { column: 'id', ids: next.ids };
      } else {
        baseConfig.filter = { column: next.column, value: next.value ?? '' };
      }
      await updateWidget.mutateAsync({
        widgetId: widget.id,
        updates: { config: baseConfig },
      });
      // useUpdateWidget invalidates only widgets/list+detail keys; the
      // resolve-tickets query is keyed on widgetId alone, so we must nudge it
      // here — otherwise the panel saves but the list keeps its stale cache.
      queryClient.invalidateQueries({ queryKey: ticketsResolveKeys.byWidget(widget.id) });
    },
    [isReadOnly, queryClient, updateWidget, widget.config, widget.id],
  );

  const valueSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (valueSaveTimer.current) clearTimeout(valueSaveTimer.current);
  }, []);
  const scheduleValueSave = useCallback(
    (column: string, value: string) => {
      if (valueSaveTimer.current) clearTimeout(valueSaveTimer.current);
      valueSaveTimer.current = setTimeout(() => {
        if (column === 'id') {
          const parsed = parseIdInput(value);
          if (parsed.ids && parsed.ids.length > 0) {
            void persistFilter({ column, ids: parsed.ids });
            return;
          }
        }
        void persistFilter({ column, value });
      }, 400);
    },
    [persistFilter],
  );

  const handleColumnChange = useCallback(
    async (next: string) => {
      if (isReadOnly) return;
      setFilterColumn(next);
      if (!next) {
        setFilterValue('');
        setUseOwnerId(false);
        await persistFilter(null);
        return;
      }
      setFilterValue('');
      const keepOwner = useOwnerId && ownerIsDocument;
      setUseOwnerId(keepOwner);
      await persistFilter(keepOwner
        ? { column: next, use_owner_id: true }
        : { column: next, value: '' });
    },
    [isReadOnly, ownerIsDocument, persistFilter, useOwnerId],
  );

  const handleUseOwnerIdToggle = useCallback(
    async (checked: boolean) => {
      if (isReadOnly || !filterColumn) return;
      setUseOwnerId(checked);
      if (checked) {
        setFilterValue('');
        await persistFilter({ column: filterColumn, use_owner_id: true });
      } else {
        await persistFilter({ column: filterColumn, value: '' });
      }
    },
    [filterColumn, isReadOnly, persistFilter],
  );

  const handleValueChange = useCallback(
    (next: string) => {
      if (isReadOnly || !filterColumn || useOwnerId) return;
      setFilterValue(next);
      if (relation || isSelectLike || isCheckboxCol) {
        // Discrete value controls (relation picker, select, checkbox): save immediately.
        void persistFilter({ column: filterColumn, value: next });
      } else {
        scheduleValueSave(filterColumn, next);
      }
    },
    [filterColumn, isCheckboxCol, isReadOnly, isSelectLike, persistFilter, relation, scheduleValueSave, useOwnerId],
  );

  const handlePrintModeChange = useCallback(
    async (next: PrintMode) => {
      if (isReadOnly) return;
      if (next === printMode) return;
      await updateWidget.mutateAsync({
        widgetId: widget.id,
        updates: {
          config: {
            ...(widget.config as Record<string, unknown>),
            default_print_mode: next,
          },
        },
      });
    },
    [printMode, isReadOnly, updateWidget, widget.config, widget.id],
  );

  const handleShowFiltersToggle = useCallback(
    async (checked: boolean) => {
      if (isReadOnly) return;
      await updateWidget.mutateAsync({
        widgetId: widget.id,
        updates: {
          config: {
            ...(widget.config as Record<string, unknown>),
            show_filters: checked,
          },
        },
      });
    },
    [isReadOnly, updateWidget, widget.config, widget.id],
  );

  const handleDefaultExpandedToggle = useCallback(
    async (checked: boolean) => {
      if (isReadOnly) return;
      await updateWidget.mutateAsync({
        widgetId: widget.id,
        updates: {
          config: {
            ...(widget.config as Record<string, unknown>),
            default_expanded: checked,
          },
        },
      });
    },
    [isReadOnly, updateWidget, widget.config, widget.id],
  );

  return (
    <>
      {/* Visual: stats-chip / sort row toggle. */}
      <div className="space-y-2 pt-2 border-t border-[var(--border-secondary)]">
        <div className="flex items-center gap-2 text-sm">
          <Eye className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <span className="font-medium">Внешний вид</span>
        </div>
        <label
          title={showFiltersLocked ? LOCKED_TOOLTIP_RU : undefined}
          className={cn(
            'flex items-center gap-2 text-[11px] cursor-pointer select-none',
            (isReadOnly || showFiltersLocked) && 'opacity-60 cursor-default',
          )}
        >
          <input
            type="checkbox"
            checked={showFilters}
            onChange={(e) => { void handleShowFiltersToggle(e.target.checked); }}
            disabled={isReadOnly || updateWidget.isPending || showFiltersLocked}
            className="w-3.5 h-3.5 accent-[var(--color-primary-500)] disabled:opacity-60"
          />
          <span className="text-[var(--text-secondary)]">
            Показывать чипы статусов и сортировку
            {showFiltersLocked && <LockedFieldBadge />}
          </span>
        </label>
        <label
          title={defaultExpandedLocked ? LOCKED_TOOLTIP_RU : undefined}
          className={cn(
            'flex items-center gap-2 text-[11px] cursor-pointer select-none',
            (isReadOnly || defaultExpandedLocked) && 'opacity-60 cursor-default',
          )}
        >
          <input
            type="checkbox"
            checked={defaultExpanded}
            onChange={(e) => { void handleDefaultExpandedToggle(e.target.checked); }}
            disabled={isReadOnly || updateWidget.isPending || defaultExpandedLocked}
            className="w-3.5 h-3.5 accent-[var(--color-primary-500)] disabled:opacity-60"
          />
          <span className="text-[var(--text-secondary)]">
            Разворачивать тикеты по умолчанию
            {defaultExpandedLocked && <LockedFieldBadge />}
          </span>
        </label>
      </div>

      {/* Per-widget column filter override. Persisted as `widget.config.filter`;
          consumed by resolve-tickets backend. */}
      <div className="space-y-2 pt-2 border-t border-[var(--border-secondary)]">
        <div className="flex items-center gap-2 text-sm">
          <Columns3 className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <span className="font-medium">
            Фильтр по колонке
            {filterLocked && <LockedFieldBadge />}
          </span>
        </div>
        {filterLocked && (
          <p className="text-[10px] text-amber-500/90 leading-snug">
            Фильтр зафиксирован автором документа в этом элементе и не редактируется отсюда.
          </p>
        )}

        <div>
          <label className="block text-[11px] text-[var(--text-tertiary)] mb-1">
            Колонка{filterLocked && <LockedFieldBadge />}
          </label>
          <select
            value={filterColumn}
            onChange={(e) => { void handleColumnChange(e.target.value); }}
            disabled={isReadOnly || updateWidget.isPending || columnsQuery.isLoading || filterLocked}
            title={filterLocked ? LOCKED_TOOLTIP_RU : undefined}
            className={cn(
              'w-full px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs',
              (isReadOnly || updateWidget.isPending || columnsQuery.isLoading || filterLocked) && 'opacity-60 cursor-not-allowed',
            )}
          >
            <option value="">Без фильтра — показать все</option>
            <option value="id">id (номер тикета)</option>
            {columns.map(c => (
              <option key={c.id} value={c.name}>{c.displayName || c.name}</option>
            ))}
          </select>
        </div>

        {filterColumn && (
          <>
            {ownerIsDocument && (
              <label
                title={filterLocked ? LOCKED_TOOLTIP_RU : undefined}
                className={cn(
                  'flex items-center gap-2 text-[11px] cursor-pointer select-none',
                  (isReadOnly || filterLocked) && 'opacity-60 cursor-default',
                )}
              >
                <input
                  type="checkbox"
                  checked={useOwnerId}
                  onChange={(e) => { void handleUseOwnerIdToggle(e.target.checked); }}
                  disabled={isReadOnly || updateWidget.isPending || filterLocked}
                  className="w-3.5 h-3.5 accent-[var(--color-primary-500)] disabled:opacity-60"
                />
                <span className="text-[var(--text-secondary)]">
                  Использовать id текущего документа
                </span>
              </label>
            )}

            <div>
              <label className="block text-[11px] text-[var(--text-tertiary)] mb-1">
                Значение{filterLocked && <LockedFieldBadge />}
              </label>
              {useOwnerId && ownerIsDocument ? (
                <div className="px-2 py-1.5 rounded-md border border-dashed border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[11px] text-[var(--text-tertiary)]">
                  Значение = id текущего документа
                  {ownerId != null && (
                    <span className="ml-1 font-mono text-[var(--text-secondary)]">(#{ownerId})</span>
                  )}
                </div>
              ) : relation ? (
                <RelationRowPicker
                  relation={relation}
                  value={filterValue}
                  onChange={handleValueChange}
                  disabled={isReadOnly || updateWidget.isPending || filterLocked}
                />
              ) : isSelectLike ? (
                <select
                  value={filterValue}
                  onChange={(e) => { handleValueChange(e.target.value); }}
                  disabled={isReadOnly || updateWidget.isPending || filterLocked}
                  title={filterLocked ? LOCKED_TOOLTIP_RU : undefined}
                  className="w-full px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs disabled:opacity-60"
                >
                  <option value="">— любое значение —</option>
                  {colOptions.map((opt, i) => (
                    <option key={opt.value ?? i} value={opt.value}>
                      {opt.label || opt.value}
                    </option>
                  ))}
                </select>
              ) : isCheckboxCol ? (
                <select
                  value={filterValue}
                  onChange={(e) => { handleValueChange(e.target.value); }}
                  disabled={isReadOnly || updateWidget.isPending || filterLocked}
                  title={filterLocked ? LOCKED_TOOLTIP_RU : undefined}
                  className="w-full px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs disabled:opacity-60"
                >
                  <option value="">— любое —</option>
                  <option value="true">Да</option>
                  <option value="false">Нет</option>
                </select>
              ) : (
                <input
                  // For `id` we accept comma/space-separated lists, so the
                  // input must allow non-digit chars — keep it as plain text.
                  type={colType === 'number' && !isIdFilter ? 'number' : 'text'}
                  value={filterValue}
                  onChange={(e) => { handleValueChange(e.target.value); }}
                  disabled={isReadOnly || updateWidget.isPending || filterLocked}
                  title={filterLocked ? LOCKED_TOOLTIP_RU : undefined}
                  placeholder={isIdFilter ? 'например: 127904 или 132066, 132067, 132069' : 'введите значение…'}
                  className="w-full px-2 py-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs disabled:opacity-60"
                />
              )}
            </div>
          </>
        )}

        {isIdFilter && (
          <p className="text-[10px] text-[var(--text-tertiary)] leading-snug">
            Подсказка: вставь несколько id через запятую — порядок слева
            направо в строке = порядок сверху вниз в виджете. Один id =
            один тикет (legacy).
          </p>
        )}

        <p className="text-[10px] text-[var(--text-tertiary)] font-mono">
          {persisted
            ? persisted.use_owner_id
              ? `config.filter = {column: ${persisted.column}, use_owner_id: true}`
              : persisted.ids && persisted.ids.length > 0
                ? `config.filter = {column: ${persisted.column}, ids: [${persisted.ids.join(', ')}]}`
                : `config.filter = {column: ${persisted.column}, value: ${JSON.stringify(persisted.value ?? '')}}`
            : 'config.filter = — (показать все)'}
        </p>
      </div>

      {/* Print options: how this widget is rendered when the document is
          printed/exported. Foundation for a future print pipeline — the UI is
          live, the renderer wiring will land in a follow-up. */}
      <div className="space-y-2 pt-2 border-t border-[var(--border-secondary)]">
        <div className="flex items-center gap-2 text-sm">
          <Printer className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          <span className="font-medium">
            Параметры печати
            {printModeLocked && <LockedFieldBadge />}
          </span>
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)] leading-snug">
          Что печатать вместо виджета: статичный снимок, QR-код со ссылкой
          на live-виджет, или и то и другое.
        </p>

        <div role="radiogroup" aria-label="Режим печати виджета" className="grid grid-cols-3 gap-1.5">
          {PRINT_MODE_OPTIONS.map(opt => (
            <label
              key={opt.value}
              className={cn(
                'flex flex-col items-start gap-0.5 px-2 py-1.5 rounded-md border cursor-pointer text-[11px] transition-colors',
                printMode === opt.value
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]',
                (isReadOnly || updateWidget.isPending || printModeLocked) && 'opacity-60 cursor-not-allowed',
              )}
              title={printModeLocked ? LOCKED_TOOLTIP_RU : opt.description}
            >
              <input
                type="radio"
                name={`default-print-mode-${widget.id}`}
                value={opt.value}
                checked={printMode === opt.value}
                disabled={isReadOnly || updateWidget.isPending || printModeLocked}
                onChange={() => { void handlePrintModeChange(opt.value); }}
                className="sr-only"
                data-testid={`default-print-mode-${opt.value}`}
              />
              <span className="font-medium flex items-center gap-1">
                {opt.label}
                {opt.soon && (
                  <span className="px-1 py-px rounded bg-amber-500/20 text-amber-400 text-[9px] font-mono uppercase tracking-wide">
                    soon
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

export default TicketsListSettings;
