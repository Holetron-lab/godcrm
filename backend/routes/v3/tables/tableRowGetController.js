/**
 * Table single-row get controller
 * Handles: GET /tables/:tableId/rows/base/:baseId,
 *          GET /tables/:tableId/rows/:rowId
 */
import express from 'express';
import { dbAll, dbGet, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, forbidden, error } from '../../../utils/response.js';
import { checkTableAccess } from './helpers.js';

const router = express.Router();

/**
 * GET /api/v3/tables/:tableId/rows/base/:baseId
 * Get a single row by base_id
 * IMPORTANT: Must be defined BEFORE /:rowId route to avoid Express param conflict
 */
router.get('/tables/:tableId/rows/base/:baseId', async (req, res) => {
  try {
    const { tableId, baseId } = req.params;

    if (req.user?.projectId) {
      const access = await checkTableAccess(tableId, req.user);
      if (!access.allowed) {
        return forbidden(res, access.error);
      }
    }

    apiLogger.debug({ tableId, baseId }, 'GET single row by base_id request');

    const table = await dbGet(`
      SELECT data_source_id, source_table_name, source_id_column, is_system, sync_target, project_id
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    // System table
    if (table && table.is_system && table.sync_target) {
      const { getSystemTableData } = await import('../../../services/SystemTableService.js');
      const systemRows = await getSystemTableData(table.sync_target, table.project_id);
      const row = systemRows.find(r => String(r.base_id || r.id) === String(baseId));
      if (!row) {
        return notFound(res, 'Row');
      }
      return success(res, { row });
    }

    // External data source
    if (table && table.data_source_id && table.source_table_name) {
      const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
      const dataSourceService = new DataSourceService();
      const dataSource = await dataSourceService.get(table.data_source_id);

      if (dataSource.type === 'internal') {
        const idColumn = table.source_id_column || 'id';
        const sourceRow = await dbGet(
          `SELECT * FROM "${table.source_table_name}" WHERE "${idColumn}" = ?`,
          [baseId]
        );

        if (!sourceRow) {
          return notFound(res, 'Row');
        }

        const columns = await dbAll('SELECT * FROM table_columns WHERE table_id = ?', [tableId]);
        const data = {};
        columns.forEach(col => {
          if (sourceRow[col.column_name] !== undefined) {
            data[col.id] = sourceRow[col.column_name];
          }
        });

        return success(res, {
          row: {
            id: sourceRow[idColumn] || baseId,
            table_id: Number(tableId),
            base_id: baseId,
            data,
            created_at: sourceRow.created_at || new Date().toISOString(),
            updated_at: sourceRow.updated_at || new Date().toISOString()
          }
        });
      }

      if (dataSource.type === 'local_mysql') {
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection({
          host: dataSource.db_host,
          port: dataSource.db_port,
          database: dataSource.db_name,
          user: dataSource.db_username,
          password: ''
        });

        try {
          const idColumn = table.source_id_column || 'id';
          const [rows] = await connection.execute(
            `SELECT * FROM \`${table.source_table_name}\` WHERE \`${idColumn}\` = ? LIMIT 1`,
            [baseId]
          );

          if (!rows.length) {
            return notFound(res, 'Row');
          }

          return success(res, {
            row: {
              id: baseId,
              table_id: Number(tableId),
              data: rows[0],
              created_at: rows[0].created_at || new Date().toISOString(),
              updated_at: rows[0].updated_at || new Date().toISOString()
            }
          });
        } finally {
          await connection.end();
        }
      }
    }

    // Default: internal table_rows
    const row = await dbGet('SELECT * FROM table_rows WHERE base_id = ? AND table_id = ?', [baseId, tableId]);

    if (!row) {
      return notFound(res, 'Row');
    }

    let parsedData = safeJsonParse(row.data, {});
    if (typeof parsedData === 'object' && !parsedData.id) {
      parsedData.id = row.id;
    }

    const columns = await dbAll(
      'SELECT id, column_name, display_name, type, config FROM table_columns WHERE table_id = ? ORDER BY order_index',
      [tableId]
    );

    success(res, {
      row: {
        id: row.id,
        base_id: row.base_id,
        table_id: row.table_id,
        data: parsedData,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      columns: columns.map(c => ({
        id: c.id,
        column_name: c.column_name,
        display_name: c.display_name,
        type: c.type,
        config: safeJsonParse(c.config, {})
      }))
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /tables/:tableId/rows/base/:baseId error');
    error(res, 'ROW_FETCH_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/tables/:tableId/rows/:rowId
 * Get a single row by ID (numeric id, falls back to base_id)
 */
router.get('/tables/:tableId/rows/:rowId', async (req, res) => {
  try {
    const { tableId, rowId } = req.params;

    if (req.user?.projectId) {
      const access = await checkTableAccess(tableId, req.user);
      if (!access.allowed) {
        return forbidden(res, access.error);
      }
    }

    apiLogger.debug({ tableId, rowId }, 'GET single row request');

    const table = await dbGet(`
      SELECT data_source_id, source_table_name, source_id_column, is_system, sync_target, project_id
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    // System table
    if (table && table.is_system && table.sync_target) {
      const { getSystemTableData } = await import('../../../services/SystemTableService.js');
      const systemRows = await getSystemTableData(table.sync_target, table.project_id);
      const row = systemRows.find(r => String(r.id) === String(rowId));
      if (!row) {
        return notFound(res, 'Row');
      }
      return success(res, { row });
    }

    // External data source (internal type)
    if (table && table.data_source_id && table.source_table_name) {
      const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
      const dataSourceService = new DataSourceService();
      const dataSource = await dataSourceService.get(table.data_source_id);

      if (dataSource.type === 'internal') {
        let realRowId = rowId;
        if (rowId.startsWith('int_')) {
          const parts = rowId.split('_');
          realRowId = parts[parts.length - 1];
        } else if (rowId.startsWith('user-')) {
          realRowId = rowId.replace('user-', '');
        }

        const idColumn = table.source_id_column || 'id';
        const sourceRow = await dbGet(
          `SELECT * FROM "${table.source_table_name}" WHERE "${idColumn}" = ?`,
          [realRowId]
        );

        if (!sourceRow) {
          return notFound(res, 'Row');
        }

        const columns = await dbAll('SELECT * FROM table_columns WHERE table_id = ?', [tableId]);
        const data = {};
        columns.forEach(col => {
          if (sourceRow[col.column_name] !== undefined) {
            data[col.id] = sourceRow[col.column_name];
          }
        });

        return success(res, {
          row: {
            id: rowId,
            table_id: Number(tableId),
            base_id: sourceRow[idColumn] || rowId,
            data,
            created_at: sourceRow.created_at || new Date().toISOString(),
            updated_at: sourceRow.updated_at || new Date().toISOString()
          },
          columns: columns.map(c => ({
            id: c.id,
            column_name: c.column_name,
            display_name: c.display_name,
            type: c.type,
            config: safeJsonParse(c.config, {})
          }))
        });
      }

      if (dataSource.type === 'local_mysql') {
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection({
          host: dataSource.db_host,
          port: dataSource.db_port,
          database: dataSource.db_name,
          user: dataSource.db_username,
          password: ''
        });

        try {
          const idColumn = table.source_id_column || 'id';
          const [rows] = await connection.execute(
            `SELECT * FROM \`${table.source_table_name}\` WHERE \`${idColumn}\` = ? LIMIT 1`,
            [rowId]
          );

          if (!rows.length) {
            return notFound(res, 'Row');
          }

          const columns = await dbAll('SELECT * FROM table_columns WHERE table_id = ? ORDER BY order_index', [tableId]);

          return success(res, {
            row: {
              id: rowId,
              table_id: Number(tableId),
              data: rows[0],
              created_at: rows[0].created_at || new Date().toISOString(),
              updated_at: rows[0].updated_at || new Date().toISOString()
            },
            columns: columns.map(c => ({
              id: c.id,
              column_name: c.column_name,
              display_name: c.display_name,
              type: c.type,
              config: safeJsonParse(c.config, {})
            }))
          });
        } finally {
          await connection.end();
        }
      }
    }

    // Default: internal table_rows
    let row = await dbGet('SELECT * FROM table_rows WHERE id = ? AND table_id = ?', [rowId, tableId]);

    if (!row) {
      row = await dbGet('SELECT * FROM table_rows WHERE base_id = ? AND table_id = ?', [rowId, tableId]);
    }

    if (!row) {
      return notFound(res, 'Row');
    }

    let parsedData = safeJsonParse(row.data, {});
    if (typeof parsedData === 'object' && !parsedData.id) {
      parsedData.id = row.id;
    }

    const columns = await dbAll(
      'SELECT id, column_name, display_name, type, config FROM table_columns WHERE table_id = ? ORDER BY order_index',
      [tableId]
    );

    success(res, {
      row: {
        id: row.id,
        base_id: row.base_id,
        table_id: row.table_id,
        data: parsedData,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      columns: columns.map(c => ({
        id: c.id,
        column_name: c.column_name,
        display_name: c.display_name,
        type: c.type,
        config: safeJsonParse(c.config, {})
      }))
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /tables/:tableId/rows/:rowId error');
    error(res, 'ROW_FETCH_FAILED', err.message, 500);
  }
});

export default router;
