// columns/columnOpsController.js — Reorder columns, convert-to-iso

import express from 'express';
import { dbAll, dbGet, dbRun } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, error } from '../../../utils/response.js';
import { verifyTableAccess } from './helpers.js';

const router = express.Router();

// ============================================================
// POST /api/v3/tables/:tableId/columns/reorder
// Reorder columns
// ============================================================
router.post('/tables/:tableId/columns/reorder', verifyTableAccess, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { order } = req.body;

    if (!order || !Array.isArray(order)) {
      return badRequest(res, 'order must be an array of column IDs');
    }

    for (let i = 0; i < order.length; i++) {
      await dbRun(
        'UPDATE table_columns SET order_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND table_id = ?',
        [i, order[i], tableId]
      );
    }

    apiLogger.info({ tableId, order }, 'Columns reordered');
    return success(res, { message: 'Columns reordered successfully' });

  } catch (err) {
    apiLogger.error({ err }, 'POST /tables/:tableId/columns/reorder error');
    return error(res, 'COLUMN_REORDER_FAILED', 'Failed to reorder columns', 500, err.message);
  }
});

// ============================================================
// POST /api/v3/tables/:tableId/columns/:columnId/convert-to-iso
// Batch-convert EU/US date values to ISO format
// ============================================================
router.post('/tables/:tableId/columns/:columnId/convert-to-iso', verifyTableAccess, async (req, res) => {
  try {
    const { tableId, columnId } = req.params;

    const column = await dbGet(
      'SELECT id, column_name AS name, type AS column_type, config FROM table_columns WHERE id = ? AND table_id = ?',
      [columnId, tableId]
    );
    if (!column) {
      return notFound(res, 'Column');
    }

    const config = column.config ? JSON.parse(column.config) : {};
    const mode = config?.date?.mode || (column.column_type === 'datetime' ? 'datetime' : 'date');
    const storageFormat = config?.date?.storageFormat || config?.date?.dateFormat || 'iso';

    if (storageFormat === 'iso') {
      return badRequest(res, 'Column is already in ISO format');
    }
    if (storageFormat !== 'eu' && storageFormat !== 'us') {
      return badRequest(res, 'Convert to ISO only supports EU and US formats');
    }
    if (mode !== 'date' && mode !== 'datetime') {
      return badRequest(res, 'Convert to ISO only applies to date and datetime modes');
    }

    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ?',
      [tableId]
    );

    let converted = 0;
    let failed = 0;
    let skipped = 0;

    const columnName = column.name;

    for (const row of rows) {
      const rowData = row.data ? JSON.parse(row.data) : {};
      const val = rowData[columnName];

      if (val === null || val === undefined || val === '') {
        skipped++;
        continue;
      }

      const str = String(val);
      let isoValue = null;

      try {
        if (storageFormat === 'eu') {
          if (mode === 'date') {
            // DD.MM.YYYY -> YYYY-MM-DD
            const match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
            if (match) {
              const day = match[1].padStart(2, '0');
              const month = match[2].padStart(2, '0');
              isoValue = `${match[3]}-${month}-${day}`;
            }
          } else {
            // DD.MM.YYYY HH:mm[:ss] -> YYYY-MM-DDTHH:mm:ssZ
            const match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s(\d{2}):(\d{2})(?::(\d{2}))?/);
            if (match) {
              const day = match[1].padStart(2, '0');
              const month = match[2].padStart(2, '0');
              const sec = match[6] || '00';
              isoValue = `${match[3]}-${month}-${day}T${match[4]}:${match[5]}:${sec}Z`;
            }
          }
        } else if (storageFormat === 'us') {
          if (mode === 'date') {
            // MM/DD/YYYY -> YYYY-MM-DD
            const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (match) {
              const month = match[1].padStart(2, '0');
              const day = match[2].padStart(2, '0');
              isoValue = `${match[3]}-${month}-${day}`;
            }
          } else {
            // MM/DD/YYYY HH:mm[:ss] -> YYYY-MM-DDTHH:mm:ssZ
            const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s(\d{2}):(\d{2})(?::(\d{2}))?/);
            if (match) {
              const month = match[1].padStart(2, '0');
              const day = match[2].padStart(2, '0');
              const sec = match[6] || '00';
              isoValue = `${match[3]}-${month}-${day}T${match[4]}:${match[5]}:${sec}Z`;
            }
          }
        }

        // Check if value is already ISO -- skip
        if (!isoValue && /^\d{4}-\d{2}-\d{2}/.test(str)) {
          skipped++;
          continue;
        }

        if (isoValue) {
          rowData[columnName] = isoValue;
          await dbRun(
            'UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(rowData), row.id]
          );
          converted++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }

    // Update column config: storageFormat -> 'iso'
    const newConfig = {
      ...config,
      date: {
        ...config.date,
        storageFormat: 'iso',
      },
    };
    if (newConfig.date?.dateFormat) {
      delete newConfig.date.dateFormat;
    }

    await dbRun(
      'UPDATE table_columns SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(newConfig), columnId]
    );

    apiLogger.info({ columnId, tableId, converted, failed, skipped }, 'Column values converted to ISO');
    return success(res, { converted, failed, skipped });

  } catch (err) {
    apiLogger.error({ err }, 'POST /tables/:tableId/columns/:columnId/convert-to-iso error');
    return error(res, 'CONVERT_TO_ISO_FAILED', 'Failed to convert values to ISO', 500, err.message);
  }
});

export default router;
