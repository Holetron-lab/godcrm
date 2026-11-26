// Client-side projection of raw rows through a mapping list. Used for the CSV
// preview and import payload; the install plan does the same on the server.
import { convertValue } from './convert-value';
import { NEW_COLUMN, type ColumnMapping } from './types';

export interface ApplyMappingsOptions {
  /** Key under which a `__new` column is written. Defaults to the source column label. */
  newColumnKey?: (mapping: ColumnMapping) => string;
  /** Cap the number of rows (preview). */
  limit?: number;
}

/**
 * Turn `rows` (arrays aligned with `headers`) into objects keyed by target
 * column. Skipped columns (`targetColumn === null`) are dropped; values go
 * through `convertValue` with the mapping's type.
 */
export function applyColumnMappings(
  rows: readonly (readonly string[])[],
  headers: readonly string[],
  mappings: readonly ColumnMapping[],
  options: ApplyMappingsOptions = {},
): Record<string, unknown>[] {
  const { newColumnKey = m => m.sourceColumn, limit } = options;
  const bySource = new Map(mappings.map(m => [m.sourceColumn, m]));
  const slice = limit === undefined ? rows : rows.slice(0, limit);
  return slice.map(row => {
    const obj: Record<string, unknown> = {};
    headers.forEach((header, i) => {
      const mapping = bySource.get(header);
      if (!mapping || mapping.targetColumn === null) return;
      const key = mapping.targetColumn === NEW_COLUMN ? newColumnKey(mapping) : mapping.targetColumn;
      obj[key] = convertValue(row[i] ?? '', mapping.type);
    });
    return obj;
  });
}

/** Number of mappings that will write somewhere (existing or new column). */
export function countMappedColumns(mappings: readonly ColumnMapping[]): number {
  return mappings.filter(m => m.targetColumn !== null).length;
}
