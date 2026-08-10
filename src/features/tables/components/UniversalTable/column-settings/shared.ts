/**
 * Shared utilities and types for ColumnSettingsDrawer tabs
 */
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { ColumnType } from '@/shared/types';

// Color options generated dynamically using translations
export const getColorOptionsWithTranslations = (t: (key: string) => string) => [
  { value: 'gray', label: t('colors.gray'), color: '#6b7280' },
  { value: 'red', label: t('colors.red'), color: '#ef4444' },
  { value: 'orange', label: t('colors.orange'), color: '#f97316' },
  { value: 'yellow', label: t('colors.yellow'), color: '#eab308' },
  { value: 'green', label: t('colors.green'), color: '#22c55e' },
  { value: 'blue', label: t('colors.blue'), color: '#3b82f6' },
  { value: 'purple', label: t('colors.purple'), color: '#8b5cf6' },
  { value: 'pink', label: t('colors.pink'), color: '#ec4899' },
];

// Color palette for options without color
export const defaultColors = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

export const getDefaultColor = (index: number) => defaultColors[index % defaultColors.length];

// Tabs generated dynamically using translations
export const getTabsWithTranslations = (t: (key: string) => string) => [
  { id: 'display', label: t('columnSettings.tabs.display') },
  { id: 'relation', label: t('columnSettings.tabs.relation') },
  { id: 'type', label: t('columnSettings.tabs.type') },
  { id: 'cell', label: t('columnSettings.tabs.cell') },
  { id: 'summary', label: t('columnSettings.tabs.summary') },
  { id: 'backLink', label: t('columnSettings.tabs.backLink') },
  { id: 'automation', label: t('columnSettings.tabs.automation') },
  { id: 'access', label: t('columnSettings.tabs.access') }
] as const;

// Validation rule type
export interface ValidationRule {
  id: string;
  name: string;
  enabled: boolean;
  type: 'regex' | 'length' | 'range' | 'custom';
  config: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    customJs?: string;
  };
  errorMessage: string;
}

// Props for the main drawer
export interface ColumnSettingsDrawerProps {
  column: ColumnModel | null;
  currentWidth?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (columnId: string, payload: Partial<ColumnModel>) => void;
  onDelete?: (columnId: string) => void;
  saving?: boolean;
  deleting?: boolean;
  projectId?: number;
  tableId?: number;
  spaceId?: number;
  tableName?: string;
  spaceName?: string;
  projectName?: string;
  rows?: Array<{ id: string; data: Record<string, unknown> }>;
  allColumns?: ColumnModel[];
  isExternalTable?: boolean;
}

export type TabId = 'display' | 'relation' | 'type' | 'cell' | 'summary' | 'backLink' | 'automation' | 'access';

// Translation function type
// The second argument is optional and used for default/param fallbacks in some call sites
export type TFunction = (key: string, params?: Record<string, string | number>) => string;

// Собирает уникальные значения из rows для колонки
export const collectUniqueValues = (
  rows: Array<{ id: string; data: Record<string, unknown> }>,
  colName: string,
  colId: string
): string[] => {
  const valuesSet = new Set<string>();
  rows.forEach(row => {
    const value = row.data[colName] ?? row.data[colId];
    if (value !== null && value !== undefined && value !== '') {
      const strValue = String(value);
      if (strValue.includes(',')) {
        strValue.split(',').forEach(v => {
          const trimmed = v.trim();
          if (trimmed) valuesSet.add(trimmed);
        });
      } else {
        valuesSet.add(strValue);
      }
    }
  });
  return Array.from(valuesSet).sort();
};
