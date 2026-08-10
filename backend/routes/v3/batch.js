/**
 * API v3: Batch Operations Routes
 * Handles batch operations for Space Manager
 * Based on ADR-004: Space Manager XL Modal
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     BatchOperation:
 *       type: object
 *       properties:
 *         operation:
 *           type: string
 *           enum: [move, duplicate, delete]
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [table, widget, folder]
 *               id:
 *                 type: integer
 */

import express from 'express';
import { dbAll, dbGet, dbRun, toBool, sqlTrue, withTransactionAsync } from '../../database/connection.js';
import { generateBaseId } from '../../utils/baseId.js';
import { apiLogger } from '../../utils/logger.js';
import { checkUserSpaceAccess } from '../../services/SpaceService.js';
import { success, created, error, badRequest, notFound, forbidden, unauthorized } from '../../utils/response.js';

const router = express.Router();

/**
 * Helper: Check space access
 */
async function checkSpaceAccess(spaceId, userId, userRole) {
  const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [spaceId]);
  
  if (!space) {
    return { allowed: false, error: 'Space not found', status: 404 };
  }
  
  // Parse access_control if it's a string
  let accessControl = space.access_control;
  if (typeof accessControl === 'string') {
    try {
      accessControl = JSON.parse(accessControl);
    } catch (e) {
      accessControl = null;
    }
  }
  
  // Use SpaceService to check access (supports members, role mappings, etc.)
  const hasAccess = await checkUserSpaceAccess(userId, userRole, space, accessControl);
  
  if (!hasAccess) {
    return { allowed: false, error: 'Access denied', status: 403 };
  }
  
  return { allowed: true, space };
}

/**
 * Helper: Move item to target project/folder
 */
async function moveItem(type, id, targetProjectId, targetFolderId = null) {
  const tableName = type === 'table' ? 'universal_tables' : 'widgets';
  const projectCol = type === 'table' ? 'project_id' : 'dashboard_id';
  
  // For widgets, we need to find the dashboard for the target project
  if (type === 'widget') {
    const dashboard = await dbGet(
      `SELECT id FROM dashboards WHERE project_id = ? AND is_default = ${sqlTrue()} LIMIT 1`,
      [targetProjectId]
    );
    
    if (!dashboard) {
      throw new Error(`No dashboard found for project ${targetProjectId}`);
    }
    
    await dbRun(
      `UPDATE ${tableName} SET ${projectCol} = ?, folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [dashboard.id, targetFolderId, id]
    );
  } else {
    await dbRun(
      `UPDATE ${tableName} SET project_id = ?, folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [targetProjectId, targetFolderId, id]
    );
  }
  
  return true;
}

/**
 * Helper: Duplicate table
 */
async function duplicateTable(tableId, targetProjectId, newName, includeData = false) {
  // Get source table
  const source = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [tableId]);
  if (!source) throw new Error('Table not found');

  // Get source data before transaction
  const columns = await dbAll('SELECT * FROM table_columns WHERE table_id = ?', [tableId]);
  const rows = includeData ? await dbAll('SELECT * FROM table_rows WHERE table_id = ?', [tableId]) : [];

  // Wrap duplication in transaction for atomicity
  const newTableId = await withTransactionAsync(async (trx) => {
    // Create new table
    const result = await trx.run(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, order_index)
    VALUES (?, ?, ?, ?, 0, 0)
  `, [
    targetProjectId,
    newName || `${source.name} (copy)`,
    source.description,
    source.icon
  ]);
  
    const ntId = result.lastInsertRowid;
  
    // Copy columns
    for (const col of columns) {
      await trx.run(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [ntId, col.column_name, col.display_name, col.type, col.config, col.order_index, col.is_visible, col.is_required, col.is_system]);
  }
  
    // Copy data if requested
    if (includeData) {
      for (const row of rows) {
        const baseId = generateBaseId(targetProjectId, ntId);
        await trx.run(`
          INSERT INTO table_rows (table_id, base_id, data, created_by)
          VALUES (?, ?, ?, ?)
        `, [ntId, baseId, row.data, row.created_by]);
      }
    }

    return ntId;
  });

  return newTableId;
}

/**
 * Helper: Duplicate widget
 */
async function duplicateWidget(widgetId, targetProjectId, newTitle) {
  // Get source widget
  const source = await dbGet('SELECT * FROM widgets WHERE id = ?', [widgetId]);
  if (!source) throw new Error('Widget not found');
  
  // Get dashboard for target project
  let dashboard = await dbGet(
    `SELECT id FROM dashboards WHERE project_id = ? AND is_default = ${sqlTrue()} LIMIT 1`,
    [targetProjectId]
  );
  
  if (!dashboard) {
    // Create default dashboard
    const result = await dbRun(`
      INSERT INTO dashboards (project_id, name, is_default)
      VALUES ($1, 'Main Dashboard', $2)
    `, [targetProjectId, toBool(true)]);
    dashboard = { id: result.lastInsertRowid || result.rows?.[0]?.id };
  }
  
  // Create new widget
  const result = await dbRun(`
    INSERT INTO widgets (dashboard_id, widget_type, preset_name, code, code_version, title, description, icon, config, position, is_visible, order_index, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    dashboard.id,
    source.widget_type,
    source.preset_name,
    source.code,
    source.code_version,
    newTitle || `${source.title} (copy)`,
    source.description,
    source.icon,
    source.config,
    source.position,
    source.is_visible,
    source.order_index,
    source.created_by
  ]);
  
  return result.lastInsertRowid;
}

/**
 * Helper: Duplicate project
 */
async function duplicateProject(projectId, spaceId, newName, userId) {
  // Get source project
  const source = await dbGet('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!source) throw new Error('Project not found');
  
  // Create project + dashboard in transaction
  const newProjectId = await withTransactionAsync(async (trx) => {
    const result = await trx.run(`
    INSERT INTO projects (space_id, name, description, icon, type, owner_id, theme_primary, theme_secondary, theme_tertiary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    spaceId,
    newName || `${source.name} (copy)`,
    source.description,
    source.icon,
    source.type,
    userId,
    source.theme_primary,
    source.theme_secondary,
    source.theme_tertiary
  ]);
  
    const npId = result.lastInsertRowid;
  
    // Create default dashboard
    await trx.run(`
      INSERT INTO dashboards (project_id, name, is_default)
      VALUES (?, 'Main Dashboard', ?)
    `, [npId, toBool(true)]);

    return npId;
  });
  
  // Copy tables (structure only by default)
  const tables = await dbAll('SELECT * FROM universal_tables WHERE project_id = ?', [projectId]);
  for (const table of tables) {
    await duplicateTable(table.id, newProjectId, table.name, false);
  }
  
  // Copy widgets
  const dashboard = await dbGet(`SELECT id FROM dashboards WHERE project_id = ? AND is_default = ${sqlTrue()}`, [projectId]);
  if (dashboard) {
    const widgets = await dbAll('SELECT * FROM widgets WHERE dashboard_id = ?', [dashboard.id]);
    for (const widget of widgets) {
      await duplicateWidget(widget.id, newProjectId, widget.title);
    }
  }
  
  return newProjectId;
}

/**
 * POST /api/v3/spaces/:spaceId/batch
 * 
 * Batch operations on space items
 * @swagger
 * /api/v3/spaces/{spaceId}/batch:
 *   post:
 *     summary: Batch operations on space items
 *     tags: [Batch]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: spaceId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [operation, items]
 *             properties:
 *               operation:
 *                 type: string
 *                 enum: [move, duplicate, delete, reorder]
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *               target:
 *                 type: object
 *     responses:
 *       200:
 *         description: Batch operation result
 *
 * @example
 * // Request body:
 * // {
 * //   "operation": "move",  // "move" | "duplicate" | "delete" | "reorder"
 * //   "items": [
 * //     { "type": "table", "id": 123 },
 * //     { "type": "widget", "id": 456 }
 * //   ],
 * //   "target": { "project_id": 10, "folder_id": null }
 * // }
 */
router.post('/spaces/:spaceId/batch', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { operation, items, target, options = {} } = req.body;
    
    // Validate operation
    const validOperations = ['move', 'duplicate', 'delete', 'reorder'];
    if (!validOperations.includes(operation)) {
      return badRequest(res, `Operation must be one of: ${validOperations.join(', ')}`, 'INVALID_OPERATION');
    }
    
    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return badRequest(res, 'Items array is required and must not be empty', 'INVALID_ITEMS');
    }
    
    // Check space access
    const access = await checkSpaceAccess(spaceId, req.user.id, req.user.role);
    if (!access.allowed) {
      return access.status === 404 
        ? notFound(res, access.error, 'ACCESS_DENIED')
        : forbidden(res, access.error, 'ACCESS_DENIED');
    }
    
    // Process items
    const results = { success: [], failed: [] };
    
    for (const item of items) {
      try {
        const { type, id } = item;
        
        switch (operation) {
          case 'move':
            if (!target?.project_id) {
              throw new Error('target.project_id is required for move operation');
            }
            
            if (type === 'table' || type === 'widget') {
              await moveItem(type, id, target.project_id, target.folder_id);
              results.success.push({ type, id, action: 'moved' });
            } else if (type === 'folder') {
              // Move folder to different project
              await dbRun(
                'UPDATE folders SET project_id = ?, parent_folder_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [target.project_id, id]
              );
              results.success.push({ type, id, action: 'moved' });
            } else {
              throw new Error(`Cannot move items of type: ${type}`);
            }
            break;
            
          case 'duplicate': {
            let newId;
            if (type === 'table') {
              newId = await duplicateTable(id, target?.project_id || (await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [id]))?.project_id, options.newName, options.includeData);
            } else if (type === 'widget') {
              const widget = await dbGet('SELECT w.*, d.project_id FROM widgets w JOIN dashboards d ON w.dashboard_id = d.id WHERE w.id = ?', [id]);
              newId = await duplicateWidget(id, target?.project_id || widget?.project_id, options.newTitle);
            } else if (type === 'project') {
              newId = await duplicateProject(id, spaceId, options.newName, req.user.id);
            } else {
              throw new Error(`Cannot duplicate items of type: ${type}`);
            }
            results.success.push({ type, id, action: 'duplicated', newId });
            break;
          }
            
          case 'delete':
            if (type === 'table') {
              await dbRun('DELETE FROM universal_tables WHERE id = ?', [id]);
            } else if (type === 'widget') {
              await dbRun('DELETE FROM widgets WHERE id = ?', [id]);
            } else if (type === 'folder') {
              await dbRun('DELETE FROM folders WHERE id = ?', [id]);
            } else if (type === 'project') {
              await dbRun('DELETE FROM projects WHERE id = ?', [id]);
            } else {
              throw new Error(`Cannot delete items of type: ${type}`);
            }
            results.success.push({ type, id, action: 'deleted' });
            break;
            
          case 'reorder': {
            const orderIndex = item.order_index ?? 0;
            if (type === 'table') {
              await dbRun('UPDATE universal_tables SET order_index = ? WHERE id = ?', [orderIndex, id]);
            } else if (type === 'widget') {
              await dbRun('UPDATE widgets SET order_index = ? WHERE id = ?', [orderIndex, id]);
            } else if (type === 'folder') {
              await dbRun('UPDATE folders SET order_index = ? WHERE id = ?', [orderIndex, id]);
            } else if (type === 'project') {
              await dbRun('UPDATE projects SET order_index = ? WHERE id = ?', [orderIndex, id]);
            }
            results.success.push({ type, id, action: 'reordered', order_index: orderIndex });
            break;
          }
        }
      } catch (err) {
        results.failed.push({ item, error: err.message });
      }
    }
    
    success(res, results);
  } catch (err) {
    apiLogger.error('POST /spaces/:spaceId/batch error:', err);
    error(res, err.message, 'BATCH_ERROR');
  }
});

/**
 * GET /api/v3/spaces/:spaceId/tree
 * Get full tree structure of space
 * @swagger
 * /api/v3/spaces/{spaceId}/tree:
 *   get:
 *     summary: Get full tree structure of space
 *     tags: [Batch]
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
 *         description: Space tree structure
 */
router.get('/spaces/:spaceId/tree', async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    // Check access
    const access = await checkSpaceAccess(spaceId, req.user.id, req.user.role);
    if (!access.allowed) {
      return access.status === 404 
        ? notFound(res, access.error, 'ACCESS_DENIED')
        : forbidden(res, access.error, 'ACCESS_DENIED');
    }
    
    // Get all projects in space
    const projects = await dbAll(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM universal_tables WHERE project_id = p.id) as tables_count,
        (SELECT COUNT(*) FROM widgets w JOIN dashboards d ON w.dashboard_id = d.id WHERE d.project_id = p.id) as widgets_count
      FROM projects p
      WHERE p.space_id = ?
      ORDER BY p.order_index ASC, p.created_at ASC
    `, [spaceId]);
    
    // Build tree for each project
    const tree = await Promise.all(projects.map(async (project) => {
      // Get folders
      const folders = await dbAll(`
        SELECT * FROM folders WHERE project_id = ? ORDER BY order_index ASC
      `, [project.id]);
      
      // Get tables with full info
      const tables = await dbAll(`
        SELECT id, name, display_name, icon, description, folder_id, order_index, is_system, 
               sync_target, data_source_id, created_at
        FROM universal_tables WHERE project_id = ?
        ORDER BY order_index ASC, name ASC
      `, [project.id]);
      
      // Get widgets
      const dashboard = await dbGet(
        `SELECT id FROM dashboards WHERE project_id = ? AND is_default = ${sqlTrue()}`,
        [project.id]
      );
      
      const rawWidgets = dashboard ? await dbAll(`
        SELECT id, title as name, icon, description, folder_id, order_index, created_at, config
        FROM widgets WHERE dashboard_id = ?
        ORDER BY order_index ASC
      `, [dashboard.id]) : [];
      
      // Parse widget configs to extract main_table_id
      const widgets = rawWidgets.map(w => {
        let mainTableId = null;
        if (w.config) {
          try {
            const config = typeof w.config === 'string' ? JSON.parse(w.config) : w.config;
            mainTableId = config.tableId || config.table_id || null;
          } catch (e) {
            // ignore parse errors
          }
        }
        return { ...w, main_table_id: mainTableId };
      });
      
      // Categorize tables like left sidebar
      // 1. Regular tables (with show_in_nav or user-facing)
      // 2. Internal - internal tables without sync (non-form tables)
      // 3. External - tables from external databases
      const formTables = tables.filter(t => t.name.startsWith('form_'));
      const internalTables = tables.filter(t => 
        !t.name.startsWith('form_') && !t.sync_target && !t.data_source_id
      );
      const syncedTables = tables.filter(t => t.sync_target);
      const externalTables = tables.filter(t => t.data_source_id);
      
      // Helper to create table node
      const createTableNode = (t) => ({
        id: `table:${t.id}`,
        type: 'table',
        name: t.display_name || t.name,
        icon: t.icon || '📋',
        data: { ...t, description: t.description },
        children: []
      });
      
      // Helper to create widget node
      const createWidgetNode = (w) => ({
        id: `widget:${w.id}`,
        type: 'widget',
        name: w.name,
        icon: w.icon || '🧩',
        data: { ...w, description: w.description, main_table_id: w.main_table_id },
        children: []
      });
      
      // Build folder tree with contents
      const buildFolderTree = (parentId = null) => {
        return folders
          .filter(f => f.parent_folder_id === parentId)
          .map(folder => ({
            id: `folder:${folder.id}`,
            type: 'folder',
            name: folder.name,
            icon: folder.icon || '📁',
            data: folder,
            children: [
              ...buildFolderTree(folder.id),
              ...tables
                .filter(t => t.folder_id === folder.id)
                .map(createTableNode),
              ...widgets
                .filter(w => w.folder_id === folder.id)
                .map(createWidgetNode)
            ]
          }));
      };
      
      // Build organized project structure
      const projectChildren = [];
      
      // 1. User folders first
      projectChildren.push(...buildFolderTree(null));
      
      // 2. Widgets at root level (visible items)
      const rootWidgets = widgets.filter(w => !w.folder_id);
      if (rootWidgets.length > 0) {
        rootWidgets.forEach(w => projectChildren.push(createWidgetNode(w)));
      }
      
      // 3. Data & Processing folder (virtual)
      const hasDataTables = internalTables.length > 0 || syncedTables.length > 0 || 
                            externalTables.length > 0 || formTables.length > 0;
      
      if (hasDataTables) {
        const dataProcessingChildren = [];
        
        // Internal tables subfolder
        if (internalTables.filter(t => !t.folder_id).length > 0) {
          dataProcessingChildren.push({
            id: `virtual:internal:${project.id}`,
            type: 'folder',
            name: `Internal`,
            icon: '🗄️',
            data: { virtual: true, count: internalTables.filter(t => !t.folder_id).length },
            children: internalTables.filter(t => !t.folder_id).map(createTableNode)
          });
        }
        
        // Synced tables subfolder
        if (syncedTables.filter(t => !t.folder_id).length > 0) {
          dataProcessingChildren.push({
            id: `virtual:synced:${project.id}`,
            type: 'folder',
            name: `Synced`,
            icon: '🔄',
            data: { virtual: true, count: syncedTables.filter(t => !t.folder_id).length },
            children: syncedTables.filter(t => !t.folder_id).map(createTableNode)
          });
        }
        
        // External tables subfolder
        if (externalTables.filter(t => !t.folder_id).length > 0) {
          dataProcessingChildren.push({
            id: `virtual:external:${project.id}`,
            type: 'folder',
            name: `External`,
            icon: '🌐',
            data: { virtual: true, count: externalTables.filter(t => !t.folder_id).length },
            children: externalTables.filter(t => !t.folder_id).map(createTableNode)
          });
        }
        
        // Form tables subfolder
        if (formTables.filter(t => !t.folder_id).length > 0) {
          dataProcessingChildren.push({
            id: `virtual:forms:${project.id}`,
            type: 'folder',
            name: `Forms`,
            icon: '📝',
            data: { virtual: true, count: formTables.filter(t => !t.folder_id).length },
            children: formTables.filter(t => !t.folder_id).map(createTableNode)
          });
        }
        
        if (dataProcessingChildren.length > 0) {
          projectChildren.push({
            id: `virtual:databases:${project.id}`,
            type: 'folder',
            name: `DATABASES`,
            icon: '🗂️',
            data: { 
              virtual: true, 
              count: internalTables.length + syncedTables.length + externalTables.length + formTables.length 
            },
            children: dataProcessingChildren
          });
        }
      }
      
      return {
        id: `project:${project.id}`,
        type: 'project',
        name: project.name,
        icon: project.icon || '📊',
        data: { ...project, description: project.description },
        children: projectChildren
      };
    }));
    
    success(res, tree);
  } catch (err) {
    apiLogger.error('GET /spaces/:spaceId/tree error:', err);
    error(res, err.message, 'FETCH_ERROR');
  }
});

export default router;
