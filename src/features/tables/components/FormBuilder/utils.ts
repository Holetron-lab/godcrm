import type { ColumnModel } from '../../types/table.types';
import type { FormConfig } from '../../types/form-config.types';

// Generate default form config from columns
export function generateDefaultFormConfig(columns: ColumnModel[]): FormConfig {
  return {
    version: 1,
    layout: 'grid',
    columns: 2,
    pages: 1,
    fields: columns
      .filter(c => !['id', 'created_at', 'updated_at'].includes(c.name.toLowerCase()))
      .map((col, idx) => ({
        id: `field_${col.id}`,
        type: 'field' as const,
        columnId: col.id,
        label: col.displayName || col.name,
        width: col.type === 'text' ? 'full' : 'half',
        order: idx,
        page: 1,
      })),
    elements: [],
    settings: {
      showLabels: true,
      viewMode: 'standard',
      labelPosition: 'top',
      spacing: 'normal',
    },
  };
}

// Unique ID generator
let idCounter = 0;
export const generateId = (prefix: string) => `${prefix}_${Date.now()}_${++idCounter}`;

// Calculate grid column span from width
export function getColSpan(width: string | undefined): string {
  switch (width) {
    case 'quarter': return 'col-span-3';
    case 'third': return 'col-span-4';
    case 'half': return 'col-span-6';
    case 'full':
    default: return 'col-span-12';
  }
}
