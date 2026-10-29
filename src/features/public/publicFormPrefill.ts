/**
 * URL prefill for the public form link (/forms/:tableId?<column_name>=…).
 *
 * Only fields the owner flagged with `urlParam` read the query string — a
 * link must not be able to preset arbitrary fields. Values are keyed by
 * column id, the key DynamicFormRenderer and the submit endpoint use.
 */

import type { ColumnModel } from '@/features/tables/types/table.types';
import type { FormField } from '@/features/tables/types/form-config.types';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function coerceParam(raw: string, type: ColumnModel['type']): unknown {
  switch (type) {
    case 'checkbox':
      return TRUTHY.has(raw.trim().toLowerCase());
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case 'multi-select':
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    default:
      return raw;
  }
}

export function buildUrlPrefill(
  fields: FormField[],
  columns: ColumnModel[],
  params: URLSearchParams
): Record<string, unknown> {
  const prefill: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.urlParam) continue;
    const column = columns.find((c) => c.id === String(field.columnId));
    if (!column) continue;
    const raw = params.get(column.name) ?? params.get(column.id);
    if (raw === null) continue;
    prefill[column.id] = coerceParam(raw, column.type);
  }
  return prefill;
}

/** Initial form state: URL prefill wins, then the visible default, then an empty value. */
export function buildInitialFormData(
  fields: FormField[],
  columns: ColumnModel[],
  prefill: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const column = columns.find((c) => c.id === String(field.columnId));
    if (!column) continue;
    if (prefill[column.id] !== undefined) data[column.id] = prefill[column.id];
    else if (field.defaultValue !== undefined && !/^\{\{\w+\}\}$/.test(String(field.defaultValue))) data[column.id] = field.defaultValue;
    else if (column.type === 'checkbox') data[column.id] = false;
    else if (column.type === 'multi-select') data[column.id] = [];
    else data[column.id] = '';
  }
  return data;
}
