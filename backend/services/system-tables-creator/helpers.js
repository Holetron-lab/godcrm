// system-tables-creator/helpers.js
// Shared helper for inserting table columns

import { dbRun, toBool } from '../../database/connection.js';

/**
 * Insert columns for a table
 * @param {number} tableId - Table ID
 * @param {Array} columns - Column definitions
 */
export async function insertColumns(tableId, columns) {
  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config,
        order_index, is_required, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tableId,
      col.name,
      col.display,
      col.type,
      col.config ? JSON.stringify(col.config) : null,
      col.order,
      toBool(col.is_required),
      toBool(col.is_system)
    ]);
  }
}
