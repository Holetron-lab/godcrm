/**
 * ADR-0035-A — one by-type dispatch for per-cell write normalizers.
 *
 * Every row write path (REST create / mutate / batch, MCP data-tools,
 * ImportService, inbound webhook ingest, public forms) calls
 * `normalizeTypedCells(columns, patch)` once, before persistence, instead of
 * wiring each typed normalizer separately — a path that misses one type misses
 * them all, which is what the write-path enumeration test catches.
 *
 * Pure. Result shape is the one ADR-0011's `enforceVerificationGuards` and
 * ADR-0035 S1.4's `normalizeGeoCells` already use, so call sites stay the same.
 */
import { normalizeGeoValue, GEO_POINT_INVALID } from './geo/geoPoint.js';
import { normalizeAddressValue, ADDRESS_INVALID } from './geo/address.js';

const NORMALIZERS = Object.freeze({
  geo_point: { normalize: normalizeGeoValue, code: GEO_POINT_INVALID },
  address: { normalize: normalizeAddressValue, code: ADDRESS_INVALID },
});

/** Column types that carry a write normalizer — for `WHERE type IN (...)` lookups. */
export const NORMALIZED_CELL_TYPES = Object.freeze(Object.keys(NORMALIZERS));

/**
 * @param {Array<{ id?: number|string, column_name: string, type: string }>} columns table_columns rows
 * @param {object} patch incoming row data; keys are column names (or ids on create)
 * @returns {{ ok: true, data: object }
 *   | { ok: false, status: 400, code: string, message: string, meta: { column: string } }}
 */
export function normalizeTypedCells(columns, patch) {
  const data = { ...(patch || {}) };
  for (const col of columns || []) {
    const entry = NORMALIZERS[col.type];
    if (!entry) continue;
    for (const key of [col.column_name, col.id == null ? null : String(col.id)]) {
      if (key == null || !Object.hasOwn(data, key)) continue;
      const r = entry.normalize(data[key]);
      if (!r.ok) {
        return {
          ok: false, status: 400, code: entry.code,
          message: `Column '${col.column_name}': ${r.reason}`,
          meta: { column: col.column_name },
        };
      }
      data[key] = r.value;
    }
  }
  return { ok: true, data };
}
