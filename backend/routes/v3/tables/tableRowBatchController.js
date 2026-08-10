/**
 * Table row batch operations controller
 * Handles: POST /tables/:tableId/rows/batch-update,
 *          POST /tables/:tableId/rows/batch-delete
 */
import express from 'express';
import { dbAll, dbGet, dbRun, sqlNow, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, forbidden, error } from '../../../utils/response.js';
import { resolveSelectValues } from '../../../services/SelectValueResolver.js';
import { checkTableAccess } from './helpers.js';
import { fireRowUpdateTriggers } from '../../../services/AutomationTriggerService.js';

const router = express.Router();

/**
 * POST /api/v3/tables/:tableId/rows/batch-update
 * Batch update multiple rows at once
 * Useful for bulk replace and mass updates
 */
router.post('/tables/:tableId/rows/batch-update', async (req, res) => {
  try {
    const { tableId } = req.params;
    const { updates } = req.body;

    // Validate input
    if (!Array.isArray(updates) || updates.length === 0) {
      return badRequest(res, 'Updates array is required and must not be empty');
    }

    // Limit batch size for safety (single transactional batch)
    const MAX_BATCH_SIZE = 10000;
    if (updates.length > MAX_BATCH_SIZE) {
      return error(
        res,
        'BATCH_LIMIT_EXCEEDED',
        `Batch size exceeds limit of ${MAX_BATCH_SIZE}`,
        400,
        { limit: MAX_BATCH_SIZE, requested: updates.length }
      );
    }

    apiLogger.debug({ tableId, count: updates.length }, "BATCH UPDATE request");

    // Check access if API key has project restriction
    if (req.user?.projectId) {
      const access = await checkTableAccess(tableId, req.user);
      if (!access.allowed) {
        return forbidden(res, access.error);
      }
    }

    // Get table info
    const table = await dbGet(`
      SELECT data_source_id, source_table_name, source_id_column
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    if (!table) {
      return notFound(res, 'Table');
    }

    // Get columns for this table
    const columns = await dbAll(`
      SELECT id, column_name
      FROM table_columns
      WHERE table_id = ?
    `, [tableId]);

    // Build column ID to name map
    const columnIdToName = {};
    for (const col of columns) {
      columnIdToName[col.id] = col.column_name;
      columnIdToName[String(col.id)] = col.column_name;
    }

    const results = {
      success: true,
      updated: 0,
      errors: []
    };

    // ADR-0025 A.2: row_update triggers are collected during the transaction
    // and fired after COMMIT so they observe persisted state.
    const pendingTriggers = [];

    // Process updates in a transaction
    await dbRun('BEGIN TRANSACTION');

    try {
      for (const update of updates) {
        const { rowId, data } = update;

        if (!rowId || !data) {
          results.errors.push({ rowId: String(rowId), error: 'Missing rowId or data' });
          continue;
        }

        try {
          // Handle local table_rows
          if (!table.data_source_id || !table.source_table_name) {
            // Get existing row
            const existingRow = await dbGet(
              'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
              [rowId, tableId]
            );

            if (!existingRow) {
              results.errors.push({ rowId: String(rowId), error: 'Row not found' });
              continue;
            }

            // Map column_id keys to column_name keys
            const normalizedData = {};
            for (const [key, value] of Object.entries(data)) {
              if (columnIdToName[key]) {
                normalizedData[columnIdToName[key]] = value;
              } else {
                normalizedData[key] = value;
              }
            }

            // ADR-098: Resolve select column text values -> numeric IDs before merge
            const { resolvedData: validatedBatchData } = await resolveSelectValues(tableId, normalizedData);

            // Merge data
            const existingData = safeJsonParse(existingRow.data) || {};
            const mergedData = { ...existingData, ...validatedBatchData };

            await dbRun(
              `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
              [JSON.stringify(mergedData), rowId]
            );

            pendingTriggers.push({ rowId: existingRow.id, oldData: existingData, newData: mergedData });

            results.updated++;
          } else {
            // Handle external data source - save to local table_rows as virtual data
            const existingRow = await dbGet(
              'SELECT id, data FROM table_rows WHERE table_id = ? AND base_id = ?',
              [tableId, rowId]
            );

            if (existingRow) {
              const existingData = safeJsonParse(existingRow.data) || {};
              const mergedData = { ...existingData, ...data };

              await dbRun(
                `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
                [JSON.stringify(mergedData), existingRow.id]
              );
            } else {
              await dbRun(
                `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
                [tableId, rowId, JSON.stringify(data)]
              );
            }

            results.updated++;
          }
        } catch (rowError) {
          apiLogger.error({ err: rowError, rowId }, 'BATCH UPDATE row error');
          results.errors.push({ rowId: String(rowId), error: rowError.message });
        }
      }

      await dbRun('COMMIT');
    } catch (txError) {
      await dbRun('ROLLBACK');
      throw txError;
    }

    for (const t of pendingTriggers) {
      fireRowUpdateTriggers(parseInt(tableId), t.rowId, t.newData, t.oldData).catch(err => {
        apiLogger.warn({ err, tableId, rowId: t.rowId }, 'Batch row update trigger failed (non-blocking)');
      });
    }

    apiLogger.info({ updated: results.updated, errors: results.errors.length }, "BATCH UPDATE completed");

    success(res, {
      updated: results.updated,
      errors: results.errors.length > 0 ? results.errors : undefined
    });
  } catch (err) {
    apiLogger.error({ err }, 'POST batch-update error');
    error(res, 'BATCH_UPDATE_FAILED', err.message, 500);
  }
});

/**
 * POST /api/v3/tables/:tableId/rows/batch-delete
 * Batch delete multiple rows at once
 * Body: { rowIds: string[] }
 */
router.post('/tables/:tableId/rows/batch-delete', async (req, res) => {
  try {
    const { tableId } = req.params;
    const { rowIds } = req.body;

    // Validate input
    if (!Array.isArray(rowIds) || rowIds.length === 0) {
      return badRequest(res, 'rowIds array is required and must not be empty');
    }

    // Limit batch size for safety (single transactional batch)
    const MAX_BATCH_SIZE = 10000;
    if (rowIds.length > MAX_BATCH_SIZE) {
      return error(
        res,
        'BATCH_LIMIT_EXCEEDED',
        `Batch size exceeds limit of ${MAX_BATCH_SIZE}`,
        400,
        { limit: MAX_BATCH_SIZE, requested: rowIds.length }
      );
    }

    apiLogger.debug({ tableId, count: rowIds.length }, "BATCH DELETE request");

    // Check access if API key has project restriction
    if (req.user?.projectId) {
      const access = await checkTableAccess(tableId, req.user);
      if (!access.allowed) {
        return forbidden(res, access.error);
      }
    }

    // Get table info
    const table = await dbGet(`
      SELECT id, data_source_id, source_table_name
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    if (!table) {
      return notFound(res, 'Table');
    }

    // Only support local tables for batch delete
    if (table.data_source_id) {
      return badRequest(res, 'Batch delete is not supported for external data sources');
    }

    // Perform batch delete in transaction
    await dbRun('BEGIN TRANSACTION');

    try {
      const placeholders = rowIds.map(() => '?').join(',');

      const result = await dbRun(
        `DELETE FROM table_rows WHERE table_id = ? AND id IN (${placeholders})`,
        [tableId, ...rowIds]
      );

      await dbRun('COMMIT');

      apiLogger.info({ deleted: result.changes }, "BATCH DELETE completed");

      success(res, { deleted: result.changes });
    } catch (txError) {
      await dbRun('ROLLBACK');
      throw txError;
    }
  } catch (err) {
    apiLogger.error({ err }, 'POST batch-delete error');
    error(res, 'BATCH_DELETE_FAILED', err.message, 500);
  }
});

export default router;
