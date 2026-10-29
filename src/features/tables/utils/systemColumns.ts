/**
 * Virtual columns injected into every UniversalTable client-side. None of them
 * is persisted in `table_columns`; this util synthesizes a `ColumnModel` shape so
 * they participate in the normal visibility / settings / hidden-chip UI.
 *
 * One family uses the mechanism: the system timestamps (`created_at`,
 * `updated_at`). The values already live at `row.created_at` / `row.updated_at`;
 * read-only, hidden by default.
 *
 * (ADR-0035 Slice 1 briefly added a second family — the virtual raw `lat, lng`
 * sibling of a `geo_point` column. ADR-0035-A removed it: the point is edited
 * inline / by paste, and the «second column» is now the real `address` type.
 * The server-side flag `config.geo.raw_sibling` is ignored by the frontend.)
 *
 * Presentation settings (visibility, title, icon/colour, date format, width,
 * alignment, wrap) persist per-table in localStorage because there's no
 * backend row to update. The key (`name`), type and read-only flag are fixed.
 */

import type { ColumnConfig, ColumnModel } from '../types/table.types';

export const SYS_CREATED_AT_ID = '__sys_created_at';
export const SYS_UPDATED_AT_ID = '__sys_updated_at';

const SYSTEM_COLUMN_IDS = new Set<string>([SYS_CREATED_AT_ID, SYS_UPDATED_AT_ID]);

/** True for every client-synthesized column (timestamps): no backend row, settings in localStorage. */
export const isSystemColumnId = (id: string | null | undefined): boolean => !!id && SYSTEM_COLUMN_IDS.has(id);

// Map system column id → top-level row field name (timestamps live outside row.data)
export const getSystemColumnRowField = (id: string): 'created_at' | 'updated_at' | null => {
  if (id === SYS_CREATED_AT_ID) return 'created_at';
  if (id === SYS_UPDATED_AT_ID) return 'updated_at';
  return null;
};

/** The subset of ColumnModel a user may change on a system column. */
export type SystemColumnOverride = Pick<Partial<ColumnModel>, 'isVisible' | 'displayName' | 'width' | 'config'>;

type SystemOverrides = Record<string, SystemColumnOverride>;

const overridesKey = (tableId: string | number | null | undefined): string | null => {
  if (tableId == null || tableId === '') return null;
  return `crm.table.${tableId}.systemColumns`;
};

// Pre-override storage held visibility only; read as a fallback so earlier choices survive.
const legacyVisibilityKey = (tableId: string | number | null | undefined): string | null => {
  if (tableId == null || tableId === '') return null;
  return `crm.table.${tableId}.systemColumnVisibility`;
};

const readJson = (key: string | null): Record<string, unknown> => {
  if (!key || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const getSystemColumnOverrides = (tableId: string | number | null | undefined): SystemOverrides => {
  const merged = { ...(readJson(overridesKey(tableId)) as SystemOverrides) };
  const legacy = readJson(legacyVisibilityKey(tableId)) as Record<string, boolean>;
  for (const id of SYSTEM_COLUMN_IDS) {
    if (merged[id]?.isVisible === undefined && legacy[id] === true) {
      merged[id] = { ...merged[id], isVisible: true };
    }
  }
  return merged;
};

/** Shallow-merge `patch` into the stored override of one system column (undefined fields are ignored). */
export const setSystemColumnOverride = (
  tableId: string | number | null | undefined,
  columnId: string,
  patch: SystemColumnOverride
): void => {
  const key = overridesKey(tableId);
  if (!key || typeof window === 'undefined' || !isSystemColumnId(columnId)) return;
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as SystemColumnOverride;
  const current = getSystemColumnOverrides(tableId);
  const next: SystemOverrides = { ...current, [columnId]: { ...current[columnId], ...defined } };
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* quota / disabled — ignore */
  }
};

export const getSystemColumnVisibility = (
  tableId: string | number | null | undefined,
  columnId: string
): boolean => getSystemColumnOverrides(tableId)[columnId]?.isVisible === true; // default false = hidden

export const setSystemColumnVisibility = (
  tableId: string | number | null | undefined,
  columnId: string,
  isVisible: boolean
): void => setSystemColumnOverride(tableId, columnId, { isVisible: isVisible === true });

interface BuildArgs {
  tableId: string | number | null | undefined;
  createdLabel: string;
  updatedLabel: string;
}

export const SYSTEM_COLUMN_DEFAULT_WIDTH = 160;

export const buildSystemColumns = ({ tableId, createdLabel, updatedLabel }: BuildArgs): ColumnModel[] => {
  const tid = tableId != null ? String(tableId) : '';
  const overrides = getSystemColumnOverrides(tableId);

  const mk = (id: string, name: string, displayName: string, icon: string, order: number): ColumnModel => {
    const override = overrides[id] ?? {};
    const defaultConfig: ColumnConfig = {
      date: { storageFormat: 'iso', displayFormat: 'datetime_default', mode: 'datetime' },
      appearance: { indicator: { type: 'emoji', value: icon } },
    };
    return {
      id,
      tableId: tid,
      name,
      displayName: override.displayName?.trim() ? override.displayName : displayName,
      type: 'datetime',
      config: { ...defaultConfig, ...override.config },
      isRequired: false,
      isReadonly: true,
      orderIndex: order,
      width: override.width ?? SYSTEM_COLUMN_DEFAULT_WIDTH,
      isVisible: override.isVisible === true,
    };
  };

  return [
    mk(SYS_CREATED_AT_ID, 'created_at', createdLabel, '🕐', 9998),
    mk(SYS_UPDATED_AT_ID, 'updated_at', updatedLabel, '🕓', 9999),
  ];
};
