import { useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useTablesStore } from '../store/tablesStore';
import type { ColumnModel, RowModel } from '../types/table.types';

/** Per-column aggregates from POST /tables/:id/summary (whole filtered set, not the loaded page). */
export interface ServerColumnSummary {
  count: number;
  countFilled: number;
  countEmpty: number;
  countUnique: number;
  percentFilled: number;
  numericCount: number;
  sum: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  checked: number;
  unchecked: number;
  percentChecked: number;
  dateCount: number;
  earliest: string | null;
  latest: string | null;
  dateRange: number | null;
  valueCounts: Record<string, number>;
}

export interface TableSummaryData {
  total: number;
  columns: Record<string, ServerColumnSummary>;
}

export interface TableSummaryRequest {
  columnIds: string[];
  rowIds?: string[];
  searchQuery?: string;
  searchColumns?: string[];
  selectFilters?: Record<string, string[]>;
  dateFilters?: Record<string, { from?: string; to?: string }>;
}

export type TableSummaryStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface TableSummaryState {
  status: TableSummaryStatus;
  data?: TableSummaryData;
  /** Server/network message for the unavailable state (shown as a tooltip). */
  reason?: string;
  /** 'loaded' = computed in the browser over the loaded rows only (see summarizeRows). */
  scope?: 'loaded';
}

export const IDLE_SUMMARY: TableSummaryState = { status: 'idle' };

const isEmpty = (value: unknown) => value === null || value === undefined || value === '';
const isChecked = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';
const NUMBER_TYPES = new Set(['number', 'integer', 'float', 'decimal', 'order']);
const DATE_TYPES = new Set(['date', 'datetime']);
const OPTION_TYPES = new Set(['select', 'multi-select', 'multi_select', 'multiselect']);
const DAY_MS = 86_400_000;

/**
 * Totals over the rows the browser holds, in the server response shape. Used for
 * external/system sources, which POST /summary cannot aggregate; the server totals
 * stay the source of truth everywhere else.
 */
export function summarizeRows(columns: ColumnModel[], rows: RowModel[]): TableSummaryData {
  const summary: TableSummaryData = { total: rows.length, columns: {} };
  for (const column of columns) {
    const filled = rows.map((row) => row.data[column.name] ?? row.data[column.id]).filter((value) => !isEmpty(value));
    const numbers = NUMBER_TYPES.has(column.type) ? filled.map(Number).filter(Number.isFinite) : [];
    const dates = DATE_TYPES.has(column.type)
      ? filled.map((value) => new Date(String(value)).getTime()).filter((time) => !Number.isNaN(time)) : [];
    const checked = filled.filter(isChecked).length;
    const valueCounts: Record<string, number> = {};
    if (OPTION_TYPES.has(column.type)) {
      for (const value of filled) {
        for (const option of Array.isArray(value) ? value : [value]) {
          const key = String(option);
          if (key) valueCounts[key] = (valueCounts[key] ?? 0) + 1;
        }
      }
    }
    const sum = numbers.reduce((acc, n) => acc + n, 0);
    const earliest = dates.length ? Math.min(...dates) : null;
    const latest = dates.length ? Math.max(...dates) : null;
    summary.columns[column.id] = {
      count: rows.length,
      countFilled: filled.length,
      countEmpty: rows.length - filled.length,
      countUnique: new Set(filled.map((value) => (Array.isArray(value) ? value.join(',') : String(value)))).size,
      percentFilled: rows.length ? Math.round((100 * filled.length) / rows.length) : 0,
      numericCount: numbers.length,
      sum,
      avg: numbers.length ? sum / numbers.length : null,
      min: numbers.length ? Math.min(...numbers) : null,
      max: numbers.length ? Math.max(...numbers) : null,
      checked,
      unchecked: filled.length - checked,
      percentChecked: filled.length ? Math.round((100 * checked) / filled.length) : 0,
      dateCount: dates.length,
      earliest: earliest === null ? null : new Date(earliest).toISOString(),
      latest: latest === null ? null : new Date(latest).toISOString(),
      dateRange: earliest === null || latest === null ? null : (latest - earliest) / DAY_MS,
      valueCounts,
    };
  }
  return summary;
}

interface SummaryScope {
  columns: ColumnModel[];
  searchQuery?: string;
  searchColumns?: string[];
  selectFilters?: Record<string, string[]>;
  dateFilters?: Record<string, { from?: string; to?: string }>;
  /** Explicit selection; omit for the whole filtered table. An empty array is an empty selection. */
  rowIds?: Array<string | number>;
}

export interface UseTableSummaryParams extends SummaryScope {
  tableId?: string | number | null;
  enabled?: boolean;
  /** External/system sources cannot be summarized server-side; skip the request and report unavailable. */
  unsupported?: boolean;
}

// The endpoint accepts real table_columns ids only; 'id', '_created_at' and 'ext_…' are synthetic.
const isRealId = (value: string | number) => /^[1-9]\d*$/.test(String(value));

const toInstant = (date: Date) => (Number.isNaN(date.getTime()) ? undefined : date.toISOString());

/** Builds the request body; mirrors filterTableRows so server and client agree on the scope. */
export function buildSummaryRequest({ columns, searchQuery, searchColumns, selectFilters, dateFilters, rowIds }: SummaryScope): TableSummaryRequest | null {
  const columnIds = columns.map((column) => String(column.id)).filter(isRealId);
  if (!columnIds.length) return null;

  const request: TableSummaryRequest = { columnIds };
  if (rowIds) request.rowIds = rowIds.map(String).filter(isRealId);

  if (searchQuery) {
    request.searchQuery = searchQuery;
    const scoped = (searchColumns ?? []).map(String).filter(isRealId);
    if (scoped.length) request.searchColumns = scoped;
  }

  const select = Object.entries(selectFilters ?? {}).filter(([id, values]) => isRealId(id) && values.length > 0);
  if (select.length) request.selectFilters = Object.fromEntries(select.map(([id, values]) => [id, values.map(String)]));

  const dates: Record<string, { from?: string; to?: string }> = {};
  for (const [id, range] of Object.entries(dateFilters ?? {})) {
    if (!isRealId(id) || (!range.from && !range.to)) continue;
    const bounds: { from?: string; to?: string } = {};
    if (range.from) bounds.from = toInstant(new Date(range.from));
    if (range.to) {
      const end = new Date(range.to);
      end.setHours(23, 59, 59, 999);
      bounds.to = toInstant(end);
    }
    if (bounds.from || bounds.to) dates[id] = bounds;
  }
  if (Object.keys(dates).length) request.dateFilters = dates;

  return request;
}

// Oldest refresh among the active row pages: a mutation re-fetches every page (stamp moves),
// loading one more page does not (the oldest page keeps its stamp).
const rowsFreshness = (queryClient: QueryClient, tableId: string) => {
  const stamps = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['rows', tableId], type: 'active' })
    .map((query) => query.state.dataUpdatedAt)
    .filter((stamp) => stamp > 0);
  return stamps.length ? Math.min(...stamps) : 0;
};

export function useTableSummary({
  tableId,
  columns,
  searchQuery,
  searchColumns,
  selectFilters,
  dateFilters,
  rowIds,
  enabled = true,
  unsupported = false,
}: UseTableSummaryParams): TableSummaryState {
  const queryClient = useQueryClient();
  const rowsVersion = useTablesStore((state) => state.rowsVersion);
  const id = tableId === null || tableId === undefined || tableId === '' ? null : String(tableId);
  const rowsStamp = useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => (id ? rowsFreshness(queryClient, id) : 0),
  );

  const request = buildSummaryRequest({ columns, searchQuery, searchColumns, selectFilters, dateFilters, rowIds });
  // Filters arrive as fresh object literals on every render; the serialized scope is the stable identity.
  const requestKey = JSON.stringify(request);
  const active = enabled && !unsupported && id !== null && request !== null;

  const query = useQuery({
    queryKey: ['table-summary', id, requestKey, rowsVersion, rowsStamp],
    queryFn: async ({ signal }) => {
      const response = await apiClient.post<{ data: TableSummaryData }>(`/tables/${id}/summary`, { data: request }, { signal });
      return response.data;
    },
    enabled: active,
    retry: false,
    staleTime: 30_000,
    // Keep the previous values only while the scope is unchanged (a row edit); a new filter or table starts blank.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === id && previousQuery?.queryKey[2] === requestKey ? previous : undefined,
  });

  const { data, isError, error } = query;
  return useMemo<TableSummaryState>(() => {
    if (unsupported) return { status: 'unavailable', reason: 'unsupported' };
    if (!active) return IDLE_SUMMARY;
    if (isError) return { status: 'unavailable', reason: error.message };
    if (data) return { status: 'ready', data };
    return { status: 'loading' };
  }, [unsupported, active, isError, error, data]);
}
