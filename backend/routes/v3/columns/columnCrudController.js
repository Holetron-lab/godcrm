// columns/columnCrudController.js — List, create, get, update, delete columns

import express from 'express';
import { z } from 'zod';
import { dbAll, dbGet, dbRun, toBool, withTransactionAsync } from '../../../database/connection.js';
import { VALID_COLUMN_TYPES, persistColumnType, validateColumnConfig, assertAddressGeoLink } from '../../../services/ColumnService.js';
import { validateVerificationConfig } from '../../../services/verification/validateConfig.js';
import { getSystemTableColumns } from '../../../services/SystemTableService.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, notFound, badRequest, error } from '../../../utils/response.js';
import { verifyTableAccess } from './helpers.js';

// ADR-0016 Phase 2: per-column visibility for file-type columns.
// Persisted in `table_columns.config` JSONB (no migration). New columns
// default to 'private'; updates that omit `visibility` keep the existing
// value (handled inline below).
const FILE_VISIBILITY_VALUES = ['private', 'internal', 'public'];

function isFileColumnType(type) {
  return type === 'file' || type === 'image';
}

const columnPatchSchema = z.object({
  column_name: z.string().min(1).max(255).regex(/^[a-z0-9_]+$/).optional(),
  display_name: z.string().max(255).nullable().optional(),
  column_type: z.enum(VALID_COLUMN_TYPES).optional(),
  config: z.record(z.unknown()).nullable().optional(),
  mapping: z.record(z.unknown()).nullable().optional(),
  is_required: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  is_visible: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  is_readonly: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
  order_index: z.number().int().optional(),
  width: z.number().int().positive().optional(),
  default_value: z.unknown().optional(),
  formula: z.string().nullable().optional(),
});

const router = express.Router();

// ============================================================
// GET /api/v3/tables/:tableId/columns
// List all columns for a table
// ============================================================
/**
 * @swagger
 * /api/v3/tables/{tableId}/columns:
 *   get:
 *     summary: List all columns for a table
 *     tags: [Columns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tableId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of columns
 */
router.get('/tables/:tableId/columns', verifyTableAccess, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { mode } = req.query;
    const table = req.table;
    let columns;

    if (table.is_system && table.sync_target) {
      const systemColumns = getSystemTableColumns(table.sync_target);
      columns = systemColumns.map((col, idx) => ({
        id: `col-${tableId}-${idx}`,
        table_id: parseInt(tableId),
        name: col.name,
        display_name: col.displayName,
        column_type: col.type,
        config: col.config || {},
        is_required: col.isRequired || false,
        order_index: col.orderIndex,
        is_visible: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
    } else {
      columns = await dbAll(`
        SELECT
          id,
          table_id,
          column_name AS name,
          display_name,
          type AS column_type,
          config,
          is_required,
          order_index,
          is_visible,
          width,
          is_readonly,
          is_locked,
          default_value,
          formula,
          mapping,
          created_at,
          updated_at
        FROM table_columns
        WHERE table_id = ?
        ORDER BY order_index ASC
      `, [tableId]);

      columns = columns.map(col => ({
        ...col,
        config: col.config ? (typeof col.config === 'string' ? JSON.parse(col.config) : col.config) : {},
        mapping: col.mapping ? (typeof col.mapping === 'string' ? JSON.parse(col.mapping) : col.mapping) : null,
        is_required: toBool(col.is_required),
        is_visible: toBool(col.is_visible),
        is_readonly: toBool(col.is_readonly),
        is_locked: toBool(col.is_locked)
      }));
    }

    return success(res, columns);

  } catch (err) {
    apiLogger.error({ err }, 'GET /tables/:tableId/columns error');
    return error(res, 'COLUMN_LIST_FAILED', 'Failed to list columns', 500, err.message);
  }
});

// ============================================================
// POST /api/v3/tables/:tableId/columns
// Create a new column
// ============================================================
/**
 * @swagger
 * /api/v3/tables/{tableId}/columns:
 *   post:
 *     summary: Create a new column
 *     tags: [Columns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tableId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, display_name, column_type]
 *             properties:
 *               name:
 *                 type: string
 *               display_name:
 *                 type: string
 *               column_type:
 *                 type: string
 *               config:
 *                 type: object
 *               is_required:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Column created
 */
router.post('/tables/:tableId/columns', verifyTableAccess, async (req, res) => {
  try {
    const { tableId } = req.params;
    const {
      name,
      display_name,
      column_type,
      config = {},
      is_required = false,
      is_readonly = false,
      order_index,
      width = 200
    } = req.body;

    if (!name || !display_name || !column_type) {
      return badRequest(res, 'name, display_name, and column_type are required');
    }

    if (!VALID_COLUMN_TYPES.includes(column_type)) {
      return badRequest(res, `Invalid column type. Must be one of: ${VALID_COLUMN_TYPES.join(', ')}`);
    }

    // ADR-0016 Phase 2: file-type columns get a `visibility` enum in their
    // `config`. Validate caller input; default new columns to 'private'.
    // Non-file columns must NOT carry a `visibility` key (it's meaningless
    // and confusing in the UI).
    let persistedConfig = config;
    if (isFileColumnType(column_type)) {
      const cfg = { ...(config || {}) };
      if (cfg.visibility === undefined || cfg.visibility === null) {
        cfg.visibility = 'private';
      } else if (!FILE_VISIBILITY_VALUES.includes(cfg.visibility)) {
        return badRequest(
          res,
          `Invalid visibility '${cfg.visibility}'. Must be one of: ${FILE_VISIBILITY_VALUES.join(', ')}`
        );
      }
      persistedConfig = cfg;
    } else if (
      config &&
      Object.prototype.hasOwnProperty.call(config, 'visibility')
    ) {
      return badRequest(res, '`visibility` is only valid on file-type columns');
    }

    // ADR-0011 Phase A/C: flag-gate + config validation for verification columns.
    // Normalized form is persisted so consumers (guards, verify endpoint) see
    // canonical ADR-0011 fields (`available_methods`, `required_methods`,
    // `cooldown_seconds`, …) regardless of which legacy keys the caller sent.
    if (column_type === 'verification') {
      if (process.env.VERIFICATION_COLUMN_ENABLED !== 'true') {
        return badRequest(res, 'Verification column type is disabled (set VERIFICATION_COLUMN_ENABLED=true to enable)');
      }
      const cfgCheck = validateVerificationConfig(config);
      if (!cfgCheck.ok) {
        return badRequest(res, `Invalid verification config: ${cfgCheck.error}`);
      }
      persistedConfig = cfgCheck.normalized;
    }

    // ADR-204 Stage 2: `content` / `contact` carry a versioned config block.
    const adr204Cfg = validateColumnConfig(persistColumnType(column_type), persistedConfig);
    if (!adr204Cfg.ok) return badRequest(res, `Invalid ${column_type} config: ${adr204Cfg.error}`);
    persistedConfig = adr204Cfg.normalized;

    const column = await withTransactionAsync(async tx => {
      await tx.get('SELECT id FROM universal_tables WHERE id = ? FOR UPDATE', [tableId]);
      // ADR-0035-A: an address may only link to a geo_point column of this table.
      if (persistColumnType(column_type) === 'address') {
        const linkError = await assertAddressGeoLink(tx.get, tableId, persistedConfig);
        if (linkError) throw Object.assign(new Error('config.address.geo_column_id must be a geo_point column of this table'), { status: 400, code: linkError });
      }
      const existing = await tx.get(
        'SELECT id FROM table_columns WHERE table_id = ? AND column_name = ?',
        [tableId, name]
      );
      if (existing) {
        throw Object.assign(new Error(`Column "${name}" already exists in this table`), { status: 400 });
      }

      let orderIdx = order_index;
      if (orderIdx === undefined || orderIdx === null) {
        const maxOrder = await tx.get(
          'SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?',
          [tableId]
        );
        orderIdx = (maxOrder?.max_order ?? -1) + 1;
      }

      const result = await tx.run(`
        INSERT INTO table_columns (
          table_id, column_name, display_name, type, config,
          is_required, is_readonly, order_index, is_visible, width
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `, [
        tableId, name, display_name, persistColumnType(column_type),
        JSON.stringify(persistedConfig), is_required ? 1 : 0,
        is_readonly ? 1 : 0, orderIdx, width
      ]);

      return tx.get(`
        SELECT
          id, table_id, column_name AS name, display_name, type AS column_type, config,
          is_required, is_readonly, order_index, is_visible, width,
          created_at, updated_at
        FROM table_columns
        WHERE id = ?
      `, [result.lastInsertRowid]);

    });

    const response = {
      ...column,
      config: column.config ? JSON.parse(column.config) : {},
      is_required: toBool(column.is_required),
      is_readonly: toBool(column.is_readonly),
      is_visible: toBool(column.is_visible)
    };

    apiLogger.info({ tableId, columnId: column.id, name }, 'Column created');
    return created(res, response);

  } catch (err) {
    if (err.status === 400) return badRequest(res, err.message, err.code);
    apiLogger.error({ err }, 'POST /tables/:tableId/columns error');
    return error(res, 'COLUMN_CREATE_FAILED', 'Failed to create column', 500, err.message);
  }
});

// ============================================================
// GET /api/v3/tables/:tableId/columns/:columnId
// Get a single column
// ============================================================
router.get('/tables/:tableId/columns/:columnId', verifyTableAccess, async (req, res) => {
  try {
    const { columnId } = req.params;

    const column = await dbGet(`
      SELECT
        id, table_id, column_name AS name, display_name, type AS column_type, config,
        is_required, is_readonly, order_index, is_visible, width, is_locked,
        default_value, formula, mapping,
        created_at, updated_at
      FROM table_columns
      WHERE id = ?
    `, [columnId]);

    if (!column) {
      return notFound(res, 'Column');
    }

    const response = {
      ...column,
      config: column.config ? JSON.parse(column.config) : {},
      mapping: column.mapping ? JSON.parse(column.mapping) : null,
      is_required: toBool(column.is_required),
      is_readonly: toBool(column.is_readonly),
      is_visible: toBool(column.is_visible),
      is_locked: toBool(column.is_locked)
    };

    return success(res, response);

  } catch (err) {
    apiLogger.error({ err }, 'GET /tables/:tableId/columns/:columnId error');
    return error(res, 'COLUMN_GET_FAILED', 'Failed to get column', 500, err.message);
  }
});

// ============================================================
// PATCH /api/v3/tables/:tableId/columns/:columnId
// Update a column
// ============================================================
router.patch('/tables/:tableId/columns/:columnId', verifyTableAccess, async (req, res) => {
  try {
    const { columnId, tableId } = req.params;
    const parsed = columnPatchSchema.safeParse(req.body);
    if (!parsed.success || !/^[1-9]\d*$/.test(tableId) || !/^[1-9]\d*$/.test(columnId)) {
      return badRequest(res, 'Invalid column update');
    }
    const updates = parsed.data;
    if (updates.column_type !== undefined) updates.column_type = persistColumnType(updates.column_type);

    const existingColumn = await dbGet('SELECT id, type, config FROM table_columns WHERE id = ? AND table_id = ?', [columnId, tableId]);
    if (!existingColumn) {
      return notFound(res, 'Column');
    }

    const allowedFields = [
      'column_name', 'display_name', 'column_type', 'config', 'is_required', 'order_index', 'is_visible',
      'width', 'is_readonly', 'default_value', 'formula', 'mapping'
    ];
    const jsonFields = ['config', 'mapping'];
    const booleanFields = ['is_visible', 'is_required', 'is_readonly'];

    const targetType = updates.column_type || existingColumn.type;

    // ADR-0016 Phase 2: validate `config.visibility` on file-type columns
    // when config is being touched. We deliberately do not auto-fill
    // missing values on PATCH — the guard already falls back to 'private'
    // if it's absent — so callers can clear the field by sending an empty
    // config without us silently re-stamping 'private' on every update.
    if (
      Object.prototype.hasOwnProperty.call(updates, 'config') &&
      updates.config &&
      Object.prototype.hasOwnProperty.call(updates.config, 'visibility')
    ) {
      const v = updates.config.visibility;
      if (isFileColumnType(targetType)) {
        if (!FILE_VISIBILITY_VALUES.includes(v)) {
          return badRequest(
            res,
            `Invalid visibility '${v}'. Must be one of: ${FILE_VISIBILITY_VALUES.join(', ')}`
          );
        }
      } else {
        return badRequest(res, '`visibility` is only valid on file-type columns');
      }
    }

    // ADR-0011 Phase F follow-up: if column is (or becomes) a verification
    // column AND config is being updated, normalize it through the same
    // validator used on CREATE. This enforces the canonical FLAT shape and
    // prevents clients from persisting nested `config.verification.*`
    // (which silently broke enforceVerificationGuards in the original bug).
    if (targetType === 'verification' && Object.prototype.hasOwnProperty.call(updates, 'config')) {
      if (process.env.VERIFICATION_COLUMN_ENABLED !== 'true') {
        return badRequest(res, 'Verification column type is disabled (set VERIFICATION_COLUMN_ENABLED=true to enable)');
      }
      const cfgCheck = validateVerificationConfig(updates.config || {});
      if (!cfgCheck.ok) {
        return badRequest(res, `Invalid verification config: ${cfgCheck.error}`);
      }
      updates.config = cfgCheck.normalized;
    }

    // ADR-204 Stage 2 / ADR-0035 S1.2 / ADR-0035-A: a column that is (or becomes)
    // content/contact/geo_point/address keeps a valid versioned config block —
    // stamped when only the type changes.
    if (
      ['content', 'contact', 'geo_point', 'address'].includes(targetType) &&
      (updates.column_type !== undefined || Object.prototype.hasOwnProperty.call(updates, 'config'))
    ) {
      const base = Object.prototype.hasOwnProperty.call(updates, 'config')
        ? updates.config
        : (existingColumn.config ? JSON.parse(existingColumn.config) : {});
      const cfgCheck = validateColumnConfig(targetType, base);
      if (!cfgCheck.ok) return badRequest(res, `Invalid ${targetType} config: ${cfgCheck.error}`);
      updates.config = cfgCheck.normalized;
    }

    const updateFields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key === 'column_type' ? 'type' : key} = ?`);

        let processedValue = value;
        if (jsonFields.includes(key)) {
          processedValue = JSON.stringify(value);
        } else if (booleanFields.includes(key)) {
          processedValue = value ? 1 : 0;
        }

        values.push(processedValue);
      }
    }

    if (updateFields.length === 0) {
      return badRequest(res, 'No valid fields to update');
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(columnId, tableId);

    const updated = await withTransactionAsync(async tx => {
      // Serialize schema changes within this table, then re-read the key under the lock.
      const table = await tx.get('SELECT is_system, sync_target, data_source_id FROM universal_tables WHERE id = ? FOR UPDATE', [tableId]);
      const column = await tx.get('SELECT column_name, type, is_locked, is_system FROM table_columns WHERE id = ? AND table_id = ? FOR UPDATE', [columnId, tableId]);
      if (!column || !table) throw Object.assign(new Error('Column not found'), { status: 404, code: 'NOT_FOUND' });
      // ADR-0035-A link integrity: an address may only point at a geo_point of
      // this table, and a geo_point that address columns point at keeps its type.
      if (targetType === 'address' && updates.config !== undefined) {
        const linkError = await assertAddressGeoLink(tx.get, tableId, updates.config);
        if (linkError) throw Object.assign(new Error('config.address.geo_column_id must be a geo_point column of this table'), { status: 400, code: linkError });
      }
      if (column.type === 'geo_point' && targetType !== 'geo_point') {
        const dependent = await tx.get(
          `SELECT id FROM table_columns WHERE table_id = ? AND type = 'address' AND (config::jsonb #>> '{address,geo_column_id}') = ? LIMIT 1`,
          [tableId, String(columnId)]
        );
        if (dependent) throw Object.assign(new Error(`Column is the linked geo point of address column ${dependent.id}; unlink it first`), { status: 400, code: 'GEO_COLUMN_IN_USE' });
      }
      if (updates.column_name !== undefined && updates.column_name !== column.column_name) {
        if (toBool(column.is_locked) || toBool(column.is_system) || table.data_source_id || (toBool(table.is_system) && table.sync_target)) {
          throw Object.assign(new Error('Cannot rename a system or external column'), { status: 400, code: 'BAD_REQUEST' });
        }
        const duplicate = await tx.get('SELECT id FROM table_columns WHERE table_id = ? AND id <> ? AND (column_name = ? OR id::text = ?) LIMIT 1',
          [tableId, columnId, updates.column_name, updates.column_name]);
        if (duplicate) throw Object.assign(new Error('Column key already exists in this table'), { status: 409, code: 'COLUMN_KEY_CONFLICT' });
        await tx.run(`SELECT id FROM table_rows WHERE table_id = ?
          AND (jsonb_exists(data, ?) OR jsonb_exists(data, ?)) ORDER BY id FOR UPDATE`,
        [tableId, column.column_name, updates.column_name]);
        const collision = await tx.get('SELECT id FROM table_rows WHERE table_id = ? AND jsonb_exists(data, ?) LIMIT 1', [tableId, updates.column_name]);
        if (collision) throw Object.assign(new Error('Destination key already contains row data'), { status: 409, code: 'COLUMN_KEY_CONFLICT' });
        await tx.run(`UPDATE table_rows SET data = (data - $1::text) || jsonb_build_object($2::text, data->$1::text),
          updated_at = CURRENT_TIMESTAMP WHERE table_id = $3 AND jsonb_exists(data, $1::text)`,
        [column.column_name, updates.column_name, tableId]);
      }
      await tx.run(`UPDATE table_columns SET ${updateFields.join(', ')} WHERE id = ? AND table_id = ?`, values);
      return tx.get(`SELECT
        id, table_id, column_name AS name, display_name, type AS column_type, config,
        is_required, is_readonly, order_index, is_visible, width, is_locked,
        default_value, formula, mapping, created_at, updated_at
        FROM table_columns WHERE id = ? AND table_id = ?`, [columnId, tableId]);
    });

    const response = {
      ...updated,
      config: updated.config ? JSON.parse(updated.config) : {},
      mapping: updated.mapping ? JSON.parse(updated.mapping) : null,
      is_required: toBool(updated.is_required),
      is_readonly: toBool(updated.is_readonly),
      is_visible: toBool(updated.is_visible),
      is_locked: toBool(updated.is_locked)
    };

    apiLogger.info({ columnId, updates: Object.keys(updates) }, 'Column updated');
    return success(res, response);

  } catch (err) {
    if ([400, 404, 409].includes(err.status)) return error(res, err.code, err.message, err.status);
    if (err.code === '23505') return error(res, 'COLUMN_KEY_CONFLICT', 'Column key already exists in this table', 409);
    apiLogger.error({ err }, 'PATCH /tables/:tableId/columns/:columnId error');
    return error(res, 'COLUMN_UPDATE_FAILED', 'Failed to update column', 500, err.message);
  }
});

// ============================================================
// DELETE /api/v3/tables/:tableId/columns/:columnId
// Delete a column
// ============================================================
router.delete('/tables/:tableId/columns/:columnId', verifyTableAccess, async (req, res) => {
  try {
    const { columnId } = req.params;

    const column = await dbGet(
      'SELECT id, table_id, type, column_name AS name, is_locked FROM table_columns WHERE id = ?',
      [columnId]
    );
    if (!column) {
      return notFound(res, 'Column');
    }

    if (toBool(column.is_locked)) {
      return badRequest(res, 'Cannot delete system column');
    }

    await withTransactionAsync(async tx => {
      await tx.run('DELETE FROM table_columns WHERE id = ?', [columnId]);
      // ADR-0035-A AC4: address columns linked to this geo_point lose the link
      // in the same transaction — never a dangling geo_column_id.
      if (column.type === 'geo_point') {
        await tx.run(
          `UPDATE table_columns SET config = jsonb_set(config::jsonb, '{address,geo_column_id}', 'null')::text, updated_at = CURRENT_TIMESTAMP
            WHERE table_id = ? AND type = 'address' AND (config::jsonb #>> '{address,geo_column_id}') = ?`,
          [column.table_id, String(columnId)]
        );
      }
    });

    apiLogger.info({ columnId, name: column.name }, 'Column deleted');
    return success(res, {
      message: `Column "${column.name}" deleted successfully`,
      columnId: column.id
    });

  } catch (err) {
    apiLogger.error({ err }, 'DELETE /tables/:tableId/columns/:columnId error');
    return error(res, 'COLUMN_DELETE_FAILED', 'Failed to delete column', 500, err.message);
  }
});

export default router;
