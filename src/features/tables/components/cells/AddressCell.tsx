/**
 * ADR-0035-A — `address` cell renderer and the small pure helpers around the value.
 *
 * One line: the label resolves as cell `name` → column `name_template` → `formatted`
 * (§Amendment 1: each step through the shared `resolveRowTemplate`, an empty render
 * falls through, nothing is ever written back). Tooltip = full `formatted`.
 * Click opens an external map: the linked `geo_point` cell when it is filled (same
 * OSM URL as the pin chip), otherwise an OSM search by `formatted`. No tiles in-app.
 * Pasting text onto the cell PUTs the plain string — the server stores `{ formatted }`.
 */

import type { ClipboardEvent } from 'react';
import type { AddressValue } from '../../types/table.types';
import { parseGeoPoint } from '../../../../../shared/geo-point.js';
import { geoPointMapUrl } from './GeoPointCell';
import { resolveRowTemplate } from '../../utils/resolveRowTemplate';

/** The eight structured components (OSM granularity: house number separate from street). */
export const ADDRESS_COMPONENT_KEYS = [
  'country_code', 'country', 'region', 'city', 'street', 'building', 'unit', 'postal_code',
] as const;
/** Reserved for slice B (geocoder): the editor passes them through untouched. */
export const ADDRESS_RESERVED_KEYS = ['provider', 'provider_place_id'] as const;
export const ADDRESS_KEYS = ['formatted', 'name', ...ADDRESS_COMPONENT_KEYS, ...ADDRESS_RESERVED_KEYS] as const;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

/** Stored or typed value → `AddressValue` (allowlisted string keys, trimmed) or null when empty / unusable. */
export const parseAddressValue = (value: unknown): AddressValue | null => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const formatted = value.trim();
    return formatted ? { formatted } : null;
  }
  if (!isPlainObject(value)) return null;
  const out: Record<string, string> = {};
  for (const key of ADDRESS_KEYS) {
    const v = value[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim();
  }
  return out.formatted ? (out as unknown as AddressValue) : null;
};

/**
 * Editor / inline draft → what gets PUT: `''` → null (clears), a JSON object → the
 * object (full value from the editor), anything else → the plain string (server → `{ formatted }`).
 */
export const parseAddressDraft = (draft: string): unknown => {
  const text = draft.trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      /* not JSON → plain address line */
    }
  }
  return text;
};

/** Client-side sort key: alphabetical by the stored `formatted` line. */
export const addressSortKey = (value: unknown): string => parseAddressValue(value)?.formatted ?? '';

export const addressSearchUrl = (formatted: string): string =>
  `https://www.openstreetmap.org/search?query=${encodeURIComponent(formatted)}`;

/** Linked point filled → OSM at the point (same URL as the pin chip); otherwise OSM search by `formatted`. */
export const addressMapUrl = (address: AddressValue, linkedPoint?: unknown): string => {
  const point = parseGeoPoint(linkedPoint);
  return point ? geoPointMapUrl(point) : addressSearchUrl(address.formatted);
};

/** Label: cell `name` → column `name_template` → `formatted`; empty renders fall through. */
export const resolveAddressLabel = (
  address: AddressValue,
  rowData: Record<string, unknown> = {},
  nameTemplate?: string | null
): string => {
  for (const candidate of [address.name, nameTemplate]) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const rendered = resolveRowTemplate(candidate, rowData).trim();
    if (rendered) return rendered;
  }
  return address.formatted;
};

interface AddressCellProps {
  value: unknown;
  rawMode?: boolean;
  readOnly?: boolean;
  /** Row data (keyed by column name, plus `id` / `row_id`) for `{{column_key}}` templates. */
  rowData?: Record<string, unknown>;
  /** `config.address.name_template` of the column. */
  nameTemplate?: string | null;
  /** Value of the linked `geo_point` cell of this row (any shape the shared parser accepts). */
  linkedPoint?: unknown;
  /** Called with the pasted text; the caller PUTs the plain string. */
  onPasteAddress?: (text: string) => void;
}

export const AddressCell = ({ value, rawMode, readOnly, rowData = {}, nameTemplate, linkedPoint, onPasteAddress }: AddressCellProps) => {
  const address = parseAddressValue(value);

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
    if (readOnly || !onPasteAddress) return;
    const text = event.clipboardData.getData('text').trim();
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    onPasteAddress(text);
  };

  if (!address) {
    // Empty cell — still a paste target so an address can be entered without the editor.
    return <span data-testid="address-empty" className="block h-full w-full min-h-[1rem]" onPaste={handlePaste} />;
  }

  const label = resolveAddressLabel(address, rowData, nameTemplate);

  return (
    <span className="inline-flex max-w-full items-center" onPaste={handlePaste}>
      <a
        data-testid="address-chip"
        href={addressMapUrl(address, linkedPoint)}
        target="_blank"
        rel="noopener noreferrer"
        title={address.formatted}
        onClick={(event) => event.stopPropagation()}
        className="inline-flex max-w-full items-center gap-1 text-sm text-[var(--text-primary)] hover:text-[var(--color-primary-500)] hover:underline"
      >
        <span aria-hidden="true">📮</span>
        <span className="truncate">{label}</span>
      </a>
    </span>
  );
};
