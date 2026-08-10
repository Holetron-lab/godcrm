// API v3: Column Mapping Routes
// ADR-069: Provides mapping between table columns and standard ticket fields
// Allows CardDetailModal to display consistent labels across different table types

/**
 * @swagger
 * components:
 *   schemas:
 *     StandardField:
 *       type: object
 *       properties:
 *         key:
 *           type: string
 *           description: Standard field key (e.g., 'title', 'description')
 *         label:
 *           type: string
 *           description: Human-readable label
 *         required:
 *           type: boolean
 *           description: Whether this field is required
 *     ColumnMapping:
 *       type: object
 *       properties:
 *         tableId:
 *           type: integer
 *         tableName:
 *           type: string
 *         mappings:
 *           type: object
 *           description: Object mapping standard field keys to column names
 */

import express from 'express';
import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, badRequest, notFound } from '../../utils/response.js';

const router = express.Router();

// Standard fields that can be mapped to table columns
const STANDARD_FIELDS = [
  { key: 'title', label: 'Заголовок', required: true },
  { key: 'description', label: 'Описание', required: false },
  { key: 'priority', label: 'Приоритет', required: false },
  { key: 'status', label: 'Статус', required: false },
  { key: 'assignee', label: 'Исполнитель', required: false },
  { key: 'dueDate', label: 'Срок', required: false },
  { key: 'type', label: 'Тип', required: false },
  { key: 'createdBy', label: 'Автор', required: false },
];

/**
 * @swagger
 * /api/v3/column-mapping/defaults:
 *   get:
 *     summary: Get standard fields that can be mapped
 *     tags: [Column Mapping]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of standard fields
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
 *                     standardFields:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/StandardField'
 */
router.get('/defaults', async (req, res) => {
  try {
    return success(res, { standardFields: STANDARD_FIELDS });
  } catch (error) {
    apiLogger.error({ err: error }, 'Failed to get column mapping defaults');
    return badRequest(res, 'Failed to get defaults');
  }
});

/**
 * @swagger
 * /api/v3/column-mapping/{tableId}:
 *   get:
 *     summary: Get column mapping for a table
 *     tags: [Column Mapping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tableId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The table ID
 *     responses:
 *       200:
 *         description: Column mapping for the table
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ColumnMapping'
 *       404:
 *         description: Table not found
 */
router.get('/:tableId', async (req, res) => {
  try {
    const { tableId } = req.params;
    
    // Validate tableId is a number
    if (isNaN(parseInt(tableId, 10))) {
      return badRequest(res, 'Invalid table ID');
    }
    
    // Get table info
    const table = await dbGet('SELECT id, name FROM tables WHERE id = $1', [tableId]);
    if (!table) {
      return notFound(res, 'Table');
    }
    
    // Get mappings from table_column_mappings table
    const mappings = await dbAll(
      'SELECT standard_field, column_name FROM table_column_mappings WHERE table_id = $1',
      [tableId]
    );
    
    // Convert to object format
    const mappingsObj = {};
    for (const m of mappings) {
      mappingsObj[m.standard_field] = m.column_name;
    }
    
    apiLogger.debug({ tableId, mappingsCount: mappings.length }, 'Retrieved column mapping');
    
    return success(res, {
      tableId: parseInt(tableId, 10),
      tableName: table.name,
      mappings: mappingsObj
    });
  } catch (error) {
    apiLogger.error({ err: error, tableId: req.params.tableId }, 'Failed to get column mapping');
    return badRequest(res, 'Failed to get column mapping');
  }
});

/**
 * @swagger
 * /api/v3/column-mapping/{tableId}:
 *   post:
 *     summary: Save column mapping for a table
 *     tags: [Column Mapping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tableId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The table ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mappings
 *             properties:
 *               mappings:
 *                 type: object
 *                 description: Object mapping standard field keys to column names
 *     responses:
 *       200:
 *         description: Column mapping saved
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
 *                     tableId:
 *                       type: integer
 *                     mappings:
 *                       type: object
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Table not found
 */
router.post('/:tableId', async (req, res) => {
  try {
    const { tableId } = req.params;
    const { mappings } = req.body;
    
    // Validate tableId is a number
    if (isNaN(parseInt(tableId, 10))) {
      return badRequest(res, 'Invalid table ID');
    }
    
    // Validate mappings object
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
      return badRequest(res, 'Invalid mappings object');
    }
    
    // Check table exists
    const table = await dbGet('SELECT id FROM tables WHERE id = $1', [tableId]);
    if (!table) {
      return notFound(res, 'Table');
    }
    
    // Validate standard field keys
    const validKeys = STANDARD_FIELDS.map(f => f.key);
    for (const key of Object.keys(mappings)) {
      if (!validKeys.includes(key)) {
        return badRequest(res, `Invalid standard field: ${key}`);
      }
    }
    
    // Delete existing mappings
    await dbRun('DELETE FROM table_column_mappings WHERE table_id = $1', [tableId]);
    
    // Insert new mappings
    const savedMappings = {};
    for (const [standardField, columnName] of Object.entries(mappings)) {
      if (columnName && typeof columnName === 'string' && columnName.trim()) {
        await dbRun(
          'INSERT INTO table_column_mappings (table_id, standard_field, column_name) VALUES ($1, $2, $3)',
          [tableId, standardField, columnName.trim()]
        );
        savedMappings[standardField] = columnName.trim();
      }
    }
    
    apiLogger.info({ tableId, mappings: savedMappings }, 'Column mapping saved');
    
    return success(res, {
      tableId: parseInt(tableId, 10),
      mappings: savedMappings
    });
  } catch (error) {
    apiLogger.error({ err: error, tableId: req.params.tableId }, 'Failed to save column mapping');
    return badRequest(res, 'Failed to save column mapping');
  }
});

/**
 * @swagger
 * /api/v3/column-mapping/{tableId}:
 *   delete:
 *     summary: Delete all column mappings for a table
 *     tags: [Column Mapping]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tableId
 *         required: true
 *         schema:
 *           type: integer
 *         description: The table ID
 *     responses:
 *       200:
 *         description: Mappings deleted
 *       404:
 *         description: Table not found
 */
router.delete('/:tableId', async (req, res) => {
  try {
    const { tableId } = req.params;
    
    // Validate tableId is a number
    if (isNaN(parseInt(tableId, 10))) {
      return badRequest(res, 'Invalid table ID');
    }
    
    // Check table exists
    const table = await dbGet('SELECT id FROM tables WHERE id = $1', [tableId]);
    if (!table) {
      return notFound(res, 'Table');
    }
    
    // Delete all mappings for this table
    await dbRun('DELETE FROM table_column_mappings WHERE table_id = $1', [tableId]);
    
    apiLogger.info({ tableId }, 'Column mapping deleted');
    
    return success(res, { tableId: parseInt(tableId, 10), deleted: true });
  } catch (error) {
    apiLogger.error({ err: error, tableId: req.params.tableId }, 'Failed to delete column mapping');
    return badRequest(res, 'Failed to delete column mapping');
  }
});

export default router;
