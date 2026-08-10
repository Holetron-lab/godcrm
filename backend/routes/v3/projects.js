// API v3: Projects Routes
import express from 'express';
import { dbAll } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, notFound, badRequest, forbidden, error } from '../../utils/response.js';

/**
 * @swagger
 * components:
 *   schemas:
 *     Project:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         space_id:
 *           type: integer
 *         owner_id:
 *           type: integer
 *         name:
 *           type: string
 *         description:
 *           type: string
 *           nullable: true
 *         icon:
 *           type: string
 *         type:
 *           type: string
 *           enum: [project, system_data, ai_agents, personal, team]
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

const router = express.Router();

/**
 * @swagger
 * /projects:
 *   get:
 *     tags: [Projects]
 *     summary: Get all projects
 *     description: Get all projects for authenticated user, optionally filtered by space_id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: space_id
 *         schema:
 *           type: integer
 *         description: Filter by space ID
 *     responses:
 *       200:
 *         description: List of projects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Project'
 *       401:
 *         description: Unauthorized
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { space_id } = req.query;
    
    // Admin/owner can see all projects EXCEPT personal spaces of other users
    // Personal spaces are always private and only visible to owner
    // Regular users can see: own projects + projects in spaces they have access to
    let whereClause;
    let params;

    if (userRole === 'admin' || userRole === 'owner') {
      // System admin/owner: see all projects, but only own personal space
      whereClause = '(s.type != ? OR (s.type = ? AND p.owner_id = ?))';
      params = ['personal', 'personal', userId];
    } else {
      // Regular user: own projects + projects in accessible spaces
      // Use SpaceService to resolve space-level access (supports table-based access control)
      const { getSpacesByUser } = await import('../../services/SpaceService.js');
      const accessibleSpaces = await getSpacesByUser(userId, userRole);
      // getSpacesByUser already handles personal space gating via checkUserSpaceAccess
      // (explicit grants in user_access_permissions are checked before the personal-space gate)
      const accessibleSpaceIds = accessibleSpaces.map(s => s.id);

      if (accessibleSpaceIds.length > 0) {
        const placeholders = accessibleSpaceIds.map(() => '?').join(',');
        whereClause = `(p.owner_id = ? OR p.space_id IN (${placeholders}))`;
        params = [userId, ...accessibleSpaceIds];
      } else {
        whereClause = 'p.owner_id = ?';
        params = [userId];
      }
    }
    
    // Add space_id filter if provided
    if (space_id) {
      whereClause += ' AND p.space_id = ?';
      params.push(space_id);
    }
    
    const projects = await dbAll(`
      SELECT 
        p.*,
        s.name as space_name,
        s.type as space_type
      FROM projects p
      LEFT JOIN spaces s ON p.space_id = s.id
      WHERE ${whereClause}
      ORDER BY s.type ASC, p.created_at DESC
    `, params);

    success(res, projects);
  } catch (err) {
    apiLogger.error('Error fetching projects:', err);
    error(res, 'FETCH_ERROR', err.message, 500);
  }
});

/**
 * @swagger
 * /projects:
 *   post:
 *     tags: [Projects]
 *     summary: Create new project
 *     security:
 *       - bearerAuth: []
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
 *               description:
 *                 type: string
 *               icon:
 *                 type: string
 *               space_id:
 *                 type: integer
 *               type:
 *                 type: string
 *                 enum: [project, system_data, ai_agents, personal, team]
 *     responses:
 *       201:
 *         description: Project created
 *       400:
 *         description: Validation error
 */
router.post('/', async (req, res) => {
  try {
    const { name, description, icon, logo, space_id, type } = req.body;
    const userId = req.user.id;

    // Validation
    if (!name || !name.trim()) {
      return badRequest(res, 'name is required');
    }

    // If no space_id provided, use Personal Space
    let finalSpaceId = space_id;
    if (!finalSpaceId) {
      const [personalSpace] = await dbAll(
        "SELECT id FROM spaces WHERE owner_id = ? AND type = 'personal' LIMIT 1",
        [userId]
      );
      finalSpaceId = personalSpace?.id;
    }

    if (!finalSpaceId) {
      return badRequest(res, 'No space available for project creation');
    }

    // Allowed project types
    const allowedTypes = ['project', 'system_data', 'ai_agents', 'personal', 'team'];
    const projectType = allowedTypes.includes(type) ? type : 'project';

    const { dbRun } = await import('../../database/connection.js');
    const result = await dbRun(
      `INSERT INTO projects (space_id, owner_id, name, description, icon, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [finalSpaceId, userId, name.trim(), description?.trim() || null, icon || logo || '📁', projectType]
    );

    // Fetch created project
    const [newProject] = await dbAll('SELECT * FROM projects WHERE id = ?', [result.lastID]);

    created(res, newProject);
  } catch (err) {
    apiLogger.error('Error creating project:', err);
    error(res, 'CREATE_ERROR', err.message, 500);
  }
});

/**
 * @swagger
 * /projects/{id}:
 *   put:
 *     tags: [Projects]
 *     summary: Update project
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *               description:
 *                 type: string
 *               icon:
 *                 type: string
 *     responses:
 *       200:
 *         description: Project updated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Project not found
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, icon, access_control, theme_primary, theme_secondary, theme_tertiary, is_public } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check if project exists and user has permission
    const [project] = await dbAll('SELECT * FROM projects WHERE id = ?', [id]);
    
    if (!project) {
      return notFound(res, 'Project');
    }

    // Only owner or admin can update
    if (project.owner_id !== userId && userRole !== 'admin' && userRole !== 'owner') {
      return forbidden(res, 'You do not have permission to update this project');
    }

    // Build update query
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (icon !== undefined) {
      updates.push('icon = ?');
      params.push(icon);
    }
    if (access_control !== undefined) {
      updates.push('access_control = ?');
      params.push(access_control ? JSON.stringify(access_control) : null);
    }
    if (theme_primary !== undefined) {
      updates.push('theme_primary = ?');
      params.push(theme_primary);
    }
    if (theme_secondary !== undefined) {
      updates.push('theme_secondary = ?');
      params.push(theme_secondary);
    }
    if (theme_tertiary !== undefined) {
      updates.push('theme_tertiary = ?');
      params.push(theme_tertiary);
    }
    if (is_public !== undefined) {
      updates.push('is_public = ?');
      params.push(Boolean(is_public));
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const { dbRun } = await import('../../database/connection.js');
    await dbRun(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, params);

    // Fetch updated project
    const [updatedProject] = await dbAll('SELECT * FROM projects WHERE id = ?', [id]);

    success(res, updatedProject);
  } catch (err) {
    apiLogger.error('Error updating project:', err);
    error(res, 'UPDATE_ERROR', err.message, 500);
  }
});

/**
 * @swagger
 * /projects/{id}:
 *   delete:
 *     tags: [Projects]
 *     summary: Delete project
 *     description: Delete a project (only owner or admin). Cannot delete system projects.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Project deleted
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Project not found
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const projectId = parseInt(req.params.id);

    // Get project
    const projects = await dbAll('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (projects.length === 0) {
      return notFound(res, 'Project');
    }

    const project = projects[0];

    // Only owner or admin can delete
    if (project.owner_id !== userId && userRole !== 'admin' && userRole !== 'owner') {
      return forbidden(res, 'You do not have permission to delete this project');
    }

    // Prevent deleting system projects
    if (project.type === 'admin_owner_space' || project.type === 'personal_space') {
      return forbidden(res, 'Cannot delete system projects');
    }

    const { dbRun } = await import('../../database/connection.js');
    await dbRun('DELETE FROM projects WHERE id = ?', [projectId]);

    success(res, { message: 'Project deleted successfully' });
  } catch (err) {
    apiLogger.error('Error deleting project:', err);
    error(res, 'DELETE_ERROR', err.message, 500);
  }
});

export default router;
