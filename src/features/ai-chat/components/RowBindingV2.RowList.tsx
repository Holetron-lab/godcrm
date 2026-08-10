/**
 * RowList — unified search + create + list renderer for any row-source tab
 * inside the chat attach popup. Used by Tasks (Tickets), Documents, and
 * Custom-favorite tabs in RowBindingV2 so they all look the same: rich rows
 * with status/priority pills, plus a "+" affordance that opens the standard
 * AddRowModal with the table's full schema.
 *
 * Self-healing: resolves stale display-name configs (e.g. statusColumn:"State")
 * by case-insensitive data lookup, back-fills missing dict-table IDs from the
 * live column metadata (so configs saved before statusDictTableId existed
 * still render pills correctly), and falls back to inline `select`-column
 * options (`config.options[]`) when no dict table is configured.
 *
 * Pagination: page-based infinite scroll via IntersectionObserver. Backend
 * returns `pagination.pages` so we know when to stop fetching.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, X, Plus, Table as TableIcon } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';
import { useTableColumns } from '@/features/tables/hooks/useTableColumns';
import { AddRowModal } from '@/features/tables/components/modals/AddRowModal';
import type { BoundRow } from './RowBindingV2';
import { RowPickerFilters, RowPickerFiltersToggle, type FilterMap } from './RowBindingV2.RowList.Filters';

interface RowInfo {
  id: number;
  table_id: number;
  data: Record<string, unknown>;
}

interface DictEntry {
  id: number | string;
  name: string;
  color?: string;
}

interface PageResult {
  rows: RowInfo[];
  page: number;
  pages: number;
}

const TITLE_ALIASES = ['title', 'what', 'name', 'subject', 'Название'];
/** Common per-row icon-column names — used when `source.iconColumn` is unset
 *  so tickets/docs that follow standard schema get their emoji "for free". */
const ICON_ALIASES = ['icon', 'emoji', 'Иконка', 'иконка'];
/** Per-row colour-column names. If the table has any of these, the left
 *  stripe is driven by the row's own colour value (gray when empty) rather
 *  than the status/priority/category dict colour. */
const COLOR_ALIASES = ['color', 'colour', 'Цвет', 'цвет'];
/** Fallback column-name aliases used when `source.{status|priority|category|description}Column`
 *  is unset. Mirrors the chat-source-presets and lets sparse `tickets_config` /
 *  `documents` configs (just `{tableId, tableName}`) still render type/status
 *  pills + description preview, instead of degrading to icon+title only. */
const STATUS_ALIASES = ['state', 'status', 'status_id'];
const PRIORITY_ALIASES = ['priority', 'priority_id'];
const CATEGORY_ALIASES = ['type', 'category', 'category_id', 'tags'];
const DESCRIPTION_ALIASES = ['why', 'description', 'summary', 'preview', 'desc'];
const PAGE_SIZE = 30;

/** Legacy — kept exported for callers; no longer rendered (per-row icon comes
 *  from `iconColumn` value or `tableIcon` fallback). */
export type RowIconKind = 'tasks' | 'documents' | 'files' | 'table';

export interface RowListSource {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  iconColumn?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  categoryColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
  categoryDictTableId?: number;
  /** @deprecated No longer used — per-row icon comes from `iconColumn` value. */
  rowIconKind?: RowIconKind;
}

interface RowListProps {
  source: RowListSource;
  enabled: boolean;
  boundRows: BoundRow[];
  maxBindings: number;
  onBind: (b: BoundRow) => void;
  searchPlaceholder?: string;
  /** When false, hide the inline "+" button (caller renders its own elsewhere). */
  showAddButton?: boolean;
}

function readField(data: Record<string, unknown>, col?: string): unknown {
  if (!col) return undefined;
  if (col in data) return data[col];
  const lower = col.toLowerCase();
  for (const key of Object.keys(data)) {
    if (key.toLowerCase() === lower) return data[key];
  }
  return undefined;
}

function getDisplayValue(row: RowInfo, source: RowListSource): string {
  const data = row.data;
  const v = readField(data, source.displayColumn);
  if (v) return String(v);
  for (const a of TITLE_ALIASES) {
    if (data[a]) return String(data[a]);
  }
  return `#${row.id}`;
}

async function fetchDict(tableId: number): Promise<DictEntry[]> {
  const r = await apiClient.get<{ success: boolean; data: { rows: Array<{ id: number; data: Record<string, unknown> }> } }>(
    `/tables/${tableId}/rows?limit=200`
  );
  if (!r.success) return [];
  return (r.data.rows || []).map(row => ({
    id: row.id,
    name: String(row.data['name'] || row.data['title'] || row.data['label'] || ''),
    color: (row.data['color'] || row.data['colour']) as string | undefined,
  }));
}

function Pill({ label, color }: { label: string; color?: string }) {
  if (!label) return null;
  const safe = color && /^#?[0-9a-f]{3,8}$/i.test(color) ? (color.startsWith('#') ? color : `#${color}`) : undefined;
  return (
    <span
      className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium leading-tight flex-shrink-0"
      style={safe
        ? { background: `${safe}22`, color: safe, border: `1px solid ${safe}44` }
        : { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-secondary)' }}
    >{label}</span>
  );
}

export function RowList({ source, enabled, boundRows, maxBindings, onBind, searchPlaceholder, showAddButton = true }: RowListProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [filters, setFilters] = useState<FilterMap>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeFilterCount = useMemo(
    () => Object.values(filters).reduce((s, arr) => s + (arr?.length || 0), 0),
    [filters]
  );

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery<PageResult>({
    queryKey: ['rowlist-rows', source.tableId, search, filters],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const page = (pageParam as number) ?? 1;
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      params.append('page', String(page));
      params.append('limit', String(PAGE_SIZE));
      const r = await apiClient.get<{ success: boolean; data: { rows: RowInfo[]; pagination?: { page: number; pages: number } } }>(
        `/tables/${source.tableId}/rows?${params}`
      );
      if (!r.success) return { rows: [], page, pages: page };
      return {
        rows: r.data.rows || [],
        page: r.data.pagination?.page ?? page,
        pages: r.data.pagination?.pages ?? page,
      };
    },
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
    enabled: enabled && !!source.tableId,
    maxPages: 10,
  });

  const rawRows: RowInfo[] = useMemo(
    () => (data?.pages || []).flatMap(p => p.rows),
    [data]
  );

  // Client-side filtering — backend search doesn't yet accept select-column
  // filters, so we narrow in-memory using the row's own cell values.
  const rows: RowInfo[] = useMemo(() => {
    if (Object.keys(filters).length === 0) return rawRows;
    return rawRows.filter(r => {
      for (const [col, allowed] of Object.entries(filters)) {
        if (!allowed || allowed.length === 0) continue;
        const v = readField(r.data, col);
        if (Array.isArray(v)) {
          const matches = v.map(x => String(x));
          if (!allowed.some(a => matches.includes(a))) return false;
        } else {
          if (!allowed.includes(String(v ?? ''))) return false;
        }
      }
      return true;
    });
  }, [rawRows, filters]);

  // IntersectionObserver — fetch next page when sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root || !hasNextPage) return;
    const obs = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { root, rootMargin: '40px', threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Live ColumnModel[] — used both for dict back-fill and for AddRowModal schema.
  const { data: columns = [] } = useTableColumns(source.tableId ? String(source.tableId) : undefined);

  // Map: column-key (name OR displayName, case-insensitive) → dict tableId.
  // Recognises every config shape we've seen in the wild:
  //   - cfg.relatedTableId / cfg.relationTableId  (legacy flat)
  //   - cfg.target_table_id                       (relation column)
  //   - cfg.relation.tableId / cfg.relation.target_table_id  (nested)
  const dictByColumnKey = useMemo(() => {
    const m = new Map<string, number>();
    const toNum = (v: unknown): number | undefined => {
      const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    for (const c of columns) {
      const cfg = (c.config || {}) as Record<string, unknown>;
      const rel = (cfg?.relation || {}) as Record<string, unknown>;
      const dictId =
        toNum(cfg?.relatedTableId) ??
        toNum(cfg?.relationTableId) ??
        toNum(cfg?.target_table_id) ??
        toNum(rel?.tableId) ??
        toNum(rel?.target_table_id);
      if (!dictId) continue;
      const keys = [c.name, c.displayName].filter(Boolean) as string[];
      for (const k of keys) m.set(k.toLowerCase(), dictId);
    }
    return m;
  }, [columns]);

  // Fallback for `select`/`multi_select` columns: inline options live on
  // column.config.options as { value, label, color }. Map column-key →
  // synthetic DictEntry[] so we can use the same lookup() path as relation
  // dicts. Documents Category is the canonical case (no _categories table).
  const inlineDictByColumnKey = useMemo(() => {
    const m = new Map<string, DictEntry[]>();
    type Opt = { value?: unknown; label?: unknown; color?: unknown };
    for (const c of columns) {
      const cfg = (c.config || {}) as Record<string, unknown>;
      const opts = cfg?.options;
      if (!Array.isArray(opts) || opts.length === 0) continue;
      const dict: DictEntry[] = (opts as Opt[]).map(o => ({
        id: String(o?.value ?? o?.label ?? ''),
        name: String(o?.label ?? o?.value ?? ''),
        color: typeof o?.color === 'string' ? o.color : undefined,
      })).filter(d => d.id !== '' || d.name !== '');
      const keys = [c.name, c.displayName].filter(Boolean) as string[];
      for (const k of keys) m.set(k.toLowerCase(), dict);
    }
    return m;
  }, [columns]);

  const resolveDictId = (configured: number | undefined, col?: string): number | undefined => {
    if (configured) return configured;
    if (!col) return undefined;
    return dictByColumnKey.get(col.toLowerCase());
  };

  const inlineDictFor = (col?: string): DictEntry[] | undefined => {
    if (!col) return undefined;
    return inlineDictByColumnKey.get(col.toLowerCase());
  };

  // Pick the actual column-name to read for status/priority/category/description.
  // If `source.X` is set, use it. Otherwise look for a column whose name matches
  // one of the canonical aliases — this lets a sparse `tickets_config` (just
  // `{tableId, tableName}`) still render the full row card for tables that
  // follow the standard schema (`state`, `priority`, `type`, `why`).
  const columnNameSet = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of columns) {
      if (c.name) m.set(c.name.toLowerCase(), c.name);
      if (c.displayName) m.set(c.displayName.toLowerCase(), c.displayName);
    }
    return m;
  }, [columns]);
  const findAlias = (aliases: string[]): string | undefined => {
    for (const a of aliases) {
      const hit = columnNameSet.get(a.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  };
  const effectiveStatusCol = source.statusColumn || findAlias(STATUS_ALIASES);
  const effectivePriorityCol = source.priorityColumn || findAlias(PRIORITY_ALIASES);
  const effectiveCategoryCol = source.categoryColumn || findAlias(CATEGORY_ALIASES);
  const effectiveDescriptionCol = source.descriptionColumn || findAlias(DESCRIPTION_ALIASES);

  const statusDictId = resolveDictId(source.statusDictTableId, effectiveStatusCol);
  const priorityDictId = resolveDictId(source.priorityDictTableId, effectivePriorityCol);
  const categoryDictId = resolveDictId(source.categoryDictTableId, effectiveCategoryCol);

  // If the table has its own per-row colour column we drive the left stripe
  // from that value (gray when empty); otherwise fall back to dict colour.
  const colorColumnName = useMemo(() => {
    const names = new Set<string>();
    for (const c of columns) {
      if (c.name) names.add(c.name.toLowerCase());
      if (c.displayName) names.add(c.displayName.toLowerCase());
    }
    for (const a of COLOR_ALIASES) {
      if (names.has(a.toLowerCase())) return a;
    }
    return undefined;
  }, [columns]);

  const [statusDictRemote, setStatusDictRemote] = useState<DictEntry[]>([]);
  const [priorityDictRemote, setPriorityDictRemote] = useState<DictEntry[]>([]);
  const [categoryDictRemote, setCategoryDictRemote] = useState<DictEntry[]>([]);

  useEffect(() => {
    if (!enabled || !statusDictId) { setStatusDictRemote([]); return; }
    let cancel = false;
    fetchDict(statusDictId).then(d => { if (!cancel) setStatusDictRemote(d); });
    return () => { cancel = true; };
  }, [enabled, statusDictId]);
  useEffect(() => {
    if (!enabled || !priorityDictId) { setPriorityDictRemote([]); return; }
    let cancel = false;
    fetchDict(priorityDictId).then(d => { if (!cancel) setPriorityDictRemote(d); });
    return () => { cancel = true; };
  }, [enabled, priorityDictId]);
  useEffect(() => {
    if (!enabled || !categoryDictId) { setCategoryDictRemote([]); return; }
    let cancel = false;
    fetchDict(categoryDictId).then(d => { if (!cancel) setCategoryDictRemote(d); });
    return () => { cancel = true; };
  }, [enabled, categoryDictId]);

  const statusDict = statusDictRemote.length ? statusDictRemote : (inlineDictFor(effectiveStatusCol) || []);
  const priorityDict = priorityDictRemote.length ? priorityDictRemote : (inlineDictFor(effectivePriorityCol) || []);
  const categoryDict = categoryDictRemote.length ? categoryDictRemote : (inlineDictFor(effectiveCategoryCol) || []);

  const lookup = (dict: DictEntry[], val: unknown): DictEntry | undefined => {
    if (val == null || val === '') return undefined;
    const sval = String(val);
    const idMatch = dict.find(d => String(d.id) === sval);
    if (idMatch) return idMatch;
    const slow = sval.toLowerCase();
    return dict.find(d => d.name.toLowerCase() === slow);
  };

  const isBound = (rowId: number) =>
    boundRows.some(br => br.table_id === source.tableId && br.row_id === rowId);

  const handleSelect = (row: RowInfo) => {
    if (isBound(row.id)) return;
    if (boundRows.length >= maxBindings) return;
    onBind({
      table_id: source.tableId,
      row_id: row.id,
      table_name: source.tableName,
      table_icon: source.tableIcon || '📋',
      row_title: getDisplayValue(row, source),
    });
    setSearch('');
  };

  const handleCreateConfirm = async (data: Record<string, unknown>) => {
    try {
      await apiClient.post(`/tables/${source.tableId}/rows`, { data });
      qc.invalidateQueries({ queryKey: ['rowlist-rows', source.tableId] });
      qc.invalidateQueries({ queryKey: ['rows'] });
    } finally {
      setAddModalOpen(false);
    }
  };

  return (
    <div>
      <div className="p-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder || `Поиск в ${source.tableName}...`}
              className="w-full pl-8 pr-8 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
              ><X className="w-3 h-3" /></button>
            )}
          </div>
          <RowPickerFiltersToggle
            open={filtersOpen}
            setOpen={setFiltersOpen}
            activeCount={activeFilterCount}
            onClear={() => setFilters({})}
          />
          {showAddButton && (
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              title="Создать запись"
              className="p-2 rounded-lg transition-colors flex-shrink-0 border bg-[var(--bg-tertiary)] text-[var(--color-primary-500)] border-[var(--border-primary)] hover:bg-[var(--color-primary-500)]/10"
            ><Plus className="w-4 h-4" /></button>
          )}
        </div>
      </div>
      {filtersOpen && (
        <RowPickerFilters
          columns={columns as Array<{ name: string; displayName?: string; type: string; config?: Record<string, unknown> }>}
          value={filters}
          onChange={setFilters}
        />
      )}

      <div ref={scrollRef} className="max-h-48 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-4 text-center text-xs text-[var(--text-tertiary)]">
            {search ? 'Не найдено' : 'Нет записей'}
          </div>
        ) : (
          <>
            {rows.map(row => {
              const bound = isBound(row.id);
              const title = getDisplayValue(row, source);
              const descRaw = readField(row.data, effectiveDescriptionCol);
              const desc = typeof descRaw === 'string' ? descRaw : descRaw == null ? '' : String(descRaw);
              const status = lookup(statusDict, readField(row.data, effectiveStatusCol));
              const priority = lookup(priorityDict, readField(row.data, effectivePriorityCol));
              const category = lookup(categoryDict, readField(row.data, effectiveCategoryCol));
              const hasMeta = !!(status || priority || category || desc);
              // Left stripe colour:
              //   1. If table has a per-row `color` column → use that (gray
              //      placeholder when empty) and ignore dict colours.
              //   2. Otherwise → resolved status > priority > category colour.
              //   3. Otherwise → no stripe.
              let stripe: string | undefined;
              if (colorColumnName) {
                const rowColorRaw = readField(row.data, colorColumnName);
                const rcv = typeof rowColorRaw === 'string' ? rowColorRaw.trim() : '';
                stripe = rcv && /^#?[0-9a-f]{3,8}$/i.test(rcv)
                  ? (rcv.startsWith('#') ? rcv : `#${rcv}`)
                  : 'var(--border-secondary)';
              } else {
                const stripeRaw = status?.color || priority?.color || category?.color;
                stripe = stripeRaw && /^#?[0-9a-f]{3,8}$/i.test(stripeRaw)
                  ? (stripeRaw.startsWith('#') ? stripeRaw : `#${stripeRaw}`)
                  : undefined;
              }
              // Per-row icon: prefer the row's own iconColumn value, then
              // common alias columns (`icon`/`emoji`), then table-level icon,
              // then a neutral lucide fallback.
              let emoji = String(readField(row.data, source.iconColumn) || '').trim();
              if (!emoji) {
                for (const a of ICON_ALIASES) {
                  const v = readField(row.data, a);
                  if (v) { emoji = String(v).trim(); break; }
                }
              }
              if (!emoji) emoji = String(source.tableIcon || '').trim();
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => handleSelect(row)}
                  disabled={bound}
                  style={stripe ? { boxShadow: `inset 3px 0 0 ${stripe}` } : undefined}
                  className={cn(
                    'w-full flex items-start gap-2 px-3 py-2 text-left border-b border-[var(--border-secondary)] last:border-0',
                    bound
                      ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]'
                      : 'hover:bg-[var(--bg-tertiary)]'
                  )}
                >
                  <span className="flex-shrink-0 mt-0.5 leading-none">
                    {emoji
                      ? <span className="text-base">{emoji}</span>
                      : <TableIcon className="w-4 h-4 text-[var(--text-tertiary)]" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--text-primary)] truncate">{title}</div>
                    {hasMeta && (
                      <div className="flex items-center gap-1 mt-0.5 min-w-0">
                        {/* Type (category) first, then status — per UX request 2026-05-06 */}
                        {category && <Pill label={category.name} color={category.color} />}
                        {status && <Pill label={status.name} color={status.color} />}
                        {priority && <Pill label={priority.name} color={priority.color} />}
                        {desc && (
                          <span className="text-[10px] text-[var(--text-tertiary)] truncate flex-1 min-w-0">
                            {desc}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {bound && (
                    <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 mt-1">привязано</span>
                  )}
                </button>
              );
            })}
            {hasNextPage && (
              <div ref={sentinelRef} className="flex items-center justify-center py-3">
                {isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />}
              </div>
            )}
          </>
        )}
      </div>

      <AddRowModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onConfirm={handleCreateConfirm}
        columns={columns as Parameters<typeof AddRowModal>[0]['columns']}
        tableId={source.tableId}
        tableName={source.tableName}
      />
    </div>
  );
}
