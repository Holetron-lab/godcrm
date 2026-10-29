/**
 * Table management controller
 * Handles: GET /tables, GET /projects/:projectId/tables,
 *          POST /tables/:tableId/connect, PATCH /tables/:tableId,
 *          DELETE /tables/:tableId
 */
import express from 'express';
import { z } from 'zod';
import { dbAll, dbGet, dbRun, toBool, sqlNow, withTransactionAsync } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, forbidden, error } from '../../../utils/response.js';
import {
  enableBookingConstraint,
  disableBookingConstraint,
  getBookingConstraint,
} from '../../../lib/booking-constraint.js';
import { requireTableWriteAccess } from './helpers.js';

const router = express.Router();

/**
 * GET /api/v3/tables
 * Get all tables (with optional filters: project_id, space_id)
 */
router.get('/tables', async (req, res) => {
  try {
    let { project_id, space_id } = req.query;

    // If API key has project restriction, enforce it
    if (req.user?.projectId) {
      if (project_id && Number(project_id) !== req.user.projectId) {
        return forbidden(res, 'Your API key is restricted to a different project');
      }
      project_id = req.user.projectId;
    }

    const conditions = [];
    const params = [];

    if (project_id) {
      conditions.push('ut.project_id = ?');
      params.push(project_id);
    }

    if (space_id) {
      conditions.push('ut.project_id IN (SELECT id FROM projects WHERE space_id = ?)');
      params.push(space_id);
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT
        ut.id,
        ut.project_id,
        ut.name,
        ut.display_name,
        ut.icon,
        ut.description,
        ut.is_system,
        ut.table_type,
        ut.sync_target,
        ut.data_source_id,
        ut.source_table_name,
        ut.source_id_column,
        ut.sync_enabled,
        ut.parent_table_id,
        ut.config,
        ut.created_at,
        ut.updated_at
      FROM universal_tables ut
      ${whereClause}
      ORDER BY ut.created_at ASC
    `;

    const tables = await dbAll(query, params);

    success(res, tables);
  } catch (err) {
    apiLogger.error({ err }, 'GET /tables error');
    error(res, 'TABLES_FETCH_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/projects/:projectId/tables
 * Get all tables for a project
 */
router.get('/projects/:projectId/tables', async (req, res) => {
  try {
    const { projectId } = req.params;

    const tables = await dbAll(`
      SELECT
        t.id,
        t.project_id,
        t.name,
        t.display_name,
        t.icon,
        t.description,
        t.is_system,
        t.table_type,
        t.sync_target,
        t.data_source_id,
        t.source_table_name,
        t.source_id_column,
        t.sync_enabled,
        t.parent_table_id,
        t.show_in_nav,
        t.config,
        t.created_at,
        t.updated_at,
        ds.name as data_source_name
      FROM universal_tables t
      LEFT JOIN data_sources ds ON t.data_source_id = ds.id
      WHERE t.project_id = ?
      ORDER BY t.created_at ASC
    `, [projectId]);

    success(res, tables);
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching tables');
    error(res, 'FETCH_ERROR', err.message, 500);
  }
});

/**
 * POST /api/v3/tables/:tableId/connect
 * Connect table to external data source
 */
router.post('/tables/:tableId/connect', async (req, res) => {
  try {
    const { tableId } = req.params;
    const { data_source_id, source_table_name, source_id_column } = req.body;

    if (!data_source_id || !source_table_name) {
      return badRequest(res, 'data_source_id and source_table_name are required');
    }

    await dbRun(`
      UPDATE universal_tables
      SET
        data_source_id = ?,
        source_table_name = ?,
        source_id_column = ?,
        sync_enabled = 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [data_source_id, source_table_name, source_id_column || 'id', tableId]);

    // Create columns from external source
    const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
    const dataSourceService = new DataSourceService();

    try {
      const externalColumns = await dataSourceService.listTableColumns(data_source_id, source_table_name);
      apiLogger.debug({ count: externalColumns.length }, "Found columns in external source");

      // Check if columns already exist
      const existingColumns = await dbAll('SELECT COUNT(*) as count FROM table_columns WHERE table_id = ?', [tableId]);

      if (existingColumns[0].count === 0) {
        // Create columns
        for (let i = 0; i < externalColumns.length; i++) {
          const col = externalColumns[i];

          // Map external type to internal type
          let internalType = 'text';
          if (col.type.includes('int') || col.type.includes('decimal') || col.type.includes('float')) {
            internalType = 'number';
          } else if (col.type.includes('date') || col.type.includes('time')) {
            internalType = 'date';
          } else if (col.type.includes('bool')) {
            internalType = 'checkbox';
          }

          await dbRun(`
            INSERT INTO table_columns (
              table_id, column_name, display_name, type,
              is_required, order_index, is_visible,
              is_from_source, config,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
          `, [
            tableId,
            col.name,
            col.name.toUpperCase(),
            internalType,
            toBool(false),
            i,
            toBool(true),
            toBool(true),
            JSON.stringify({})
          ]);
        }
        apiLogger.debug({ count: externalColumns.length, tableId }, "Created columns for table");
      }
    } catch (colError) {
      apiLogger.error({ err: colError }, 'Failed to create columns');
      // Continue anyway - columns can be created later
    }

    const updatedTable = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [tableId]);

    success(res, updatedTable);
  } catch (err) {
    apiLogger.error({ err }, 'POST /tables/:tableId/connect error');
    error(res, 'CONNECT_FAILED', err.message, 500);
  }
});

/**
 * PATCH /api/v3/tables/:tableId
 * Update table display settings
 */
router.patch('/tables/:tableId', requireTableWriteAccess, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { name, displayName, icon, color, access_control, show_in_nav, privacy, min_row_height, max_row_height, fixed_row_height, project_id, is_public } = req.body;

    apiLogger.debug({ tableId, name, displayName, icon, color, show_in_nav, privacy, min_row_height, max_row_height, fixed_row_height, project_id, hasAccessControl: !!access_control }, "PATCH table display settings");

    // Check if table exists
    const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [tableId]);
    if (!table) {
      return notFound(res, 'Table');
    }

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }

    if (displayName !== undefined) {
      updates.push('display_name = ?');
      params.push(displayName);
    }

    if (icon !== undefined) {
      updates.push('icon = ?');
      params.push(icon);
    }

    if (color !== undefined) {
      updates.push('color = ?');
      params.push(color);
    }

    if (access_control !== undefined) {
      updates.push('access_control = ?');
      params.push(access_control ? JSON.stringify(access_control) : null);
    }

    if (show_in_nav !== undefined) {
      updates.push('show_in_nav = ?');
      params.push(show_in_nav ? 1 : 0);
    }

    if (project_id !== undefined) {
      updates.push('project_id = ?');
      params.push(project_id);
    }

    if (is_public !== undefined) {
      updates.push('is_public = ?');
      params.push(Boolean(is_public));
    }

    // Handle config JSON fields (privacy, row height settings)
    const hasConfigUpdate = privacy !== undefined ||
                           min_row_height !== undefined ||
                           max_row_height !== undefined ||
                           fixed_row_height !== undefined;

    if (hasConfigUpdate) {
      let currentConfig = {};
      if (table.config) {
        try {
          currentConfig = typeof table.config === 'string' ? JSON.parse(table.config) : table.config;
        } catch (e) {
          currentConfig = {};
        }
      }

      if (privacy !== undefined) {
        currentConfig.privacy = privacy;
      }
      if (min_row_height !== undefined) {
        currentConfig.min_row_height = min_row_height;
      }
      if (max_row_height !== undefined) {
        currentConfig.max_row_height = max_row_height;
      }
      if (fixed_row_height !== undefined) {
        currentConfig.fixed_row_height = fixed_row_height;
      }

      updates.push('config = ?');
      params.push(JSON.stringify(currentConfig));
    }

    if (updates.length === 0) {
      return badRequest(res, 'No fields to update');
    }

    updates.push(`updated_at = ${sqlNow()}`);
    params.push(tableId);

    const query = `UPDATE universal_tables SET ${updates.join(', ')} WHERE id = ?`;
    apiLogger.debug({ query, params }, 'PATCH table query');

    await dbRun(query, params);

    const updatedTable = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [tableId]);

    success(res, updatedTable);
  } catch (err) {
    apiLogger.error({ err }, 'PATCH /tables/:tableId error');
    error(res, 'UPDATE_FAILED', err.message, 500);
  }
});

/**
 * DELETE /api/v3/tables/:tableId
 * Delete a table and all its columns and rows (CASCADE)
 */
router.delete('/tables/:tableId', async (req, res) => {
  try {
    const parsedId = z.coerce.number().int().positive().safe().safeParse(req.params.tableId);
    if (!parsedId.success) return badRequest(res, 'Invalid table ID');
    const tableId = parsedId.data;
    const userId = req.user?.id;

    const result = await withTransactionAsync(async (trx) => {
      const table = await trx.get(`
        SELECT t.*, p.owner_id
        FROM universal_tables t
        INNER JOIN projects p ON t.project_id = p.id
        WHERE t.id = $1
        FOR UPDATE OF t, p
      `, [tableId]);
      if (!table) return { status: 404 };

      const isOwner = table.owner_id === userId;
      const isAdmin = req.user?.role === 'admin' || req.user?.role === 'owner';
      if (!isOwner && !isAdmin) {
        return { status: 403, message: 'You do not have permission to delete this table' };
      }
      if (table.is_system) return { status: 403, message: 'Cannot delete system table' };

      // Deployed schemas may lack these foreign keys. Keep cleanup atomic.
      await trx.run('DELETE FROM table_rows WHERE table_id = $1', [tableId]);
      await trx.run('DELETE FROM table_columns WHERE table_id = $1', [tableId]);
      await trx.run('DELETE FROM universal_tables WHERE id = $1', [tableId]);
      return { table };
    });
    if (result.status === 404) return notFound(res, 'Table');
    if (result.status === 403) return forbidden(res, result.message);
    const { table } = result;

    apiLogger.info({ tableId, tableName: table.name, userId }, 'Table deleted');

    success(res, { message: 'Table deleted successfully', tableId });
  } catch (err) {
    apiLogger.error({ err }, 'DELETE /tables/:tableId error');
    error(res, 'DELETE_TABLE_FAILED', err.message, 500);
  }
});

/**
 * ADR-0034 §7 — Booking exclusion-constraint admin endpoints.
 *
 *   GET    /api/v3/tables/:tableId/booking-constraint  → current config or null
 *   POST   /api/v3/tables/:tableId/booking-constraint  → enable / replace
 *           body: { lane_column, start_column, end_column }
 *   DELETE /api/v3/tables/:tableId/booking-constraint  → disable
 */
router.get('/tables/:tableId/booking-constraint', async (req, res) => {
  try {
    const cfg = await getBookingConstraint(req.params.tableId);
    success(res, cfg);
  } catch (err) {
    apiLogger.error({ err }, 'GET /tables/:tableId/booking-constraint error');
    error(res, 'BOOKING_CONSTRAINT_FETCH_FAILED', err.message, 500);
  }
});

router.post('/tables/:tableId/booking-constraint', async (req, res) => {
  try {
    const { tableId } = req.params;
    const { lane_column, start_column, end_column } = req.body || {};
    if (!lane_column || !start_column || !end_column) {
      return badRequest(res, 'lane_column, start_column, end_column are required');
    }
    const cfg = await enableBookingConstraint({
      table_id: tableId,
      lane_column,
      start_column,
      end_column,
    });
    success(res, cfg, 'Booking constraint enabled');
  } catch (err) {
    if (err.code === 'BOOKING_CONSTRAINT_EXISTING_OVERLAP') {
      // ADR-0034 §7 — operator must scrub existing overlaps before enabling.
      return res.status(400).json({
        success: false,
        error: 'BOOKING_CONSTRAINT_EXISTING_OVERLAP',
        message: err.message,
      });
    }
    if (typeof err.message === 'string' && /booking-constraint:/.test(err.message)) {
      // Identifier validation rejection (assertSafeColumn / assertTableId).
      return badRequest(res, err.message);
    }
    apiLogger.error({ err }, 'POST /tables/:tableId/booking-constraint error');
    error(res, 'BOOKING_CONSTRAINT_ENABLE_FAILED', err.message, 500);
  }
});

router.delete('/tables/:tableId/booking-constraint', async (req, res) => {
  try {
    await disableBookingConstraint(req.params.tableId);
    success(res, null, 'Booking constraint disabled');
  } catch (err) {
    apiLogger.error({ err }, 'DELETE /tables/:tableId/booking-constraint error');
    error(res, 'BOOKING_CONSTRAINT_DISABLE_FAILED', err.message, 500);
  }
});

export default router;
