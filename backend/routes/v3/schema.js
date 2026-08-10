// API v3: Schema Editor Routes
// Handles database schema visualization and layout persistence
/**
 * @swagger
 * components:
 *   schemas:
 *     SchemaTable:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         columns:
 *           type: array
 *         row_count:
 *           type: integer
 *     SchemaLayout:
 *       type: object
 *       properties:
 *         tables:
 *           type: object
 *         connections:
 *           type: array
 */
import express from 'express';
import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import { escapeIdentifier } from '../../utils/sqlSanitizer.js';
import { checkUserSpaceAccess, getSpaceById } from '../../services/SpaceService.js';
import { apiLogger } from '../../utils/logger.js';
import { success, error, badRequest, notFound, forbidden } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/v3/spaces/:spaceId/schema
 * Get complete schema for space (tables + columns + layout)
 * @swagger
 * /api/v3/spaces/{spaceId}/schema:
 *   get:
 *     summary: Get complete schema for space
 *     tags: [Schema]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: spaceId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Schema with tables and layout
 */
router.get('/spaces/:spaceId/schema', async (req, res) => {
  const { spaceId } = req.params;

  try {
    // Verify space exists
    const space = await getSpaceById(spaceId);
    if (!space) {
      return notFound(res, 'Space not found');
    }

    // Verify access (owner, admin, or allowed via access_control)
    const hasAccess = await checkUserSpaceAccess(req.user.id, req.user.role, space, space.access_control);
    if (!hasAccess) {
      return forbidden(res, 'Access denied');
    }

    // Get all tables in space (via projects)
    const tables = await dbAll(`
      SELECT t.*, p.name as project_name, p.id as project_id, p.icon as project_icon
      FROM universal_tables t
      JOIN projects p ON t.project_id = p.id
      WHERE p.space_id = ?
      ORDER BY t.created_at
    `, [spaceId]);

    // Get columns for each table + row count + sample values
    for (const table of tables) {
      // Get columns
      const columns = await dbAll(
        `SELECT * FROM table_columns WHERE table_id = ? ORDER BY id`,
        [table.id]
      );
      
      // Get row count
      try {
        const safeTableName = escapeIdentifier(table.name);
        const countResult = await dbGet(
          `SELECT COUNT(*) as count FROM ${safeTableName}`,
          []
        );
        table.row_count = countResult?.count || 0;
      } catch (e) {
        table.row_count = 0;
      }
      
      // Get first row for sample values
      let sampleRow = null;
      try {
        const safeTableName = escapeIdentifier(table.name);
        sampleRow = await dbGet(
          `SELECT * FROM ${safeTableName} LIMIT 1`,
          []
        );
      } catch (e) {
        // Table might not exist yet
      }
      
      // Parse JSON config for each column and add sample values
      // Add system 'id' column (row_id) first - only if not already defined
      const hasIdColumn = columns.some(col => col.column_name === 'id');
      const idColumn = {
        id: 0,
        name: 'id',
        display_name: 'ID',
        type: 'number',
        is_required: true,
        is_system: true,
        config: {
          appearance: {
            indicator: { type: 'emoji', value: '🔑' }
          }
        },
        sample_value: sampleRow ? sampleRow.id : undefined
      };
      
      const mappedColumns = columns
        .filter(col => col.column_name !== 'id') // Exclude id if exists in table_columns
        .map(col => ({
          id: col.id,
          name: col.column_name,
          display_name: col.display_name,
          type: col.type,
          is_required: col.is_required,
          is_system: col.is_system,
          config: col.config ? JSON.parse(col.config) : null,
          sample_value: sampleRow ? sampleRow[col.column_name] : undefined
        }));
      
      table.columns = [idColumn, ...mappedColumns];
    }

    // Get saved layout (if exists)
    const layoutRow = await dbGet(
      'SELECT layout FROM schema_layouts WHERE space_id = ?',
      [spaceId]
    );
    const layout = layoutRow ? JSON.parse(layoutRow.layout) : null;

    success(res, { tables, layout });
  } catch (err) {
    apiLogger.error('Error fetching schema:', err);
    error(res, err.message);
  }
});

/**
 * PUT /api/v3/spaces/:spaceId/schema/layout
 * Save node positions
 */
router.put('/spaces/:spaceId/schema/layout', async (req, res) => {
  const { spaceId } = req.params;
  const { nodes } = req.body;

  try {
    // Verify space exists and user has access
    const space = await getSpaceById(spaceId);
    if (!space) {
      return notFound(res, 'Space not found');
    }
    const hasAccess = await checkUserSpaceAccess(req.user.id, req.user.role, space, space.access_control);
    if (!hasAccess) {
      return forbidden(res, 'Access denied');
    }

    // Upsert layout
    const existingLayout = await dbGet(
      'SELECT id FROM schema_layouts WHERE space_id = ?',
      [spaceId]
    );

    if (existingLayout) {
      await dbRun(
        `UPDATE schema_layouts SET layout = ?, updated_at = CURRENT_TIMESTAMP WHERE space_id = ?`,
        [JSON.stringify(nodes), spaceId]
      );
    } else {
      await dbRun(
        `INSERT INTO schema_layouts (space_id, layout) VALUES (?, ?)`,
        [spaceId, JSON.stringify(nodes)]
      );
    }

    success(res);
  } catch (err) {
    apiLogger.error('Error saving layout:', err);
    error(res, err.message);
  }
});

/**
 * POST /api/v3/spaces/:spaceId/schema/tables
 * Create table from schema editor
 */
router.post('/spaces/:spaceId/schema/tables', async (req, res) => {
  const { spaceId } = req.params;
  const { name, displayName, projectId, icon, description, columns, position } = req.body;

  try {
    // Verify project belongs to space
    const project = await dbGet(
      'SELECT p.* FROM projects p WHERE p.id = ? AND p.space_id = ?',
      [projectId, spaceId]
    );
    
    if (!project) {
      return badRequest(res, 'Project does not belong to this space');
    }

    // Generate unique key from name
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    // Create table
    const result = await dbRun(`
      INSERT INTO universal_tables (project_id, name, display_name, key, icon, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [projectId, name, displayName || name, key, icon || '📋', description || null]);

    const tableId = result.lastInsertRowid;

    // Create default ID column
    await dbRun(`
      INSERT INTO table_columns (table_id, name, display_name, type, "order", is_required)
      VALUES (?, 'id', 'ID', 'id', 0, 1)
    `, [tableId]);

    // Create additional columns if provided
    if (columns?.length) {
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        await dbRun(`
          INSERT INTO table_columns (table_id, name, display_name, type, "order", is_required, config)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          tableId,
          col.name,
          col.displayName || col.name,
          col.type,
          i + 1,
          col.isRequired ? 1 : 0,
          col.config ? JSON.stringify(col.config) : null
        ]);
      }
    }

    // Save position in layout if provided
    if (position) {
      const layoutRow = await dbGet('SELECT layout FROM schema_layouts WHERE space_id = ?', [spaceId]);
      let layout = layoutRow ? JSON.parse(layoutRow.layout) : [];
      layout.push({ tableId: Number(tableId), x: position.x, y: position.y });

      if (layoutRow) {
        await dbRun(
          `UPDATE schema_layouts SET layout = ?, updated_at = CURRENT_TIMESTAMP WHERE space_id = ?`,
          [JSON.stringify(layout), spaceId]
        );
      } else {
        await dbRun(
          `INSERT INTO schema_layouts (space_id, layout) VALUES (?, ?)`,
          [spaceId, JSON.stringify(layout)]
        );
      }
    }

    success(res, { id: Number(tableId) });
  } catch (err) {
    apiLogger.error('Error creating table:', err);
    error(res, err.message);
  }
});

/**
 * POST /api/v3/schema/relations
 * Create relation between tables
 */
router.post('/relations', async (req, res) => {
  const { sourceTableId, sourceColumn, targetTableId, targetColumn } = req.body;

  try {
    // Verify both tables exist
    const sourceTable = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [sourceTableId]);
    const targetTable = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [targetTableId]);

    if (!sourceTable || !targetTable) {
      return notFound(res, 'One or both tables not found');
    }

    // Check if source column exists or create it
    let sourceCol = await dbGet(
      'SELECT * FROM table_columns WHERE table_id = ? AND column_name = ?',
      [sourceTableId, sourceColumn]
    );

    if (!sourceCol) {
      // Create the relation column
      const maxOrder = await dbGet(
        'SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?',
        [sourceTableId]
      );

      const result = await dbRun(`
        INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, config)
        VALUES (?, ?, ?, 'relation', ?, ?)
      `, [
        sourceTableId,
        sourceColumn,
        sourceColumn,
        (maxOrder?.max_order || 0) + 1,
        JSON.stringify({
          relatedTableId: targetTableId,
          relatedColumn: targetColumn,
          relatedTableName: targetTable.name
        })
      ]);

      success(res, { id: Number(result.lastInsertRowid) });
    } else {
      // Update existing column to be a relation
      await dbRun(`
        UPDATE table_columns 
        SET type = 'relation', config = ?
        WHERE id = ?
      `, [
        JSON.stringify({
          relatedTableId: targetTableId,
          relatedColumn: targetColumn,
          relatedTableName: targetTable.name
        }),
        sourceCol.id
      ]);

      success(res, { id: sourceCol.id });
    }
  } catch (err) {
    apiLogger.error('Error creating relation:', err);
    error(res, err.message);
  }
});

/**
 * GET /api/v3/users/me/accessible-tables
 * Get tables from all spaces user has access to (for external tables feature)
 */
router.get('/users/me/accessible-tables', async (req, res) => {
  try {
    // Get all spaces user owns
    const spaces = await dbAll(
      `SELECT id, name FROM spaces WHERE owner_id = ? OR ? = 'admin'`,
      [req.user.id, req.user.role]
    );

    const result = [];

    for (const space of spaces) {
      const tables = await dbAll(`
        SELECT t.id, t.name, t.display_name
        FROM universal_tables t
        JOIN projects p ON t.project_id = p.id
        WHERE p.space_id = ?
        ORDER BY t.name
      `, [space.id]);

      if (tables.length > 0) {
        result.push({
          spaceId: space.id,
          spaceName: space.name,
          tables: tables.map(t => ({
            id: t.id,
            name: t.name,
            displayName: t.display_name
          }))
        });
      }
    }

    success(res, result);
  } catch (err) {
    apiLogger.error('Error fetching accessible tables:', err);
    error(res, err.message);
  }
});

export default router;
