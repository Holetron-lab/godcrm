/**
 * Virtual system columns (`created_at`, `updated_at`) injected into every
 * UniversalTable client-side. They are not persisted in `table_columns` — the
 * timestamps already live at `row.created_at` / `row.updated_at`, this util
 * just synthesizes a `ColumnModel` shape so they participate in the normal
 * visibility / settings / hidden-chip UI.
 *
 * Visibility is the only configurable bit; it persists per-table in
 * localStorage because there's no backend row to update.
 */

import type { ColumnModel } from '../types/table.types';

export const SYS_CREATED_AT_ID = '__sys_created_at';
export const SYS_UPDATED_AT_ID = '__sys_updated_at';

const SYSTEM_COLUMN_IDS = new Set<string>([SYS_CREATED_AT_ID, SYS_UPDATED_AT_ID]);

export const isSystemColumnId = (id: string | null | undefined): boolean =>
  !!id && SYSTEM_COLUMN_IDS.has(id);

// Map system column id → top-level row field name (timestamps live outside row.data)
export const getSystemColumnRowField = (id: string): 'created_at' | 'updated_at' | null => {
  if (id === SYS_CREATED_AT_ID) return 'created_at';
  if (id === SYS_UPDATED_AT_ID) return 'updated_at';
  return null;
};

const visibilityKey = (tableId: string | number | null | undefined): string | null => {
  if (tableId == null || tableId === '') return null;
  return `crm.table.${tableId}.systemColumnVisibility`;
};

type SystemVisibility = Record<string, boolean>;

const readVisibility = (tableId: string | number | null | undefined): SystemVisibility => {
  const key = visibilityKey(tableId);
  if (!key || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as SystemVisibility) : {};
  } catch {
    return {};
  }
};

export const getSystemColumnVisibility = (
  tableId: string | number | null | undefined,
  columnId: string
): boolean => readVisibility(tableId)[columnId] === true; // default false = hidden

export const setSystemColumnVisibility = (
  tableId: string | number | null | undefined,
  columnId: string,
  isVisible: boolean
): void => {
  const key = visibilityKey(tableId);
  if (!key || typeof window === 'undefined') return;
  const next: SystemVisibility = { ...readVisibility(tableId), [columnId]: isVisible === true };
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* quota / disabled — ignore */
  }
};

interface BuildArgs {
  tableId: string | number | null | undefined;
  createdLabel: string;
  updatedLabel: string;
}

export const buildSystemColumns = ({ tableId, createdLabel, updatedLabel }: BuildArgs): ColumnModel[] => {
  const tid = tableId != null ? String(tableId) : '';
  const dateConfig = {
    storageFormat: 'iso' as const,
    displayFormat: 'dd.MM.yyyy HH:mm',
    mode: 'datetime' as const,
  };

  const mk = (id: string, name: string, displayName: string, icon: string, order: number): ColumnModel => ({
    id,
    tableId: tid,
    name,
    displayName,
    type: 'datetime',
    config: {
      date: dateConfig,
      appearance: {
        indicator: { type: 'emoji', value: icon },
      },
    },
    isRequired: false,
    isReadonly: true,
    orderIndex: order,
    width: 110,
    isVisible: getSystemColumnVisibility(tableId, id),
  });

  return [
    mk(SYS_CREATED_AT_ID, 'created_at', createdLabel, '🕐', 9998),
    mk(SYS_UPDATED_AT_ID, 'updated_at', updatedLabel, '🕓', 9999),
  ];
};
