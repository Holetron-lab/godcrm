/**
 * useRelationLookup — the ONE client-side lens loader (ADR-205 D4).
 *
 * The grid gets its lens map from the server (`GET /rows?include=relations`,
 * see `resolveLens`). Everything the server map does not cover — filters,
 * footer summaries, option lists in editors, reverse lookups, widgets without
 * the map — goes through this hook, which downloads the related table once
 * (the 5000-row page) under a single queryKey family so every consumer of the
 * same relation shares one request.
 *
 * Usage:
 *   const { lookup, isLoading } = useRelationLookup(relation);
 *   const item = lookup(value); // { label: 'backlog', color: '#6b7280' }
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnRelationConfig } from '../types/table.types';
import { parseRelationValues, resolveLens, type LensSplitMode, type LensedValue } from '../utils/resolveLens';

export interface RelationItem {
  label: string;
  color?: string;
  description?: string;
}

/** One related row as an option: canonical key + display fields. */
export interface RelationOption extends RelationItem {
  value: string;
}

export interface RelationLookupData {
  /** Every accepted key alias (original id, data.id, row id or the custom valueColumn) → item. */
  map: Map<string, RelationItem>;
  /** One entry per related row, canonical key first — for option lists. */
  items: RelationOption[];
  /** Reverse index: a key found in the related rows' valueColumn → the rows that hold it. */
  reverse: Map<string, RelationOption[]>;
}

// Default color palette (same as SelectEditor)
const defaultColors = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

export const getDefaultColor = (index: number) => defaultColors[index % defaultColors.length];

export const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

/** Stable colour for a key that has none of its own. */
export const colorForKey = (key: string, offset = 0) => getDefaultColor(hashString(key) + offset);

type RelationRow = { id?: string | number; originalId?: string | number; data?: Record<string, unknown>; [key: string]: unknown };

export const isRelationLookupReady = (relation?: ColumnRelationConfig): boolean =>
  Boolean(relation?.enabled && relation.tableId && relation.valueColumn && relation.labelColumn);

export const relationLookupQueryKey = (relation?: ColumnRelationConfig) =>
  ['relation-lookup', relation?.tableId, relation?.valueColumn, relation?.labelColumn, relation?.colorColumn, relation?.descriptionColumn] as const;

const emptyLookup = (): RelationLookupData => ({ map: new Map(), items: [], reverse: new Map() });

/** Download the related table and index it. The only lens download left on the frontend (ADR-205 AC5). */
export async function fetchRelationLookup(relation?: ColumnRelationConfig): Promise<RelationLookupData> {
  if (!isRelationLookupReady(relation) || !relation) return emptyLookup();
  const { valueColumn = 'id', labelColumn = 'name', colorColumn, descriptionColumn, storageFormat } = relation;

  const response = await apiClient.request<{ data: { rows: RelationRow[] } | RelationRow[] }>(
    `/tables/${relation.tableId}/rows?limit=5000`,
  );
  const rows: RelationRow[] = Array.isArray(response.data) ? response.data : response.data?.rows || [];

  const result = emptyLookup();
  rows.forEach((row, index) => {
    const rowData = row.data && typeof row.data === 'object' ? row.data : (row as Record<string, unknown>);
    const rowId = row.id;
    const originalId = row.originalId;
    // Local tables key `data` by column name; data-source rows may be flat or keyed by column id.
    const field = (name: string): unknown => rowData[name] ?? row[name];

    const label = String(field(labelColumn) ?? rowData['name'] ?? rowData['title'] ?? '');
    const color = colorColumn
      ? String(field(colorColumn) ?? rowData['color'] ?? '') || undefined
      : (rowData['color'] ? String(rowData['color']) : undefined);
    const description = descriptionColumn ? String(field(descriptionColumn) ?? '') || undefined : undefined;
    const item: RelationItem = { label, color, description };

    let canonical: unknown;
    if (valueColumn === 'id') {
      for (const key of [originalId, rowData['id'], rowId]) {
        if (key !== undefined && key !== null) result.map.set(String(key), item);
      }
      canonical = originalId ?? rowData['id'] ?? rowId;
    } else {
      const raw = field(valueColumn);
      if (raw !== undefined && raw !== null && raw !== '') result.map.set(String(raw), item);
      canonical = raw;
      // Reverse lookups: rows whose valueColumn lists a key (legacy columns fall back to the usual link names).
      const linked = raw ?? rowData['agent_id'] ?? rowData['user_id'] ?? rowData['parent_id'];
      for (const key of parseRelationValues(linked, storageFormat)) {
        const bucket = result.reverse.get(key) ?? [];
        bucket.push({ value: String(rowId ?? originalId ?? ''), label: label || 'Без имени', description, color: color || getDefaultColor(index) });
        result.reverse.set(key, bucket);
      }
    }
    if (canonical !== undefined && canonical !== null && canonical !== '') {
      result.items.push({ value: String(canonical), ...item });
    }
  });

  return result;
}

interface UseRelationLookupOptions {
  /** Set false when a server map already covers this column — no request is made. */
  enabled?: boolean;
}

export function useRelationLookup(relation?: ColumnRelationConfig, options: UseRelationLookupOptions = {}) {
  const { data, isLoading } = useQuery({
    queryKey: relationLookupQueryKey(relation),
    queryFn: () => fetchRelationLookup(relation),
    enabled: isRelationLookupReady(relation) && (options.enabled ?? true),
    staleTime: 60000,
  });

  /** Lookup value and return RelationItem with label and color */
  const lookup = (value: unknown): RelationItem | null => {
    if (value === null || value === undefined || value === '') return null;
    const item = data?.map.get(String(value));
    if (!item) return null;
    return { ...item, color: item.color || colorForKey(String(value)) };
  };

  /** Every related row as an option (one per row). */
  const getAllItems = (): RelationOption[] => data?.items ?? [];

  /** Rows of the related table whose valueColumn references `rowId` (reverse / backlink mode). */
  const reverseLookup = (rowId: unknown): RelationOption[] =>
    rowId === undefined || rowId === null ? [] : data?.reverse.get(String(rowId)) ?? [];

  return {
    lookup,
    getAllItems,
    reverseLookup,
    isLoading,
    relationMap: data?.map,
  };
}

/**
 * Lens for one cell: the server-resolved value when the rows query carried a map
 * for this column, otherwise the client fetch (deduplicated per relation). Cells
 * call this instead of owning a query.
 */
export function useLensedValue(
  value: unknown,
  relation: ColumnRelationConfig | undefined,
  lensed?: LensedValue,
  split?: LensSplitMode,
): LensedValue {
  const { relationMap } = useRelationLookup(relation, { enabled: !lensed?.mapped });
  if (lensed?.mapped) return lensed;
  return resolveLens(value, relation, relationMap, split);
}

/**
 * Helper to parse relation config from column config
 */
export function parseRelationConfig(config: unknown): ColumnRelationConfig | undefined {
  if (!config) return undefined;

  const parsed = typeof config === 'string' ? JSON.parse(config) : config;

  if (parsed?.relation?.enabled) {
    return {
      enabled: true,
      tableId: parsed.relation.tableId || parsed.relatedTableId,
      valueColumn: parsed.relation.valueColumn || 'id',
      labelColumn: parsed.relation.labelColumn || parsed.displayColumn || 'name',
      colorColumn: parsed.relation.colorColumn || 'color',
      descriptionColumn: parsed.relation.descriptionColumn
    };
  }

  // Legacy format: just relatedTableId
  if (parsed?.relatedTableId) {
    return {
      enabled: true,
      tableId: String(parsed.relatedTableId),
      valueColumn: 'id',
      labelColumn: parsed.displayColumn || 'name',
      colorColumn: 'color'
    };
  }

  return undefined;
}
