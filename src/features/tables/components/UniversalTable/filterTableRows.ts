import type { ColumnModel, RowModel } from '../../types/table.types';
import type { UniversalTableProps } from './types';
import { parseMultiSelectValue } from './renderCellValue';

type TableFilters = Required<Pick<UniversalTableProps, 'searchQuery' | 'searchColumns' | 'selectFilters' | 'dateFilters'>>;

export function filterTableRows(allRows: RowModel[], columnsRaw: ColumnModel[], { searchQuery, searchColumns, selectFilters, dateFilters }: TableFilters): RowModel[] {
  const columnIdToName = columnsRaw.reduce((acc, col) => {
    acc[col.id] = col.name;
    return acc;
  }, {} as Record<string, string>);

  let filtered = allRows;

  // Apply search filter
  if (searchQuery) {
    const searchLower = searchQuery.toLowerCase();
    filtered = filtered.filter(row => {
      if (searchColumns.length > 0) {
        return searchColumns.some(columnId => {
          const value = row.data[columnId] ?? row.data[columnIdToName[columnId]];
          return String(value ?? '').toLowerCase().includes(searchLower);
        });
      }
      return Object.values(row.data).some(value =>
        String(value).toLowerCase().includes(searchLower)
      );
    });
  }

  // Apply select filters
  const activeSelectFilters = Object.entries(selectFilters).filter(([_, values]) => values.length > 0);
  if (activeSelectFilters.length > 0) {
    filtered = filtered.filter(row => {
      return activeSelectFilters.every(([columnId, selectedValues]) => {
        const cellValue = row.data[columnId] ?? row.data[columnIdToName[columnId]];
        const parsedValues = parseMultiSelectValue(cellValue);
        return parsedValues.some(v => selectedValues.includes(v));
      });
    });
  }

  // Apply date filters
  const activeDateFilters = Object.entries(dateFilters).filter(([_, range]) => range.from || range.to);
  if (activeDateFilters.length > 0) {
    filtered = filtered.filter(row => {
      return activeDateFilters.every(([columnId, range]) => {
        const cellValue = row.data[columnId] ?? row.data[columnIdToName[columnId]];
        if (!cellValue) return false;

        const cellDate = new Date(String(cellValue));
        if (isNaN(cellDate.getTime())) return false;

        if (range.from) {
          const fromDate = new Date(range.from);
          if (cellDate < fromDate) return false;
        }

        if (range.to) {
          const toDate = new Date(range.to);
          toDate.setHours(23, 59, 59, 999);
          if (cellDate > toDate) return false;
        }

        return true;
      });
    });
  }

  return filtered;
}
