/**
 * Utilities for importing/exporting select column options (CSV, table)
 * Extracted from ColumnSettingsDrawer for modularity
 */
import { logger } from '@/shared/utils/logger';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { getDefaultColor } from './shared';

/**
 * Export options to CSV file
 */
export const exportOptionsCsv = (draft: ColumnModel) => {
  if (!draft) return;
  const options = draft.config?.options || [];
  if (options.length === 0) return;

  const csvLines = ['value,label,color'];
  options.forEach(opt => {
    const escapeField = (field: string) => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };
    csvLines.push(`${escapeField(opt.value)},${escapeField(opt.label)},${opt.color || '#6366f1'}`);
  });

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${draft.name || 'options'}_options.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Parse CSV text into options array
 */
export const parseCsvOptions = (text: string): Array<{ value: string; label: string; color?: string }> | null => {
  if (!text) return null;

  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length <= 1) return null; // Only header or empty

  const newOptions: Array<{ value: string; label: string; color?: string }> = [];

  const parseCSVLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length >= 2) {
      newOptions.push({
        value: fields[0],
        label: fields[1],
        color: fields[2] || getDefaultColor(i - 1)
      });
    }
  }

  return newOptions.length > 0 ? newOptions : null;
};

/**
 * Import options from another table via API
 */
export const importOptionsFromTable = async (
  importTableId: string,
  importValueColumn: string,
  importLabelColumn: string,
): Promise<Array<{ value: string; label: string; color: string }>> => {
  const response = await fetch(`/api/tables/${importTableId}/rows`);
  if (!response.ok) throw new Error('Failed to fetch table data');

  const data = await response.json();
  const tableRows = data.rows || data || [];

  const optionsMap = new Map<string, { value: string; label: string; color: string }>();

  tableRows.forEach((row: Record<string, unknown>) => {
    const rowData = (row.data || row) as Record<string, unknown>;
    const value = rowData[importValueColumn];
    const label = rowData[importLabelColumn];

    if (value !== null && value !== undefined && value !== '') {
      const strValue = String(value);
      if (!optionsMap.has(strValue)) {
        optionsMap.set(strValue, {
          value: strValue,
          label: label ? String(label) : strValue,
          color: getDefaultColor(optionsMap.size)
        });
      }
    }
  });

  return Array.from(optionsMap.values());
};
