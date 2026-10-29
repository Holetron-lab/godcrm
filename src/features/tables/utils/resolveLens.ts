/**
 * Relation lens — ADR-205 D1/D4.
 *
 * A column with `config.relation.enabled` stores a KEY; the lens swaps it for a
 * field of the related row and the cell renders the swapped value with its own
 * type. This module is the one place that does the swap on the frontend:
 * `renderCellValue` calls it before its type switch, cells and widgets reuse it.
 *
 * The map comes either from the server (`relations[column_name]` on
 * `GET /rows?include=relations`) or from `useRelationLookup`'s client fetch.
 * Both shapes are accepted; an unresolved key renders as the raw key (D1.5).
 */
import type { ColumnRelationConfig, RelationStorageFormat } from '../types/table.types';

/** One related row as the server map or the client fetch describes it. */
export interface LensEntry {
  /** labelColumn verbatim — the lensed value (server). Client entries carry only `label`. */
  value?: unknown;
  label?: string;
  color?: string;
  description?: string;
}

/** key → entry for one lens column. */
export type LensColumnMap = Record<string, LensEntry> | Map<string, LensEntry>;

/** `relations` sibling of the rows payload: column_name → key → entry. */
export type RelationsMap = Record<string, Record<string, LensEntry>>;

export interface LensedItem {
  key: string;
  value: string;
  label: string;
  color?: string;
  description?: string;
  resolved: boolean;
}

export interface LensedValue {
  /** What the cell renders: the raw value while the lens is off or unmapped, the resolved value(s) once mapped. */
  value: unknown;
  label: string;
  color?: string;
  description?: string;
  items: LensedItem[];
  /** True when a map was consulted. False lets a cell fall back to its own lookup. */
  mapped: boolean;
}

/** 'auto' splits comma/semicolon/newline lists like the multi-value cells always did; 'single' keeps one key. */
export type LensSplitMode = 'auto' | 'single';

const splitTrim = (str: string, separator: string) => str.split(separator).map((v) => v.trim()).filter(Boolean);

/**
 * Keys of a relation cell value. Shared by every multi-value cell (and mirrored
 * by `splitRelationValue` in backend/services/RelationLensResolver.js — keep in sync):
 * a JSON array always wins, then `storageFormat`, then auto-detect.
 */
export const parseRelationValues = (value: unknown, storageFormat?: RelationStorageFormat | string): string[] => {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  const str = String(value);
  if (str.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
    } catch {
      // not JSON — fall through to delimiter handling
    }
  }
  switch (storageFormat) {
    case 'comma': return splitTrim(str, ',');
    case 'semicolon': return splitTrim(str, ';');
    case 'newline': return splitTrim(str, '\n');
    case 'single': return [str];
    default:
      if (str.includes(',')) return splitTrim(str, ',');
      if (str.includes(';')) return splitTrim(str, ';');
      if (str.includes('\n')) return splitTrim(str, '\n');
      return [str];
  }
};

const getEntry = (map: LensColumnMap | undefined, key: string): LensEntry | undefined => {
  if (!map) return undefined;
  if (map instanceof Map) return map.get(key);
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
};

const entryValue = (entry: LensEntry, key: string): string => {
  if (entry.value !== undefined && entry.value !== null && entry.value !== '') {
    return typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
  }
  return entry.label ?? key;
};

const splitKeys = (value: unknown, relation: ColumnRelationConfig, split: LensSplitMode): string[] => {
  const listLike = relation.multiple || Boolean(relation.storageFormat) || split === 'auto';
  if (listLike) return parseRelationValues(value, relation.storageFormat);
  if (Array.isArray(value) || (typeof value === 'string' && value.startsWith('['))) return parseRelationValues(value, 'json');
  if (value === null || value === undefined || value === '') return [];
  return [String(value)];
};

const rawLabel = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/**
 * Resolve one cell value through its relation lens.
 *
 * - lens off → the raw value, no items, `mapped: false`
 * - lens on, no map yet → raw value, one unresolved item per key, `mapped: false`
 * - lens on, map present → resolved value(s); keys missing from the map stay raw
 */
export function resolveLens(
  value: unknown,
  relation: ColumnRelationConfig | undefined,
  map: LensColumnMap | undefined,
  split: LensSplitMode = relation?.multiple || relation?.storageFormat ? 'auto' : 'single',
): LensedValue {
  if (!relation?.enabled) {
    return { value, label: rawLabel(value), items: [], mapped: false };
  }

  const keys = splitKeys(value, relation, split);
  const items: LensedItem[] = keys.map((key) => {
    const entry = getEntry(map, key);
    if (!entry) return { key, value: key, label: key, resolved: false };
    return {
      key,
      value: entryValue(entry, key),
      label: entry.label ?? entryValue(entry, key),
      color: entry.color || undefined,
      description: entry.description || undefined,
      resolved: true,
    };
  });

  if (!map || items.length === 0) {
    return { value, label: items.map((i) => i.label).join(', ') || rawLabel(value), items, mapped: Boolean(map) };
  }

  const first = items[0];
  return {
    value: items.length === 1 ? first.value : items.map((i) => i.value),
    label: items.map((i) => i.label).join(', '),
    color: first.color,
    description: first.description,
    items,
    mapped: true,
  };
}
