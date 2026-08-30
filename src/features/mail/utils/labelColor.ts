// ADR-158 §P4 — shared label-colour helper. Labels store a `#rrggbb` colour; the
// chips and the reader tag-bar both need a faint fill derived from it, so the
// conversion lives here once (single source of truth).

/** `#rrggbb` → `rgba(r,g,b,alpha)`; returns undefined for anything unparseable. */
export function hexToRgba(hex: string, alpha: number): string | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const int = parseInt(m[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

/**
 * Row-tint identical to the Universal Table color-column fill
 * (`features/tables/utils/rowColorStyle.ts`, background mode): `#rrggbb` + an
 * 8-bit alpha suffix at the same default 0.15 opacity, so a colorised mail row
 * reads the same as a colorised table row. Returns undefined for bad input.
 */
export function rowTintFromHex(hex: string, opacity = 0.15): string | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${m[1]}${alpha}`;
}
