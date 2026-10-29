import { tablesApi } from '../api/tablesApi';
import type { RowModel } from '../types/table.types';

export interface FetchAllTableRowsOptions {
  rawMode?: boolean;
  sortColumn?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
}

const PAGE_SIZE = 1000;

/**
 * Every row of a table, read page by page from the server.
 * The view only holds the loaded window, so whole-table operations
 * (print, "all rows" replace) must not rely on what is in the store.
 */
export async function fetchAllTableRows(
  tableId: string,
  { rawMode = false, sortColumn = null, sortDirection = null }: FetchAllTableRowsOptions = {}
): Promise<RowModel[]> {
  const first = await tablesApi.getRows(tableId, 1, PAGE_SIZE, rawMode, sortColumn, sortDirection);
  const all = [...first.rows];
  for (let page = 2; page <= (first.pagination?.pages ?? 1); page++) {
    const next = await tablesApi.getRows(tableId, page, PAGE_SIZE, rawMode, sortColumn, sortDirection);
    all.push(...next.rows);
  }
  return all;
}
