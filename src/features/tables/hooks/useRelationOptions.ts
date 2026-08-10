import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useCallback } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnOption, ColumnRelationConfig } from '../types/table.types';

interface RelationOptionsResult {
  options: ColumnOption[];
  isLoading: boolean;
  error: Error | null;
}

/** Max rows to load for full lookup (display mode) */
const LOOKUP_LIMIT = 5000;
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
 * Convert a row to a ColumnOption
 */
function rowToOption(row: Record<string, unknown>, relation: ColumnRelationConfig): ColumnOption {
  const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : row;
  const rowId = (row as { id?: string | number }).id;
  const originalId = (row as { originalId?: string | number }).originalId;

  let val: string;
  if (relation.valueColumn === 'id') {
    val = String(originalId ?? rowData['id'] ?? rowId ?? '');
  } else {
    val = String(rowData[relation.valueColumn] ?? '');
  }

  return {
    value: val,
    label: String(rowData[relation.labelColumn] ?? ''),
    color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined
  };
}

/**
 * Загружает ВСЕ опции для select из связанной таблицы (для отображения)
 * Использует увеличенный лимит (5000) для полного маппинга
 */
export function useRelationOptions(relation: ColumnRelationConfig | undefined): RelationOptionsResult {
  const { data, isLoading, error } = useQuery({
    queryKey: ['relation-options', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
        return [];
      }

      const response = await apiClient.request<{
        data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=${LOOKUP_LIMIT}`);

      const rows = parseRows(response.data);
      return rows.map(row => rowToOption(row, relation));
    },
    enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
    staleTime: 60000,
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
    enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
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
  const enabledRelations = relations.filter(r =>
    r.relation?.enabled && r.relation.tableId && r.relation.valueColumn && r.relation.labelColumn
  );

  const queries = enabledRelations.map(r => {
    const { relation } = r;
    return useQuery({
      queryKey: ['relation-options', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
      queryFn: async () => {
        if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
          return { columnId: r.columnId, options: [] };
        }

        const response = await apiClient.request<{
          data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
        }>(`/tables/${relation.tableId}/rows?limit=${LOOKUP_LIMIT}`);

        const rows = parseRows(response.data);
        const options: ColumnOption[] = rows.map(row => rowToOption(row, relation));
        return { columnId: r.columnId, options };
      },
      enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
      staleTime: 60000,
    });
  });

  const result = new Map<string, ColumnOption[]>();
  queries.forEach((query, index) => {
    const columnId = enabledRelations[index].columnId;
    result.set(columnId, query.data?.options ?? []);
  });

  return result;
}
