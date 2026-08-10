/**
 * @swagger
 * tags:
 *   - name: Rows
 *     description: Table rows (data records) bulk operations
 */

/**
 * API v3: Rows Routes
 * ADR-019: Extracted from tables.js for better separation of concerns
 * 
 * Endpoints:
 * - POST   /tables/:tableId/rows/import       - Bulk import rows
 * - POST   /tables/:tableId/rows/batch-update - Batch update rows
 * - POST   /tables/:tableId/rows/batch-delete - Batch delete rows
 * 
 * Note: Basic CRUD (GET/POST/PUT/DELETE single rows) remains in tables.js
 * for now to minimize breaking changes. This file handles bulk operations.
 */

import express from 'express';
import { dbAll, dbGet, dbRun, toBool, withTransactionAsync } from '../../database/connection.js';
import { generateBaseId } from '../../utils/baseId.js';
import { apiLogger } from '../../utils/logger.js';
import { success, error, notFound, badRequest, forbidden } from '../../utils/response.js';
import { resolveSelectValues } from '../../services/SelectValueResolver.js';

const router = express.Router();

// ============================================================
// Middleware: Verify table exists and user has access
// ============================================================
const verifyTableAccess = async (req, res, next) => {
  const { tableId } = req.params;
  const userId = req.user?.id;

  const table = await dbGet(`
    SELECT 
      ut.id, 
      ut.project_id, 
      ut.is_system, 
      ut.sync_target,
      p.owner_id,
      p.space_id
    FROM universal_tables ut
    JOIN projects p ON ut.project_id = p.id
    WHERE ut.id = ?
  `, [tableId]);

  if (!table) {
    return notFound(res, 'Table');
  }

  // Check access
  const isProjectOwner = table.owner_id === userId;
  const isSysAdmin = req.user?.role === 'admin' || req.user?.role === 'owner';

  if (!isProjectOwner && !isSysAdmin) {
    if (table.space_id) {
      try {
        const space = await dbGet('SELECT id, owner_id FROM spaces WHERE id = ?', [table.space_id]);
        if (space && space.owner_id === userId) {
          req.table = table;
          return next();
        }
      } catch (e) {
        // Ignore space lookup errors
      }
    }
    return forbidden(res, 'You do not have access to this table');
  }

  req.table = table;
  next();
};

/**
 * @swagger
 * /tables/{tableId}/rows/import:
 *   post:
 *     tags: [Rows]
 *     summary: Bulk import rows
 *     description: Import multiple rows from CSV or JSON data
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
 *             required:
 *               - rows
 *             properties:
 *               rows:
 *                 type: array
 *                 items:
 *                   type: object
 *               mode:
 *                 type: string
 *                 enum: [add, update]
 *                 default: add
 *               idMapping:
 *                 type: object
 *                 properties:
 *                   csvColumn:
 *                     type: string
 *                   tableColumn:
 *                     type: string
 *               addNewIds:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Import results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     added:
 *                       type: integer
 *                     updated:
 *                       type: integer
 *                     skipped:
 *                       type: integer
 *                     errors:
 *                       type: array
 *       400:
 *         description: Bad request
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Table not found
 */
// ============================================================
// POST /api/v3/tables/:tableId/rows/import
// Bulk import rows from CSV or JSON
// ============================================================
router.post('/tables/:tableId/rows/import', verifyTableAccess, async (req, res) => {
  const { tableId } = req.params;
  const { rows, mode = 'add', idMapping, addNewIds = false } = req.body;
  const userId = req.user?.id;

  apiLogger.info({ tableId, mode, rowCount: rows?.length, idMapping, addNewIds }, 'Import started');

  try {
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return badRequest(res, 'No rows provided for import');
    }

    // Get table columns for validation
    const columns = await dbAll(
      'SELECT * FROM table_columns WHERE table_id = ? ORDER BY order_index',
      [tableId]
    );

    const stats = {
      added: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    if (mode === 'add') {
      // Simple add mode - insert all rows
      for (let i = 0; i < rows.length; i++) {
        const rowData = rows[i];
        try {
          // ADR-098: Resolve select column text values → numeric IDs before insert
          const { resolvedData: validatedRowData } = await resolveSelectValues(tableId, rowData);
          const baseId = generateBaseId();
          await dbRun(`
            INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `, [tableId, baseId, JSON.stringify(validatedRowData), userId]);
          stats.added++;
        } catch (err) {
          stats.errors.push({ row: i + 1, error: err.message });
          stats.skipped++;
        }
      }
    } else if (mode === 'update') {
      // Update mode - find by ID and update, optionally add new
      if (!idMapping || !idMapping.csvColumn || !idMapping.tableColumn) {
        return badRequest(res, 'ID mapping is required for update mode');
      }

      const tableIdColumn = idMapping.tableColumn;
      const csvIdColumn = idMapping.csvColumn;

      for (let i = 0; i < rows.length; i++) {
        const rowData = rows[i];
        const csvIdValue = rowData[csvIdColumn];

        if (!csvIdValue) {
          stats.skipped++;
          stats.errors.push({ row: i + 1, error: 'Missing ID value' });
          continue;
        }

        try {
          let existingRow = null;

          if (tableIdColumn === 'id') {
            // Match by system row ID
            existingRow = await dbGet(
              'SELECT * FROM table_rows WHERE table_id = ? AND id = ?',
              [tableId, csvIdValue]
            );
          } else {
            // Match by data column value
            const allRows = await dbAll(
              'SELECT * FROM table_rows WHERE table_id = ?',
              [tableId]
            );
            
            existingRow = allRows.find(r => {
              const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
              return String(data[tableIdColumn]) === String(csvIdValue);
            });
          }

          if (existingRow) {
            // ADR-098: Resolve select column text values → numeric IDs before merge
            const { resolvedData: validatedRowData } = await resolveSelectValues(tableId, rowData);

            // Update existing row
            const currentData = typeof existingRow.data === 'string'
              ? JSON.parse(existingRow.data)
              : existingRow.data;

            // Merge data - new values override old
            const mergedData = { ...currentData };
            for (const [key, value] of Object.entries(validatedRowData)) {
              if (value !== null && value !== undefined && key !== csvIdColumn) {
                mergedData[key] = value;
              }
            }

            await dbRun(`
              UPDATE table_rows
              SET data = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `, [JSON.stringify(mergedData), existingRow.id]);

            stats.updated++;
          } else if (addNewIds) {
            // Add as new row
            const { resolvedData: validatedRowData } = await resolveSelectValues(tableId, rowData);
            const baseId = generateBaseId();
            await dbRun(`
              INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [tableId, baseId, JSON.stringify(validatedRowData), userId]);
            stats.added++;
          } else {
            stats.skipped++;
          }
        } catch (err) {
          stats.errors.push({ row: i + 1, error: err.message });
          stats.skipped++;
        }
      }
    }

    apiLogger.info({ tableId, stats }, 'Import completed');

    return success(res, {
      message: 'Import completed',
      stats
    });

  } catch (err) {
    apiLogger.error({ err }, 'POST /tables/:tableId/rows/import error');
    return error(res, 'IMPORT_FAILED', 'Failed to import rows', 500, err.message);
  }
});

// ============================================================
// POST /api/v3/tables/:tableId/rows/batch-update
// Batch update multiple rows
// ============================================================
router.post('/tables/:tableId/rows/batch-update', verifyTableAccess, async (req, res) => {
  const { tableId } = req.params;
  const { rows } = req.body;

  try {
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return badRequest(res, 'No rows provided for batch update');
    }

    let updated = 0;
    const errors = [];

    for (const rowUpdate of rows) {
      const { id, data } = rowUpdate;
      
      if (!id || !data) {
        errors.push({ id, error: 'Missing id or data' });
        continue;
      }

      try {
        // Get existing row
        const existingRow = await dbGet(
          'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
          [id, tableId]
        );

        if (!existingRow) {
          errors.push({ id, error: 'Row not found' });
          continue;
        }

        // Merge data
        const existingData = typeof existingRow.data === 'string' 
          ? JSON.parse(existingRow.data) 
          : existingRow.data;
        const mergedData = { ...existingData, ...data };

        await dbRun(`
          UPDATE table_rows 
          SET data = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [JSON.stringify(mergedData), id]);

        updated++;
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

    apiLogger.info({ tableId, updated, errorCount: errors.length }, 'Batch update completed');

    return success(res, {
      message: 'Batch update completed',
      updated,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    apiLogger.error({ err }, 'POST /tables/:tableId/rows/batch-update error');
    return error(res, 'BATCH_UPDATE_FAILED', 'Failed to batch update rows', 500, err.message);
  }
});

// ============================================================
// POST /api/v3/tables/:tableId/rows/batch-delete
// Batch delete multiple rows
// ============================================================
router.post('/tables/:tableId/rows/batch-delete', verifyTableAccess, async (req, res) => {
  const { tableId } = req.params;
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return badRequest(res, 'No row IDs provided for batch delete');
    }

    let deleted = 0;
    const errors = [];

    // Wrap batch delete in transaction for atomicity
    const txResult = await withTransactionAsync(async (trx) => {
      let txDeleted = 0;
      const txErrors = [];
      for (const id of ids) {
        try {
          const result = await trx.run(
            'DELETE FROM table_rows WHERE id = ? AND table_id = ?',
            [id, tableId]
          );
          if (result.changes > 0) {
            txDeleted++;
          } else {
            txErrors.push({ id, error: 'Row not found or already deleted' });
          }
        } catch (err) {
          txErrors.push({ id, error: err.message });
        }
      }
      return { deleted: txDeleted, errors: txErrors };
    });
    deleted = txResult.deleted;
    errors.push(...txResult.errors);

    apiLogger.info({ tableId, deleted, errorCount: errors.length }, 'Batch delete completed');

    return success(res, {
      message: 'Batch delete completed',
      deleted,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    apiLogger.error({ err }, 'POST /tables/:tableId/rows/batch-delete error');
    return error(res, 'BATCH_DELETE_FAILED', 'Failed to batch delete rows', 500, err.message);
  }
});

export default router;
