import { tablesApi } from '@/features/tables/api/tablesApi';
import type { RowModel } from '@/features/tables/types/table.types';

/** Never render a financial total from a silently truncated page. */
export async function loadSupplies(tableId: number): Promise<RowModel[]> {
  const rows: RowModel[] = [];
  let total: number | undefined;
  for (let page = 1; page <= 1000; page++) {
    const result = await tablesApi.getRows(String(tableId), page, 500, true, '__row_id', 'asc');
    if (!Number.isSafeInteger(result.pagination.total) || result.pagination.total < 0) throw new Error('Не удалось проверить полноту данных');
    total ??= result.pagination.total;
    if (total !== result.pagination.total) throw new Error('Данные изменились во время загрузки. Обновите сводку');
    rows.push(...result.rows);
    if (rows.length >= total) {
      if (rows.length !== total || new Set(rows.map(row => String(row.id))).size !== total) throw new Error('Получены неполные данные. Обновите сводку');
      return rows;
    }
    if (!result.rows.length) break;
  }
  throw new Error('Не удалось загрузить все поставки. Сводка недоступна');
}
