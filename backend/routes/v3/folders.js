/**
 * API v3: Folders Routes
 * Handles CRUD operations for Folders within Projects
 * Based on ADR-004: Space Manager XL Modal
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Folder:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         project_id:
 *           type: integer
 *         name:
 *           type: string
 *         icon:
 *           type: string
 *         color:
 *           type: string
 *         parent_folder_id:
 *           type: integer
 *         order_index:
 *           type: integer
 */

import express from 'express';
import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound, forbidden } from '../../utils/response.js';

const router = express.Router();

/**
 * Helper: Build folder tree from flat list
 */
function buildFolderTree(folders, parentId = null) {
  return folders
    .filter(f => f.parent_folder_id === parentId)
    .sort((a, b) => a.order_index - b.order_index)
    .map(folder => ({
      ...folder,
      children: buildFolderTree(folders, folder.id)
    }));
}

/**
 * Helper: Check if user has access to project
 */
async function checkProjectAccess(projectId, userId, userRole) {
  const project = await dbGet(`
    SELECT p.*, s.owner_id as space_owner_id
    FROM projects p
    LEFT JOIN spaces s ON p.space_id = s.id
    WHERE p.id = ?
  `, [projectId]);
  
  if (!project) {
    return { allowed: false, error: 'Project not found', status: 404 };
  }
  
  // Check access: owner, admin, or project owner
  const isOwner = project.owner_id === userId || project.space_owner_id === userId;
  const isAdmin = userRole === 'admin' || userRole === 'owner';
  
  if (!isOwner && !isAdmin) {
    return { allowed: false, error: 'Access denied', status: 403 };
  }
  
  return { allowed: true, project };
}

/**
 * GET /api/v3/projects/:projectId/folders
 * List all folders in project with tree structure
 * @swagger
 * /api/v3/projects/{projectId}/folders:
 *   get:
 *     summary: List all folders in project
 *     tags: [Folders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: flat
 *         schema:
 *           type: boolean
 *         description: Return flat list instead of tree
 *     responses:
 *       200:
 *         description: List of folders
 */
router.get('/projects/:projectId/folders', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { flat } = req.query; // ?flat=true returns flat list
    
    // Verify access
    const access = await checkProjectAccess(projectId, req.user.id, req.user.role);
    if (!access.allowed) {
      return access.status === 404 ? notFound(res, access.error) : forbidden(res, access.error);
    }
    
    // Get all folders in project
    const folders = await dbAll(`
      SELECT * FROM folders 
      WHERE project_id = ?
      ORDER BY order_index ASC, name ASC
    `, [projectId]);
    
    // Return flat list or tree
    const data = flat === 'true' ? folders : buildFolderTree(folders);
    
    success(res, data);
  } catch (err) {
    apiLogger.error('GET /projects/:projectId/folders error:', err);
    error(res, err.message);
  }
});

/**
 * POST /api/v3/projects/:projectId/folders
 * Create new folder
 * @swagger
 * /api/v3/projects/{projectId}/folders:
 *   post:
 *     summary: Create new folder
 *     tags: [Folders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               icon:
 *                 type: string
 *               color:
 *                 type: string
 *               parent_folder_id:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Folder created
 */
router.post('/projects/:projectId/folders', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, icon = '📁', color, parent_folder_id } = req.body;
    
    // Validate name
    if (!name?.trim()) {
      return badRequest(res, 'Folder name is required');
    }
    
    // Verify access
    const access = await checkProjectAccess(projectId, req.user.id, req.user.role);
    if (!access.allowed) {
      return access.status === 404 ? notFound(res, access.error) : forbidden(res, access.error);
    }
    
    // If parent_folder_id provided, verify it exists in same project
    if (parent_folder_id) {
      const parentFolder = await dbGet(
        'SELECT id FROM folders WHERE id = ? AND project_id = ?',
        [parent_folder_id, projectId]
      );
      if (!parentFolder) {
        return badRequest(res, 'Parent folder not found in this project');
      }
    }
    
    // Get next order_index
    const maxOrder = await dbGet(`
      SELECT MAX(order_index) as max_order 
      FROM folders 
      WHERE project_id = ? AND COALESCE(parent_folder_id, 0) = COALESCE(?, 0)
    `, [projectId, parent_folder_id]);
    const nextOrder = (maxOrder?.max_order ?? -1) + 1;
    
    // Create folder
    const result = await dbRun(`
      INSERT INTO folders (project_id, parent_folder_id, name, icon, color, order_index)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [projectId, parent_folder_id || null, name.trim(), icon, color, nextOrder]);
    
    // Get created folder
    const folder = await dbGet('SELECT * FROM folders WHERE id = ?', [result.lastInsertRowid]);
    
    created(res, folder);
  } catch (err) {
    apiLogger.error('POST /projects/:projectId/folders error:', err);
    
    // Handle unique constraint violation
    if (err.message?.includes('UNIQUE constraint failed')) {
      return badRequest(res, 'A folder with this name already exists in the same location');
    }
    
    error(res, err.message);
  }
});

/**
 * GET /api/v3/folders/:folderId
 * Get single folder by ID
 * @swagger
 * /api/v3/folders/{folderId}:
 *   get:
 *     summary: Get single folder by ID
 *     tags: [Folders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Folder details with contents
 *       404:
 *         description: Folder not found
 */
router.get('/folders/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    
    const folder = await dbGet(`
      SELECT f.*, p.space_id
      FROM folders f
      JOIN projects p ON f.project_id = p.id
      WHERE f.id = ?
    `, [folderId]);
    
    if (!folder) {
      return notFound(res, 'Folder not found');
    }
    
    // Verify access
    const access = await checkProjectAccess(folder.project_id, req.user.id, req.user.role);
    if (!access.allowed) {
      return access.status === 404 ? notFound(res, access.error) : forbidden(res, access.error);
    }
    
    // Get folder contents
    const [tables, widgets, subfolders] = await Promise.all([
      dbAll('SELECT id, name, icon FROM universal_tables WHERE folder_id = ?', [folderId]),
      dbAll('SELECT id, title as name, icon FROM widgets WHERE folder_id = ?', [folderId]),
      dbAll('SELECT * FROM folders WHERE parent_folder_id = ? ORDER BY order_index', [folderId])
    ]);
    
    success(res, {
      ...folder,
      contents: { tables, widgets, subfolders }
    });
  } catch (err) {
    apiLogger.error('GET /folders/:folderId error:', err);
    error(res, err.message);
  }
});

/**
 * PUT /api/v3/folders/:folderId
 * Update folder
 * @swagger
 * /api/v3/folders/{folderId}:
 *   put:
 *     summary: Update folder
 *     tags: [Folders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               icon:
 *                 type: string
 *               color:
 *                 type: string
 *     responses:
 *       200:
 *         description: Folder updated
 */
router.put('/folders/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    const { name, icon, color, order_index, parent_folder_id } = req.body;
    
    // Get folder
    const folder = await dbGet('SELECT * FROM folders WHERE id = ?', [folderId]);
    if (!folder) {
      return notFound(res, 'Folder not found');
    }
    
    // Verify access
    const access = await checkProjectAccess(folder.project_id, req.user.id, req.user.role);
    if (!access.allowed) {
      return access.status === 404 ? notFound(res, access.error) : forbidden(res, access.error);
    }
    
    // Prevent moving folder to itself or its descendants
    if (parent_folder_id !== undefined && parent_folder_id !== folder.parent_folder_id) {
      if (parent_folder_id === folder.id) {
        return badRequest(res, 'Cannot move folder into itself');
      }
      
      // Check for circular reference
      let checkId = parent_folder_id;
      while (checkId) {
        if (checkId === folder.id) {
          return badRequest(res, 'Cannot move folder into its descendant');
        }
        const parent = await dbGet('SELECT parent_folder_id FROM folders WHERE id = ?', [checkId]);
        checkId = parent?.parent_folder_id;
      }
    }
    
    // Build update query
    const updates = [];
    const params = [];
    
    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (icon !== undefined) { updates.push('icon = ?'); params.push(icon); }
    if (color !== undefined) { updates.push('color = ?'); params.push(color); }
    if (order_index !== undefined) { updates.push('order_index = ?'); params.push(order_index); }
    if (parent_folder_id !== undefined) { updates.push('parent_folder_id = ?'); params.push(parent_folder_id); }
    
    if (updates.length === 0) {
      return success(res, folder);
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(folderId);
    
    await dbRun(`UPDATE folders SET ${updates.join(', ')} WHERE id = ?`, params);
    
    // Get updated folder
    const updated = await dbGet('SELECT * FROM folders WHERE id = ?', [folderId]);
    
    success(res, updated);
  } catch (err) {
    apiLogger.error('PUT /folders/:folderId error:', err);
    
    if (err.message?.includes('UNIQUE constraint failed')) {
      return badRequest(res, 'A folder with this name already exists in the same location');
    }
    
    error(res, err.message);
  }
});

/**
 * DELETE /api/v3/folders/:folderId
 * Delete folder (move contents to parent)
 * @swagger
 * /api/v3/folders/{folderId}:
 *   delete:
 *     summary: Delete folder
 *     tags: [Folders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: cascade
 *         schema:
 *           type: boolean
 *         description: Delete contents too
 *     responses:
 *       200:
 *         description: Folder deleted
 *       404:
 *         description: Folder not found
 */
router.delete('/folders/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    const { cascade = 'false' } = req.query; // ?cascade=true deletes contents
    
    // Get folder
    const folder = await dbGet('SELECT * FROM folders WHERE id = ?', [folderId]);
    if (!folder) {
      return notFound(res, 'Folder not found');
    }
    
    // Verify access
    const access = await checkProjectAccess(folder.project_id, req.user.id, req.user.role);
    if (!access.allowed) {
      return access.status === 404 ? notFound(res, access.error) : forbidden(res, access.error);
    }
    
    if (cascade === 'true') {
      // Delete folder and all contents
      // Due to CASCADE, subfolders will be deleted automatically
      // But tables/widgets just lose folder_id reference (ON DELETE SET NULL)
      await dbRun('DELETE FROM folders WHERE id = ?', [folderId]);
    } else {
      // Move contents to parent folder
      const parentId = folder.parent_folder_id;
      
      // Move subfolders
      await dbRun(
        'UPDATE folders SET parent_folder_id = ? WHERE parent_folder_id = ?',
        [parentId, folderId]
      );
      
      // Move tables
      await dbRun(
        'UPDATE universal_tables SET folder_id = ? WHERE folder_id = ?',
        [parentId, folderId]
      );
      
      // Move widgets
      await dbRun(
        'UPDATE widgets SET folder_id = ? WHERE folder_id = ?',
        [parentId, folderId]
      );
      
      // Delete empty folder
      await dbRun('DELETE FROM folders WHERE id = ?', [folderId]);
    }
    
    success(res, { message: 'Folder deleted' });
  } catch (err) {
    apiLogger.error('DELETE /folders/:folderId error:', err);
    error(res, err.message);
  }
});

export default router;
