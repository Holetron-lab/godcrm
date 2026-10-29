/** ADR-0035 Slice 1 (S1.3) — typings for the one shared coordinate parser; runtime lives in geo-point.js. */
export interface GeoPoint {
  lat: number;
  lng: number;
}
/** Decimal pair / DMS / Google-Maps URL / `{lat, lng}` / GeoJSON Point → `{lat, lng}`; out of WGS-84 range → null. */
export function parseGeoPoint(input: unknown): GeoPoint | null;
/** `"55.750000, 37.610000"` (fixed `precision` decimals, default 6); `''` for an empty / invalid point. */
export function formatGeoPoint(pt: unknown, opts?: { precision?: number }): string;
