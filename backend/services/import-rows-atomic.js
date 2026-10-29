import { createHash } from 'node:crypto';
import { z } from 'zod';
import { withTransactionAsync, safeJsonParse } from '../database/connection.js';
import { resolveSelectValues } from './SelectValueResolver.js';
import { validateColumnValue } from './ColumnService.js';

const inputSchema = z.object({
  importId: z.string().uuid(),
  mode: z.literal('add').default('add'),
  rows: z.array(z.record(z.union([z.string().max(32767), z.number().finite(), z.boolean(), z.null()])))
    .min(1).max(10000),
}).strict();
const digest = value => createHash('sha256').update(value).digest('hex');
const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_IMPORT', status: 400 }); };

// Optional retry-safe mode on the existing rows/import route. A key identifies
// one fixed batch for one user/table. Row base_ids retain its payload digest;
// retry never overwrites later edits or silently imports a different selection.
export async function importRowsAtomically(tableId, userId, body) {
  const input = inputSchema.safeParse(body);
  if (!input.success) invalid('Некорректные данные импорта: нужен importId (UUID), mode=add и 1–10000 строк.');
  const { importId, rows } = input.data;
  if (rows.reduce((sum, row) => sum + Object.keys(row).length, 0) > 200000) invalid('Превышен лимит 200000 ячеек.');
  const canonicalRows = rows.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
  const payload = JSON.stringify(canonicalRows);
  if (Buffer.byteLength(payload) > 8 * 1024 * 1024) invalid('Превышен лимит 8 МиБ данных.');
  const prefix = `import-${digest(`${tableId}:${userId}:${importId}`)}-`;
  const payloadDigest = digest(payload);
  const baseIds = rows.map((_, i) => `${prefix}${payloadDigest}-${i}`);
  return withTransactionAsync(async trx => {
    // Serializes even requests arriving at different server workers. No migration.
    const table = await trx.get('SELECT id FROM universal_tables WHERE id = ? FOR UPDATE', [tableId]);
    if (!table) invalid('Таблица отсутствует.');
    const existing = await trx.all('SELECT base_id FROM table_rows WHERE table_id = ? AND base_id LIKE ?', [tableId, `${prefix}%`]);
    if (existing.length) {
      const expected = new Set(baseIds);
      if (existing.length !== rows.length || existing.some(row => !expected.has(row.base_id))) {
        throw Object.assign(new Error('Этот importId уже использован с другим набором данных или импортированные строки были удалены.'), { code: 'IMPORT_CONFLICT', status: 409 });
      }
      return { stats: { added: 0, updated: 0, skipped: 0, errors: [] }, imported: rows.length, replayed: true };
    }
    const columns = await trx.all('SELECT * FROM table_columns WHERE table_id = ?', [tableId]);
    const columnMap = new Map(columns.flatMap(col => [[col.column_name, col], [String(col.id), col]]));
    const hasSelect = columns.some(col => ['select', 'multi_select'].includes(col.type));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!Object.keys(row).length) invalid(`Строка ${i + 1}: нет выбранных колонок.`);
      for (const col of columns.filter(c => c.is_required)) {
        if ([null, undefined, ''].includes(row[col.column_name] ?? row[String(col.id)])) invalid(`Строка ${i + 1}: обязательная колонка ${col.column_name}.`);
      }
      const seen = new Set();
      for (const [key, value] of Object.entries(row)) {
        const col = columnMap.get(key);
        if (!col || seen.has(col.id)) invalid(`Строка ${i + 1}: неизвестная или повторная колонка ${key}.`);
        seen.add(col.id);
        const excelDatetime = col.type === 'datetime' && !safeJsonParse(col.config)?.date?.mode &&
          z.string().datetime({ local: true, offset: true }).safeParse(value).success;
        if (value !== null && !['select', 'multi_select'].includes(col.type) &&
            !excelDatetime &&
            !validateColumnValue({ ...col, config: safeJsonParse(col.config) || {} }, value)) {
          invalid(`Строка ${i + 1}: значение не соответствует типу колонки ${key}.`);
        }
      }
      const resolved = hasSelect ? await resolveSelectValues(tableId, row) : { resolvedData: row, errors: [] };
      if (resolved.errors.length) invalid(`Строка ${i + 1}: ${resolved.errors.join('; ')}`);
      await trx.run('INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
        [tableId, baseIds[i], JSON.stringify(resolved.resolvedData), userId]);
    }
    return { stats: { added: rows.length, updated: 0, skipped: 0, errors: [] }, imported: rows.length, replayed: false };
  });
}
