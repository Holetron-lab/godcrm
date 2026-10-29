/**
 * ADR-0035 Slice 1 (S1.4) — server-side normalizer for `geo_point` cells.
 *
 * Pure. Runs before persistence in the three row write paths (create, update,
 * batch) and in the same `{ ok, data | code }` shape as ADR-0011's
 * `enforceVerificationGuards`. The stored value is the one in S1.1:
 *
 *   { lat, lng, accuracy_m?, altitude_m?, heading_deg?, speed_ms?, captured_at?, source? }
 *
 * Rules per `geo_point` key present in the patch:
 *   - `null` / `''`          → null (empty cell)
 *   - string                 → parseGeoPoint(); invalid → geo_point_invalid;
 *                              ok → { lat, lng, source: 'raw' }. A typed string
 *                              REPLACES lat/lng and DROPS the optional bag — the
 *                              bag describes a device fix, a hand-typed point is
 *                              no longer that fix.
 *   - object / GeoJSON Point → range-check lat/lng, strip unknown keys, keep the
 *                              typed optional bag, default `source` to 'paste'.
 *
 * Today no other per-type validation runs on row writes, so this is the first
 * per-type write normalizer after the ADR-0011 guard. Keep it a pure function.
 */
import { parseGeoPoint } from '../../../shared/geo-point.js';

export const GEO_POINT_INVALID = 'geo_point_invalid';
export const GEO_POINT_SOURCES = Object.freeze(['click', 'geocode', 'paste', 'gps', 'raw', 'import']);
const NUMERIC_META = ['accuracy_m', 'altitude_m', 'heading_deg', 'speed_ms'];

/**
 * @param {unknown} value raw cell value from the client
 * @returns {{ ok: true, value: object | null } | { ok: false, reason: string }}
 */
export function normalizeGeoValue(value) {
  if (value == null || value === '') return { ok: true, value: null };
  const core = parseGeoPoint(value);
  if (!core) return { ok: false, reason: 'expected "lat, lng" (WGS-84: lat in [-90, 90], lng in [-180, 180])' };
  if (typeof value === 'string') return { ok: true, value: { ...core, source: 'raw' } };

  const meta = Array.isArray(value) || value.type === 'Point' ? {} : value;
  const out = { ...core };
  for (const key of NUMERIC_META) {
    if (meta[key] == null) continue;
    if (!Number.isFinite(Number(meta[key]))) return { ok: false, reason: `${key} must be a number` };
    out[key] = Number(meta[key]);
  }
  if (meta.captured_at != null) {
    if (typeof meta.captured_at !== 'string' || Number.isNaN(Date.parse(meta.captured_at))) {
      return { ok: false, reason: 'captured_at must be an ISO-8601 string' };
    }
    out.captured_at = meta.captured_at;
  }
  if (meta.source != null && !GEO_POINT_SOURCES.includes(meta.source)) {
    return { ok: false, reason: `source must be one of: ${GEO_POINT_SOURCES.join(', ')}` };
  }
  out.source = meta.source ?? 'paste';
  return { ok: true, value: out };
}

// The per-row loop over columns lives in services/cellNormalizers.js
// (`normalizeTypedCells`), shared with `address` since ADR-0035-A.
