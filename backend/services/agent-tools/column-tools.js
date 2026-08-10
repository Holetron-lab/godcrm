/**
 * Column Tool Handlers (ADR-144 P0)
 *
 * Handles: manage_columns (create/update/delete columns)
 */

import { dbGet, dbRun, dbAll, sqlNow } from '../../database/connection.js';

export const columnToolHandlers = {
  async manage_columns({ table_id, action, column_id, name, type, config = {} }, userId) {
    const table = await dbGet('SELECT id FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) return { error: `Table ${table_id} not found` };

    switch (action) {
      case 'create': {
        if (!name || !type) return { error: 'name and type are required for create' };
        const columnName = name.toLowerCase().replace(/\s+/g, '_');
        const maxOrder = await dbGet(
          'SELECT COALESCE(MAX(order_index), 0) as max_order FROM table_columns WHERE table_id = ?',
          [table_id]
        );
        const result = await dbRun(`
          INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
        `, [table_id, columnName, name, type, JSON.stringify({ icon: '📝', ...config }), config.width || 150, config.required ? 1 : 0, (maxOrder?.max_order || 0) + 1]);
        return { success: true, column_id: result.lastInsertRowid, message: `Column "${name}" created` };
      }

      case 'update': {
        if (!column_id) return { error: 'column_id is required for update' };
        const col = await dbGet('SELECT * FROM table_columns WHERE id = ? AND table_id = ?', [column_id, table_id]);
        if (!col) return { error: `Column ${column_id} not found` };

        const updates = [];
        const params = [];
        if (name) { updates.push('display_name = ?'); params.push(name); }
        if (type) { updates.push('type = ?'); params.push(type); }
        if (Object.keys(config).length > 0) { updates.push('config = ?'); params.push(JSON.stringify(config)); }
        if (updates.length === 0) return { error: 'No fields to update' };

        updates.push(`updated_at = ${sqlNow()}`);
        params.push(column_id, table_id);
        await dbRun(`UPDATE table_columns SET ${updates.join(', ')} WHERE id = ? AND table_id = ?`, params);
        return { success: true, message: `Column ${column_id} updated` };
      }

      case 'delete': {
        if (!column_id) return { error: 'column_id is required for delete' };
        const col = await dbGet('SELECT id FROM table_columns WHERE id = ? AND table_id = ?', [column_id, table_id]);
        if (!col) return { error: `Column ${column_id} not found` };
        await dbRun('DELETE FROM table_columns WHERE id = ? AND table_id = ?', [column_id, table_id]);
        return { success: true, message: `Column ${column_id} deleted` };
      }

      default:
        return { error: `Unknown action: ${action}. Use create, update, or delete` };
    }
  }
};
