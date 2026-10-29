/**
 * ADR-0035 Slice 1 (S1.6) — `geo_point` cell renderer.
 *
 * Pin chip `📍 55.7500, 37.6100` (4 decimals; the raw sibling shows 6). Click
 * opens the point in an external map (OpenStreetMap) — no tiles in-app. Pasting
 * coordinates onto the chip (`55.75, 37.61`, DMS, a Google-Maps URL) goes
 * through the one shared parser and PUTs the parent cell. Empty → empty cell.
 */

import type { ClipboardEvent } from 'react';
import { formatGeoPoint, parseGeoPoint } from '../../../../../shared/geo-point.js';

interface GeoPointCellProps {
  value: unknown;
  rawMode?: boolean;
  readOnly?: boolean;
  /** Called with the parsed point when valid coordinates are pasted onto the chip. */
  onPastePoint?: (point: { lat: number; lng: number }) => void;
}

export const CHIP_PRECISION = 4;

export const geoPointMapUrl = (point: { lat: number; lng: number }): string =>
  `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=16/${point.lat}/${point.lng}`;

export const GeoPointCell = ({ value, rawMode, readOnly, onPastePoint }: GeoPointCellProps) => {
  const point = parseGeoPoint(value);

  if (rawMode) {
    if (value === null || value === undefined || value === '') {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)] truncate">
        {typeof value === 'string' ? value : JSON.stringify(value)}
      </span>
    );
  }

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    if (readOnly || !onPastePoint) return;
    const pasted = parseGeoPoint(event.clipboardData.getData('text'));
    if (!pasted) return;
    event.preventDefault();
    event.stopPropagation();
    onPastePoint(pasted);
  };

  if (!point) {
    // Empty cell — still a paste target so a point can be entered without the editor.
    return <span data-testid="geo-point-empty" className="block h-full w-full min-h-[1rem]" onPaste={handlePaste} />;
  }

  return (
    <span className="inline-flex max-w-full items-center" onPaste={handlePaste}>
      <a
        data-testid="geo-point-chip"
        href={geoPointMapUrl(point)}
        target="_blank"
        rel="noopener noreferrer"
        title={`${formatGeoPoint(point)} — OpenStreetMap`}
        onClick={(event) => event.stopPropagation()}
        className="inline-flex items-center whitespace-nowrap rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-0.5 font-mono text-xs text-[var(--text-primary)] hover:border-[var(--color-primary-500)] hover:text-[var(--color-primary-500)]"
      >
        {`📍 ${formatGeoPoint(point, { precision: CHIP_PRECISION })}`}
      </a>
    </span>
  );
};
