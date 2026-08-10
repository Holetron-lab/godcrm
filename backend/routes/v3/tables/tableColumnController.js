/**
 * Table column operations controller
 * Handles: GET /tables/:tableId/columns
 */
import express from 'express';
import { dbAll, dbGet } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error } from '../../../utils/response.js';
import { mapPostgresTypeToInternal, filterColumnsByRole, resolveUserRoleForTable } from './helpers.js';

const router = express.Router();

/**
 * GET /api/v3/tables/:tableId/columns
 * Get columns for a table
 * Supports external data sources - reads schema from MySQL if connected
 * mode=raw returns original source column names without transformation
 * Filters columns based on user role and column access_control config
 */
router.get('/tables/:tableId/columns', async (req, res) => {
  try {
    const { tableId } = req.params;
    const { mode } = req.query;
    const rawMode = mode === 'raw';
    const userId = req.user?.id;

    // Check if table has external data source and get project_id
    const table = await dbGet(`
      SELECT data_source_id, source_table_name, project_id
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    // Get user's role and granular access data for column filtering
    const { userRole, userAccessData } = await resolveUserRoleForTable(userId, table);
    apiLogger.debug({ userId, tableId, userRole, hasAccessData: !!userAccessData }, "User role for table");

    // If table is connected to external data source, use columns from table_columns
    if (table && table.data_source_id && table.source_table_name) {

      // RAW mode for internal data source - get columns directly from database schema
      if (rawMode) {
        const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
        const dataSourceService = new DataSourceService();
        const dataSource = await dataSourceService.get(table.data_source_id);

        if (dataSource && dataSource.type === 'internal') {
          const schemaColumns = await dbAll(`
            SELECT column_name, data_type, is_nullable, column_default, ordinal_position
            FROM information_schema.columns
            WHERE table_name = $1
            ORDER BY ordinal_position
          `, [table.source_table_name]);

          // Get primary key info
          const pkColumns = await dbAll(`
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary
          `, [table.source_table_name]).catch(() => []);
          const pkSet = new Set(pkColumns.map(c => c.attname));

          const columns = schemaColumns.map((col, index) => ({
            id: col.column_name,
            table_id: tableId,
            name: col.column_name,
            display_name: col.column_name,
            column_type: mapPostgresTypeToInternal(col.data_type),
            config: null,
            is_required: col.is_nullable === 'NO' ? 1 : 0,
            is_readonly: 0,
            order_index: index,
            is_visible: 1,
            width: null,
            mapping: null,
            default_value: col.column_default,
            formula: null,
            is_from_source: 1,
            is_primary_key: pkSet.has(col.column_name) ? 1 : 0,
            is_locked: 0,
            created_at: null,
            updated_at: null
          }));

          apiLogger.debug({ count: columns.length }, "Internal table columns from schema");

          return success(res, columns);
        }
      }

      // For external tables, just return columns from table_columns
      // These were created during table creation and have proper IDs
      const columns = await dbAll(`
        SELECT
          id,
          table_id,
          column_name as name,
          display_name,
          type as column_type,
          config,
          is_required,
          is_readonly,
          order_index,
          is_visible,
          width,
          mapping,
          default_value,
          formula,
          is_from_source,
          is_primary_key,
          is_locked,
          created_at,
          updated_at
        FROM table_columns
        WHERE table_id = ?
        ORDER BY order_index ASC
      `, [tableId]);

      // Parse config and mapping JSON
      columns.forEach(col => {
        if (typeof col.config === 'string') {
          try {
            col.config = JSON.parse(col.config);
          } catch (e) {
            col.config = {};
          }
        }
        if (typeof col.mapping === 'string' && col.mapping) {
          try {
            col.mapping = JSON.parse(col.mapping);
          } catch (e) {
            col.mapping = null;
          }
        }
      });

      // Apply role-based and granular column filtering
      const filteredColumns = filterColumnsByRole(columns, userRole, userAccessData);

      apiLogger.debug({ total: columns.length, filtered: filteredColumns.length, userRole }, "External table columns filtered");
      apiLogger.debug({ columns: filteredColumns.slice(0, 3).map(c => ({ name: c.name, display_name: c.display_name })) }, 'First 3 columns with displayName');

      return success(res, filteredColumns, { userRole: userRole || 'owner' });
    }

    // Fallback to local table_columns
    const columns = await dbAll(`
      SELECT
        id,
        table_id,
        column_name as name,
        display_name,
        type as column_type,
        config,
        is_required,
        is_readonly,
        order_index,
        is_visible,
        width,
        mapping,
        default_value,
        formula,
        is_from_source,
        is_primary_key,
        is_locked,
        created_at,
        updated_at
      FROM table_columns
      WHERE table_id = ?
      ORDER BY order_index ASC
    `, [tableId]);

    // Parse config and mapping JSON for local tables too
    columns.forEach(col => {
      if (typeof col.config === 'string') {
        try {
          col.config = JSON.parse(col.config);
        } catch (e) {
          col.config = {};
        }
      }
      if (typeof col.mapping === 'string' && col.mapping) {
        try {
          col.mapping = JSON.parse(col.mapping);
        } catch (e) {
          col.mapping = null;
        }
      }
    });

    // Apply role-based and granular column filtering
    const filteredColumns = filterColumnsByRole(columns, userRole, userAccessData);

    // Debug log column types
    apiLogger.debug({ tableId, total: columns.length, filtered: filteredColumns.length, role: userRole }, 'GET columns summary');

    success(res, filteredColumns, { userRole: userRole || 'owner' });
  } catch (err) {
    apiLogger.error({ err }, 'GET /tables/:tableId/columns error');
    error(res, 'COLUMNS_FETCH_FAILED', err.message, 500);
  }
});

export default router;
