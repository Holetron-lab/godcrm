import type { ColumnModel } from '../types/table.types';

/**
 * Get min/max size constraints for a column based on its type
 */
export const getColumnMinMaxSize = (column: ColumnModel) => {
  switch (column.type) {
    case 'checkbox':
      return { minSize: 60, maxSize: 100 };
    case 'number':
      return { minSize: 80, maxSize: 200 };
    case 'date':
    case 'datetime':
      return { minSize: 140, maxSize: 1200 };
    case 'email':
    case 'url':
      return { minSize: 150, maxSize: 1200 };
    case 'phone':
      return { minSize: 120, maxSize: 1200 };
    case 'password':
      return { minSize: 100, maxSize: 1200 };
    case 'select':
      return { minSize: 100, maxSize: 1200 };
    case 'multi-select':
      return { minSize: 150, maxSize: 1200 };
    case 'text':
    default:
      return { minSize: 120, maxSize: 1200 };
  }
};

/**
 * Get default column size based on type (when no width is set)
 */
export const getDefaultColumnSize = (column: ColumnModel) => {
  switch (column.type) {
    case 'checkbox':
      return 80;
    case 'number':
      return 120;
    case 'date':
    case 'datetime':
      return 180;
    case 'email':
      return 220;
    case 'phone':
      return 160;
    case 'url':
      return 250;
    case 'select':
      return 150;
    case 'multi-select':
      return 200;
    case 'password':
      return 140;
    case 'text':
    default:
      // For text, estimate based on display name length
      const nameLength = (column.displayName || column.name).length;
      return Math.max(150, Math.min(300, nameLength * 10 + 100));
  }
};

/**
 * Get effective column size (respecting min/max constraints)
 */
export const getEffectiveColumnSize = (column: ColumnModel, currentWidth?: number) => {
  const { minSize, maxSize } = getColumnMinMaxSize(column);
  const width = currentWidth ?? column.width ?? getDefaultColumnSize(column);
  return Math.max(minSize, Math.min(maxSize, width));
};
