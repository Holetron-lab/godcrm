import { useQuery, useQueries } from '@tanstack/react-query';
import { useState, useMemo, useCallback } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnOption, ColumnRelationConfig } from '../types/table.types';
import type { LensEntry } from '../utils/resolveLens';
import {
  fetchRelationLookup,
  isRelationLookupReady,
  relationLookupQueryKey,
  type RelationLookupData,
} from './useRelationLookup';

interface RelationOptionsResult {
  options: ColumnOption[];
  isLoading: boolean;
  error: Error | null;
}

/** Default rows to load for search results */
const SEARCH_LIMIT = 50;
/** Debounce delay for server search (ms) */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Parse rows from API response (handles both formats)
 */
function parseRows(responseData: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(responseData)) return responseData;
  const data = responseData as { rows?: Array<Record<string, unknown>> };
  return data?.rows || [];
}

/**
 * Convert a row to a ColumnOption (search results only — full lists come from the shared lookup)
 */
function rowToOption(row: Record<string, unknown>, relation: ColumnRelationConfig): ColumnOption {
  const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : row;
  const rowId = (row as { id?: string | number }).id;
  const originalId = (row as { originalId?: string | number }).originalId;

  let val: string;
  if (relation.valueColumn === 'id') {
    val = String(originalId ?? rowData['id'] ?? rowId ?? '');
  } else {
    val = relation.valueColumn ? String(rowData[relation.valueColumn] ?? '') : '';
  }

  return {
    value: val,
    label: relation.labelColumn ? String(rowData[relation.labelColumn] ?? '') : '',
    color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined
  };
}

/** Every related row as a select option (ADR-205 D4: derived from the one shared lookup). */
const toOptions = (data: RelationLookupData): ColumnOption[] =>
  data.items.map(({ value, label, color }) => ({ value, label, color }));

/**
 * Options from one column of the server map (`relations[column]` of GET /rows?include=relations).
 * Covers only the keys of the loaded rows — enough for labels of what is on screen, never a full list.
 */
export const lensMapToOptions = (map: Record<string, LensEntry>): ColumnOption[] =>
  Object.entries(map).map(([value, entry]) => ({
    value,
    label: entry.label ?? (entry.value === undefined || entry.value === null ? value : String(entry.value)),
    color: entry.color,
  }));

/**
 * Все опции select из связанной таблицы (для отображения).
 * Читает тот же кэш, что и useRelationLookup — одна загрузка на relation.
 */
export function useRelationOptions(relation: ColumnRelationConfig | undefined): RelationOptionsResult {
  const { data, isLoading, error } = useQuery({
    queryKey: relationLookupQueryKey(relation),
    queryFn: () => fetchRelationLookup(relation),
    enabled: isRelationLookupReady(relation),
    staleTime: 60000,
    select: toOptions,
  });

  return {
    options: data ?? [],
    isLoading,
    error: error as Error | null
  };
}

/**
 * Хук для ПОИСКА опций с серверным typeahead
 * Используется в editors (RelationEditor, SelectEditor) для поиска по большим таблицам
 */
export function useRelationSearch(relation: ColumnRelationConfig | undefined) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term);
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => {
      setDebouncedSearch(term);
    }, SEARCH_DEBOUNCE_MS);
    setDebounceTimer(timer);
  }, [debounceTimer]);

  // Initial load — small batch for quick display
  const { data: initialData, isLoading: isLoadingInitial } = useQuery({
    queryKey: ['relation-search-initial', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId) return [];
      const response = await apiClient.request<{
        data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=${SEARCH_LIMIT}`);
      return parseRows(response.data).map(row => rowToOption(row, relation));
    },
    enabled: isRelationLookupReady(relation),
    staleTime: 60000,
  });

  // Server search — only fires when debounced search term is set
  const { data: searchData, isLoading: isSearching } = useQuery({
    queryKey: ['relation-search', relation?.tableId, relation?.labelColumn, debouncedSearch],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId || !debouncedSearch) return [];
      const searchParam = encodeURIComponent(debouncedSearch);
      const searchCol = relation.labelColumn;
      const response = await apiClient.request<{
        data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=${SEARCH_LIMIT}&search=${searchParam}&searchColumns=${searchCol}`);
      return parseRows(response.data).map(row => rowToOption(row, relation));
    },
    enabled: Boolean(relation?.enabled && relation?.tableId && debouncedSearch.length > 0),
    staleTime: 30000,
  });

  // Merge: if searching, show search results; otherwise show initial data
  const options = useMemo(() => {
    if (debouncedSearch && searchData) return searchData;
    return initialData ?? [];
  }, [debouncedSearch, searchData, initialData]);

  return {
    options,
    searchTerm,
    setSearch: handleSearch,
    isLoading: isLoadingInitial,
    isSearching,
  };
}

/**
 * Хук для получения опций из нескольких relation configs
 * Используется когда нужно загрузить опции для нескольких колонок сразу
 */
export function useMultiRelationOptions(
  relations: Array<{ columnId: string; relation: ColumnRelationConfig | undefined }>
): Map<string, ColumnOption[]> {
  const enabledRelations = relations.filter(r => isRelationLookupReady(r.relation));

  // Columns pointing at the same relation share one query (and one request).
  const relationGroups = new Map<string, typeof enabledRelations>();
  for (const entry of enabledRelations) {
    const key = JSON.stringify(relationLookupQueryKey(entry.relation));
    const group = relationGroups.get(key);
    if (group) group.push(entry);
    else relationGroups.set(key, [entry]);
  }
  const groups = [...relationGroups.values()];

  const queries = useQueries({
    queries: groups.map(([{ relation }]) => ({
      queryKey: relationLookupQueryKey(relation),
      queryFn: () => fetchRelationLookup(relation),
      enabled: isRelationLookupReady(relation),
      staleTime: 60000,
      select: toOptions,
    })),
  });

  const result = new Map<string, ColumnOption[]>();
  queries.forEach((query, index) => {
    for (const { columnId } of groups[index]) {
      result.set(columnId, query.data ?? []);
    }
  });

  return result;
}

/** Select / multi-select columns whose options come from a related table. */
export const isLensSelectColumn = (column: { type: string; config?: { relation?: ColumnRelationConfig } }): boolean =>
  ['select', 'multi-select', 'multi_select'].includes(column.type) && isRelationLookupReady(column.config?.relation);
