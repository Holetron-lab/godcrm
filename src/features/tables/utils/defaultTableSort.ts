import type { ColumnModel, Sort } from '../types/table.types';

// The rows API supports one sort key; use the first configured column.
export function getDefaultTableSort(columns: ColumnModel[]): Sort | null {
  const column = columns.find(item => item.config?.defaultSort === 'asc' || item.config?.defaultSort === 'desc');
  const direction = column?.config?.defaultSort;
  return column && direction ? { column: column.id, direction } : null;
}
