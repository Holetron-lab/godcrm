/**
 * ADR-0035-A — server-side normalizer for `address` cells.
 *
 * Pure. Same `{ ok, value | reason }` contract as `normalizeGeoValue`
 * (geoPoint.js); dispatched per column type by services/cellNormalizers.js.
 * Stored shape (ADR-0035-A §Value Schema) — no coordinates, ever:
 *
 *   { formatted, name?, country_code?, country?, region?, city?, street?,
 *     building?, unit?, postal_code?, provider?, provider_place_id? }
 *
 * Rules:
 *   - `null` / `''` / whitespace-only string → null (empty cell)
 *   - string                                 → { formatted: trimmed }
 *   - object                                 → allowlist keys, every value a
 *                                              string, trimmed, empty dropped,
 *                                              `formatted` required ≤ 512,
 *                                              `country_code` ISO-3166-1 alpha-2
 *   - `provider` / `provider_place_id` are reserved for slice B (geocoder):
 *     accepted and stored verbatim, never required.
 */
export const ADDRESS_INVALID = 'address_invalid';
export const ADDRESS_FORMATTED_MAX = 512;
export const ADDRESS_KEYS = Object.freeze([
  'formatted', 'name', 'country_code', 'country', 'region', 'city', 'street',
  'building', 'unit', 'postal_code', 'provider', 'provider_place_id',
]);

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} value raw cell value from the client
 * @returns {{ ok: true, value: object | null } | { ok: false, reason: string }}
 */
export function normalizeAddressValue(value) {
  if (value == null || value === '') return { ok: true, value: null };
  let out;
  if (typeof value === 'string') {
    const formatted = value.trim();
    if (!formatted) return { ok: true, value: null };
    out = { formatted };
  } else if (isPlainObject(value)) {
    out = {};
    for (const key of ADDRESS_KEYS) {
      const v = value[key];
      if (v == null) continue;
      if (typeof v !== 'string') return { ok: false, reason: `${key} must be a string` };
      const t = v.trim();
      if (t) out[key] = key === 'country_code' ? t.toUpperCase() : t;
    }
    if (!out.formatted) return { ok: false, reason: 'formatted is required (the address line)' };
    if (out.country_code && !/^[A-Z]{2}$/.test(out.country_code)) {
      return { ok: false, reason: 'country_code must be ISO-3166-1 alpha-2' };
    }
  } else {
    return { ok: false, reason: 'expected an address string or object' };
  }
  if (out.formatted.length > ADDRESS_FORMATTED_MAX) {
    return { ok: false, reason: `formatted must be at most ${ADDRESS_FORMATTED_MAX} characters` };
  }
  return { ok: true, value: out };
}
