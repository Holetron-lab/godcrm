/**
 * Table creation and single-table read controller
 * Handles: GET /users, GET /tables/:tableId, POST /tables/create-calendar, POST /tables
 */
import express from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { tableKeySchema } from '../../../utils/tableKeySchema.js';
import { dbAll, dbGet, toBool, sqlNow, withTransactionAsync } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, forbidden, unauthorized, error } from '../../../utils/response.js';
import { checkTableAccess, checkTableWriteAccess } from './helpers.js';
import { listTableColumns } from '../../../services/data-source/queries.js';

const router = express.Router();

/**
 * GET /api/v3/users
 * Get all system users
 */
router.get('/users', async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT u.id, u.name, u.email,
             CASE WHEN length(u.avatar) > 2048 THEN NULL ELSE u.avatar END as avatar,
             u.user_type,
             u.managed_by_agent_table_id, u.managed_by_agent_row_id,
             (SELECT r.data->>'icon'  FROM table_rows r
                WHERE r.id = u.managed_by_agent_row_id
                  AND r.table_id = u.managed_by_agent_table_id) as agent_icon,
             (SELECT r.data->>'color' FROM table_rows r
                WHERE r.id = u.managed_by_agent_row_id
                  AND r.table_id = u.managed_by_agent_table_id) as agent_color,
             -- Effective accent: agent row color wins, else the human's saved profile color.
             -- Same contract as the shadowed GET / in agent-users.js; the chat stripe and
             -- mention pills read user.color first (MentionUsersContext).
             COALESCE((SELECT r.data->>'color' FROM table_rows r
                WHERE r.id = u.managed_by_agent_row_id
                  AND r.table_id = u.managed_by_agent_table_id), u.color) as color
      FROM users u
      ORDER BY u.name
    `);

    success(res, users || []);
  } catch (err) {
    apiLogger.error({ err }, 'GET /users error');
    error(res, 'USERS_FETCH_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/tables/:tableId
 * Get table by ID
 */
router.get('/tables/:tableId', async (req, res) => {
  try {
    const { tableId } = req.params;

    // Check access if API key has project restriction
    if (req.user?.projectId) {
      const access = await checkTableAccess(tableId, req.user);
      if (!access.allowed) {
        return forbidden(res, access.error);
      }
    }

    const table = await dbGet(`
      SELECT
        id,
        project_id,
        name,
        icon,
        description,
        is_system,
        sync_target,
        data_source_id,
        source_table_name,
        source_id_column,
        sync_enabled,
        sync_interval_minutes,
        last_sync_at,
        parent_table_id,
        config,
        created_at,
        updated_at
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    if (!table) {
      return notFound(res, 'Table');
    }

    success(res, table);
  } catch (err) {
    apiLogger.error({ err }, 'GET /tables/:tableId error');
    error(res, 'TABLE_FETCH_FAILED', err.message, 500);
  }
});

/**
 * POST /api/v3/tables/create-calendar
 * Create a calendar table with weekend/holiday data
 * IMPORTANT: This route must be defined BEFORE /tables/:tableId routes
 */
router.post('/tables/create-calendar', async (req, res) => {
  try {
    const { projectId, tableName = 'Calendar' } = req.body;
    const userId = req.user?.id || req.user?.userId;

    apiLogger.debug({ projectId, tableName, userId }, 'CREATE CALENDAR request received');

    if (!projectId) {
      return badRequest(res, 'projectId is required');
    }

    if (!userId) {
      return unauthorized(res, 'User authentication required');
    }

    // Check if project exists
    const project = await dbGet('SELECT id, space_id FROM projects WHERE id = ?', [projectId]);
    if (!project) {
      return notFound(res, 'Project');
    }

    apiLogger.debug({ tableName, projectId }, 'Creating calendar table');

    // Import the service dynamically
    const { createCalendarTable } = await import('../../../services/CalendarTableService.js');

    // Create the calendar table
    const tableId = await createCalendarTable(projectId, userId, tableName);

    // Get the created table info
    const table = await dbGet(`
      SELECT t.*, p.name as project_name, p.icon as project_icon
      FROM universal_tables t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = ?
    `, [tableId]);

    apiLogger.info({ tableId }, 'CREATE CALENDAR success');

    success(res, {
      tableId,
      table: {
        id: table.id,
        name: table.name,
        icon: table.icon,
        description: table.description,
        projectId: table.project_id,
        projectName: table.project_name
      }
    });
  } catch (err) {
    apiLogger.error({ err }, 'POST /tables/create-calendar error');
    error(res, 'CREATE_CALENDAR_FAILED', err.message, 500);
  }
});

/**
 * POST /api/v3/tables
 * Create a new table
 */
router.post('/tables', async (req, res) => {
  try {
    const { name, description, icon, projectId, project_id, columns, data_source_id, external_table_name } = req.body;
    // Support both projectId and project_id for compatibility
    const effectiveProjectId = projectId || project_id;
    // Stable module marker (ADR-164 style). Accept snake_case and the camelCase
    // `tableType` the widget presets declare; persist so a module's tables are
    // discoverable by type per-project (e.g. SC-SIM sim_runs) instead of by a
    // hard-coded global id. Absent → null, preserving legacy behaviour.
    const tableType = req.body.table_type || req.body.tableType || null;

    const keyResult = z.object({
      name: tableKeySchema,
      display_name: z.string().optional(),
      displayName: z.string().optional(),
      importId: z.string().uuid().optional(),
    }).safeParse(req.body);
    if (!keyResult.success) {
      return badRequest(res, keyResult.error.issues[0].message);
    }

    if (!effectiveProjectId) {
      return badRequest(res, 'Project ID is required');
    }

    if (req.user?.projectId && Number(req.user.projectId) !== Number(effectiveProjectId)) {
      return forbidden(res, 'Your API key does not have access to this project');
    }
    const importId = keyResult.data.importId;
    if (importId && (data_source_id || external_table_name)) return badRequest(res, 'importId is only supported for local tables');
    // The UI keeps this request fixed across retries, including the full column
    // schema. No separate column requests that could leave half a schema behind.
    const importDigest = importId ? createHash('sha256').update(JSON.stringify(req.body)).digest('hex') : null;

    // Bug 1552/229245 — creating a table is a write into the project's space.
    const writeAccess = await checkTableWriteAccess(req.user, { projectId: effectiveProjectId });
    if (!writeAccess.allowed) {
      return forbidden(res, writeAccess.error);
    }

    // ADR-200 W1: importing an external table's schema is a network round-trip to a foreign
    // DB — resolve it BEFORE opening the transaction so it never holds a pooled client open.
    // Ticket 231940 (AC#3): a schema failure is an error, not a columnless "success". The old
    // code also called the method on the class instead of an instance, so it ALWAYS threw and
    // every external table was born without columns.
    const isExternal = !!(data_source_id && external_table_name);
    let externalColumns = [];
    if (isExternal) {
      try {
        externalColumns = await listTableColumns(data_source_id, external_table_name);
        apiLogger.debug({ external_table_name, count: externalColumns.length }, 'External columns fetched');
      } catch (importErr) {
        apiLogger.error({ err: importErr, data_source_id, external_table_name }, 'Failed to import external columns');
        return error(res, 'EXTERNAL_SCHEMA_FAILED', `Cannot read schema of "${external_table_name}": ${importErr.message}`, 502);
      }
    }

    // ADR-200 W1 (AC#1): the table row and ALL of its columns commit together. Before this,
    // a column INSERT that failed halfway left a column-less orphan table behind.
    const { newTable, createdColumns } = await withTransactionAsync(async (trx) => {
      if (importId) {
        await trx.get('SELECT id FROM projects WHERE id = ? FOR UPDATE', [effectiveProjectId]);
        const previous = await trx.get(`SELECT * FROM universal_tables
          WHERE project_id = ? AND created_by = ? AND config::jsonb->'file_import'->>'id' = ?`,
        [effectiveProjectId, req.user.id, importId]);
        if (previous) {
          const receipt = typeof previous.config === 'string' ? JSON.parse(previous.config) : previous.config;
          if (receipt.file_import.digest !== importDigest) {
            throw Object.assign(new Error('Этот importId уже использован для другого определения таблицы.'), { code: 'IMPORT_CONFLICT' });
          }
          const previousColumns = await trx.all('SELECT * FROM table_columns WHERE table_id = ? ORDER BY order_index', [previous.id]);
          return { newTable: previous, createdColumns: previousColumns };
        }
      }
      // Create the table with optional data source connection
      const result = await trx.run(`
        INSERT INTO universal_tables (
          project_id,
          name,
          display_name,
          description,
          icon,
          is_system,
          table_type,
          data_source_id,
          source_table_name,
          sync_enabled,
          created_by,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
      `, [
        effectiveProjectId,
        name,
        req.body.display_name || req.body.displayName || name,
        description || null,
        icon || '📊',
        toBool(false),
        tableType,
        data_source_id || null,
        external_table_name || null,
        toBool(!!data_source_id),
        // ADR-0066-B: the authenticated creator was available and discarded.
        req.user?.id ?? null
      ]);

      const tableId = result.lastID || result.lastInsertRowid;

      if (!tableId) {
        apiLogger.error({ result }, 'Failed to get table ID from insert result');
        throw new Error('Failed to create table: no ID returned');
      }

      if (importId) {
        await trx.run(`UPDATE universal_tables SET config = jsonb_set(
          COALESCE(config::jsonb, '{}'::jsonb), '{file_import}', ?::jsonb, true)::text WHERE id = ?`,
        [JSON.stringify({ id: importId, digest: importDigest }), tableId]);
      }

      apiLogger.info({ tableId }, 'Table created');

      // Create columns
      const created = [];

      // If external table, use the columns imported from the data source above
      if (isExternal) {
        for (let i = 0; i < externalColumns.length; i++) {
          const col = externalColumns[i];
          // Map external type to our internal type
          let internalType = 'text';
          if (col.type.includes('int') || col.type.includes('decimal') || col.type.includes('float')) {
            internalType = 'number';
          } else if (col.type.includes('date') || col.type.includes('time')) {
            internalType = 'date';
          } else if (col.type.includes('bool')) {
            internalType = 'checkbox';
          }

          apiLogger.debug({ name: col.name, type: internalType }, 'Inserting column');

          const columnResult = await trx.run(`
            INSERT INTO table_columns (
              table_id,
              column_name,
              display_name,
              type,
              is_required,
              order_index,
              is_visible,
              config,
              is_from_source,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
          `, [
            tableId,
            col.name,
            col.name,
            internalType,
            toBool(false),
            i,
            toBool(true),
            JSON.stringify({}),
            toBool(true)
          ]);

          apiLogger.debug({ columnId: columnResult.lastID || columnResult.lastInsertRowid }, 'Column inserted');

          created.push({
            id: columnResult.lastID || columnResult.lastInsertRowid,
            table_id: tableId,
            column_name: col.name,
            display_name: col.name,
            type: internalType
          });
        }
        apiLogger.debug({ count: created.length }, "Imported columns from external table");
      } else if (columns && Array.isArray(columns) && columns.length > 0) {
        // Local table with provided columns
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          const columnResult = await trx.run(`
            INSERT INTO table_columns (
              table_id,
              column_name,
              display_name,
              type,
              is_required,
              order_index,
              is_visible,
              config,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
          `, [
            tableId,
            col.name,
            col.displayName || col.name,
            col.type,
            toBool(col.isRequired),
            col.orderIndex ?? i,
            toBool(col.isVisible !== false),
            JSON.stringify(col.config || {})
          ]);

          created.push({
            id: columnResult.lastID || columnResult.lastInsertRowid,
            table_id: tableId,
            column_name: col.name,
            display_name: col.displayName || col.name,
            type: col.type,
            is_required: col.isRequired ? 1 : 0,
            order_index: col.orderIndex ?? i,
            is_visible: col.isVisible !== false ? 1 : 0,
            config: col.config || {}
          });
        }
      }

      // Fetch the created table — inside the transaction, so it reads the row just written
      const table = await trx.get(`
        SELECT
          id,
          project_id,
          name,
          display_name,
          icon,
          description,
          is_system,
          sync_target,
          data_source_id,
          created_at,
          updated_at
        FROM universal_tables
        WHERE id = ?
      `, [tableId]);

      return { newTable: table, createdColumns: created };
    });

    success(res, {
      table: newTable,
      columns: createdColumns
    });
  } catch (err) {
    if (err.code === 'IMPORT_CONFLICT') return error(res, err.code, err.message, 409);
    apiLogger.error({ err }, 'POST /tables error');
    error(res, 'TABLE_CREATE_FAILED', err.message, 500);
  }
});

export default router;
