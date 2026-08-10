/**
 * useBoundRowDisplay — shared lookup for a bound row used by BoundRowChip and
 * the bound-rows toolbar. Returns title, icon, status & secondary (type or
 * priority) options resolved against active preset, plus dropdown options and
 * an updater. Avoids duplicating the column-shape parsing in two places.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import {
  CHAT_SOURCE_PRESETS,
  resolveActivePreset,
  resolvePreset,
  type ChatSourcePreset,
} from '../../../utils/chatSourcePresets';
import type { TasksSourceConfig, FavoritesConfig } from '../types';

export interface BoundRowRef {
  table_id: number;
  row_id: number;
  table_name?: string;
  table_icon?: string;
  row_title?: string;
}

export interface RelationOption {
  id: string | number;
  label: string;
  color?: string;
}

interface ColumnInfo {
  name?: string;
  column_name?: string;
  type?: string;
  column_type?: string;
  config?: unknown;
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function parseConfig(col: ColumnInfo | undefined): Record<string, unknown> | null {
  if (!col || !col.config) return null;
  const cfg = typeof col.config === 'string'
    ? (() => { try { return JSON.parse(col.config as string); } catch { return null; } })()
    : col.config as Record<string, unknown>;
  return cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : null;
}

function getRelationTableId(col: ColumnInfo | undefined): number | undefined {
  const cfg = parseConfig(col);
  if (!cfg) return undefined;
  const rel = (cfg.relation || {}) as Record<string, unknown>;
  const toNum = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  return (
    toNum(cfg.relatedTableId) ??
    toNum(cfg.relationTableId) ??
    toNum(cfg.target_table_id) ??
    toNum(rel.tableId) ??
    toNum(rel.target_table_id)
  );
}

function getStaticOptions(col: ColumnInfo | undefined): RelationOption[] | undefined {
  const cfg = parseConfig(col);
  if (!cfg) return undefined;
  const raw = (Array.isArray(cfg.options) ? cfg.options
    : Array.isArray((cfg as any).select?.options) ? (cfg as any).select.options
    : null) as Array<Record<string, unknown>> | null;
  if (!raw) return undefined;
  return raw.map((o, i) => ({
    id: (asString(o.value) ?? asString(o.id) ?? asString(o.label) ?? String(i))!,
    label: asString(o.label) ?? asString(o.value) ?? asString(o.name) ?? `#${i}`,
    color: typeof o.color === 'string' ? o.color : undefined,
  }));
}

async function fetchRelationOptions(tableId: number): Promise<RelationOption[]> {
  const resp = await apiClient.get<any>(`/tables/${tableId}/rows?limit=200`);
  const rows = (Array.isArray(resp?.rows) ? resp.rows : null)
    ?? (Array.isArray(resp?.data?.rows) ? resp.data.rows : null)
    ?? [];
  return rows.map((r: any) => ({
    id: r.id,
    label: asString(r.data?.label) || asString(r.data?.name) || asString(r.data?.title) || asString(r.data?.value) || `#${r.id}`,
    color: typeof r.data?.color === 'string' ? r.data.color : undefined,
  }));
}

function resolveOption(rawValue: unknown, options: RelationOption[] | undefined): RelationOption | null {
  if (rawValue == null || rawValue === '') return null;
  if (!options || options.length === 0) {
    const s = asString(rawValue);
    return s ? { id: s, label: s } : null;
  }
  const key = String(rawValue);
  return options.find(o => String(o.id) === key) || null;
}

export interface UseBoundRowDisplayResult {
  icon: string | undefined;
  title: string;
  description: string | undefined;
  kind: 'tickets' | 'documents' | 'custom' | null;
  statusColName: string | undefined;
  secondaryColName: string | undefined;
  statusOption: RelationOption | null;
  secondaryOption: RelationOption | null;
  statusOptions: RelationOption[];
  secondaryOptions: RelationOption[];
  statusLoading: boolean;
  secondaryLoading: boolean;
  isLoading: boolean;
  updateStatus: (value: string | number | null) => Promise<void>;
  updateSecondary: (value: string | number | null) => Promise<void>;
}

export function useBoundRowDisplay(
  br: BoundRowRef,
  tasksSource?: TasksSourceConfig | null,
  favoritesConfig?: FavoritesConfig | null,
): UseBoundRowDisplayResult {
  const queryClient = useQueryClient();
  const tableId = br.table_id;
  const rowId = br.row_id;

  const preset: ChatSourcePreset | null = useMemo(() => {
    const explicit = resolveActivePreset({
      tableId,
      tasksSource: tasksSource as any,
      favoritesConfig: favoritesConfig as any,
    });
    if (explicit) return explicit;
    const direct = CHAT_SOURCE_PRESETS.find(p => p.applicable_table_ids?.includes(tableId));
    if (direct) return direct;
    return CHAT_SOURCE_PRESETS.find(p => p.id === 'documents-default') || null;
  }, [tableId, tasksSource, favoritesConfig]);

  const rowQuery = useQuery<{ data: Record<string, unknown> }>({
    queryKey: ['row', tableId, rowId],
    queryFn: async () => {
      const resp = await apiClient.get<any>(`/tables/${tableId}/rows/${rowId}`);
      const r = resp?.row ?? resp?.data?.row;
      return { data: r?.data || {} };
    },
    enabled: tableId > 0 && rowId > 0,
    staleTime: 30_000,
  });

  const columnsQuery = useQuery<ColumnInfo[]>({
    queryKey: ['table-columns-for-preset-card', tableId],
    queryFn: async () => {
      const resp = await apiClient.get<any>(`/tables/${tableId}/columns`);
      const arr = Array.isArray(resp?.data) ? resp.data : Array.isArray(resp) ? resp : [];
      return arr;
    },
    enabled: tableId > 0,
    staleTime: 5 * 60_000,
  });

  const resolved = useMemo(() => {
    if (!preset || !columnsQuery.data) return {} as Record<string, string | undefined>;
    return resolvePreset(preset, columnsQuery.data);
  }, [preset, columnsQuery.data]);

  const statusColName = resolved.statusColumn;
  const secondaryColName = resolved.priorityColumn || resolved.categoryColumn;

  const statusCol = useMemo(
    () => columnsQuery.data?.find(c => (c.name || c.column_name) === statusColName),
    [statusColName, columnsQuery.data],
  );
  const secondaryCol = useMemo(
    () => columnsQuery.data?.find(c => (c.name || c.column_name) === secondaryColName),
    [secondaryColName, columnsQuery.data],
  );

  const statusRelationTableId = useMemo(() => getRelationTableId(statusCol), [statusCol]);
  const secondaryRelationTableId = useMemo(() => getRelationTableId(secondaryCol), [secondaryCol]);

  const statusStaticOptions = useMemo(() => getStaticOptions(statusCol), [statusCol]);
  const secondaryStaticOptions = useMemo(() => getStaticOptions(secondaryCol), [secondaryCol]);

  // When a relation tableId is configured, always fetch the dict — many columns
  // carry a stub `options[]` where `label === value` (auto-seeded id strings),
  // so static options would render the pill as the raw row id. The fetched
  // relation dict has the real human labels and wins; static is fallback only.
  const statusDictQuery = useQuery<RelationOption[]>({
    queryKey: ['relation-options', statusRelationTableId],
    queryFn: () => fetchRelationOptions(statusRelationTableId!),
    enabled: !!statusRelationTableId,
    staleTime: 5 * 60_000,
  });

  const secondaryDictQuery = useQuery<RelationOption[]>({
    queryKey: ['relation-options', secondaryRelationTableId],
    queryFn: () => fetchRelationOptions(secondaryRelationTableId!),
    enabled: !!secondaryRelationTableId,
    staleTime: 5 * 60_000,
  });

  const statusOptions = (statusDictQuery.data && statusDictQuery.data.length > 0)
    ? statusDictQuery.data
    : (statusStaticOptions ?? []);
  const secondaryOptions = (secondaryDictQuery.data && secondaryDictQuery.data.length > 0)
    ? secondaryDictQuery.data
    : (secondaryStaticOptions ?? []);

  const rowData = rowQuery.data?.data || {};
  const titleColName = resolved.displayColumn;
  const title = (titleColName && asString(rowData[titleColName])) || br.row_title || `#${rowId}`;
  const iconColName = resolved.iconColumn;
  const icon = (iconColName && asString(rowData[iconColName])) || br.table_icon;
  const descriptionColName = resolved.descriptionColumn;
  const description = descriptionColName ? asString(rowData[descriptionColName]) : undefined;

  const statusRaw = statusColName ? rowData[statusColName] : undefined;
  const statusOption = useMemo(() => resolveOption(statusRaw, statusOptions), [statusRaw, statusOptions]);

  const secondaryRaw = secondaryColName ? rowData[secondaryColName] : undefined;
  const secondaryOption = useMemo(() => resolveOption(secondaryRaw, secondaryOptions), [secondaryRaw, secondaryOptions]);

  const updateColumn = async (colName: string, value: string | number | null) => {
    try {
      await apiClient.put(`/tables/${tableId}/rows/${rowId}`, { data: { [colName]: value } });
      queryClient.invalidateQueries({ queryKey: ['row', tableId, rowId] });
    } catch (err) {
      logger.warn('[useBoundRowDisplay] Failed to update', colName, err);
    }
  };

  return {
    icon,
    title,
    description,
    kind: preset?.kind ?? null,
    statusColName,
    secondaryColName,
    statusOption,
    secondaryOption,
    statusOptions,
    secondaryOptions,
    statusLoading: !!statusRelationTableId
      ? (statusDictQuery.isLoading && !statusStaticOptions)
      : false,
    secondaryLoading: !!secondaryRelationTableId
      ? (secondaryDictQuery.isLoading && !secondaryStaticOptions)
      : false,
    isLoading: rowQuery.isLoading || columnsQuery.isLoading,
    updateStatus: (value) => statusColName ? updateColumn(statusColName, value) : Promise.resolve(),
    updateSecondary: (value) => secondaryColName ? updateColumn(secondaryColName, value) : Promise.resolve(),
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6 && cleaned.length !== 3) return `rgba(255,255,255,${alpha})`;
  const full = cleaned.length === 3 ? cleaned.split('').map(c => c + c).join('') : cleaned;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
