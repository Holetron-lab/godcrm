/**
 * ADR-0035 Slice 1 (S1.3) — the ONE coordinate parser, shared by both trees.
 *
 * Same two constraints as `shared/column-types.js`: ZERO IMPORTS (this file is
 * pulled into the Vite bundle) and plain `.js` (the backend is ESM JS).
 *
 * `parseGeoPoint(input)` → `{ lat, lng }` | `null`. Accepted forms:
 *   - decimal pair, `,` / `;` / whitespace separated:  `55.75, 37.61`
 *   - DMS with `° ′ ″` or `° ' "` and N/S/E/W:          `55°45′N 37°37′E`
 *   - Google-Maps URL: `@lat,lng`, `q=lat,lng`, `!3dLAT!4dLNG`
 *   - `{ lat, lng }` object
 *   - GeoJSON Point: `{ type: 'Point', coordinates: [lng, lat] }` or bare `[lng, lat]`
 * Out of WGS-84 range (lat ∉ [-90, 90], lng ∉ [-180, 180]) → `null`.
 *
 * `formatGeoPoint(point, { precision = 6 })` → `"55.750000, 37.610000"`.
 */

const NUM = '(-?\\d+(?:\\.\\d+)?)';
const DECIMAL_PAIR = new RegExp(`^${NUM}(?:\\s*[,;]\\s*|\\s+)${NUM}$`);
const GMAPS_AT = new RegExp(`@${NUM},${NUM}`);
const GMAPS_Q = new RegExp(`[?&](?:q|query|ll)=${NUM}(?:,|%2C)${NUM}`, 'i');
const GMAPS_3D4D = new RegExp(`!3d${NUM}!4d${NUM}`);
// One DMS token: degrees, optional minutes, optional seconds, optional hemisphere.
const DMS_TOKEN = /(-?\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*["″”]\s*)?([NSEW])?/gi;

function inRange(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function point(lat, lng) {
  return inRange(lat, lng) ? { lat, lng } : null;
}

function parseDms(text) {
  const parts = [];
  for (const m of text.matchAll(DMS_TOKEN)) {
    const deg = Number(m[1]);
    const sign = deg < 0 ? -1 : 1;
    const value = sign * (Math.abs(deg) + Number(m[2] || 0) / 60 + Number(m[3] || 0) / 3600);
    parts.push({ value, hemi: m[4] ? m[4].toUpperCase() : null });
  }
  if (parts.length !== 2) return null;
  const signed = parts.map((p) => (p.hemi === 'S' || p.hemi === 'W' ? -Math.abs(p.value) : p.value));
  // Hemisphere letters fix the axis; without them the order is lat, lng.
  const lngFirst = parts[0].hemi === 'E' || parts[0].hemi === 'W' || parts[1].hemi === 'N' || parts[1].hemi === 'S';
  return lngFirst ? point(signed[1], signed[0]) : point(signed[0], signed[1]);
}

function parseString(raw) {
  const text = raw.trim();
  if (!text) return null;
  for (const re of [GMAPS_3D4D, GMAPS_AT, GMAPS_Q]) {
    const m = text.match(re);
    if (m) return point(Number(m[1]), Number(m[2]));
  }
  const dec = text.match(DECIMAL_PAIR);
  if (dec) return point(Number(dec[1]), Number(dec[2]));
  return parseDms(text);
}

/**
 * @param {unknown} input
 * @returns {{ lat: number, lng: number } | null}
 */
export function parseGeoPoint(input) {
  if (input == null) return null;
  if (typeof input === 'string') return parseString(input);
  if (Array.isArray(input)) {
    return input.length === 2 ? point(Number(input[1]), Number(input[0])) : null;
  }
  if (typeof input === 'object') {
    if (input.type === 'Point' && Array.isArray(input.coordinates)) return parseGeoPoint(input.coordinates);
    if (input.lat === undefined || input.lng === undefined || input.lat === null || input.lng === null) return null;
    if (typeof input.lat === 'string' && input.lat.trim() === '') return null;
    if (typeof input.lng === 'string' && input.lng.trim() === '') return null;
    return point(Number(input.lat), Number(input.lng));
  }
  return null;
}

/**
 * @param {{ lat: number, lng: number } | null | undefined} pt
 * @param {{ precision?: number }} [opts]
 * @returns {string} `"lat, lng"` with fixed decimals; `''` for an empty / invalid point
 */
export function formatGeoPoint(pt, { precision = 6 } = {}) {
  const p = parseGeoPoint(pt);
  return p ? `${p.lat.toFixed(precision)}, ${p.lng.toFixed(precision)}` : '';
}
