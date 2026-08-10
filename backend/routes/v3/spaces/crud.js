/**
 * Spaces CRUD Routes
 * GET /, POST /, GET /:id, PUT /:id, PATCH /:id, DELETE /:id
 */

import { createSpace, getSpacesByUser, getSpaceById, updateSpace, deleteSpace, checkUserSpaceAccess } from '../../../services/SpaceService.js';
import { getProjectsBySpace, getProjectsBySpaceForUser } from '../../../services/ProjectService.js';
import { getSpaceDashboard } from '../../../services/DashboardService.js';
import { createAIAgentsPack } from '../../../services/AIAgentsPackService.js';
import { createBusinessPack } from '../../../services/BusinessPackService.js';
import { installKanbanPack } from '../../../services/KanbanPackService.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, error, badRequest, notFound } from '../../../utils/response.js';

/**
 * @swagger
 * /spaces:
 *   get:
 *     tags: [Spaces]
 *     summary: Get all spaces for authenticated user
 *     description: Returns all spaces the user has access to (owned or member of)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of spaces
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Space'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /spaces:
 *   post:
 *     tags: [Spaces]
 *     summary: Create new space
 *     description: Creates a new workspace. For 'ai' type, also creates AI Agents pack. For 'business' type, creates Business Pack.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *             properties:
 *               name:
 *                 type: string
 *                 example: "My Workspace"
 *               description:
 *                 type: string
 *               icon:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [personal, business, ai, custom]
 *               theme_primary:
 *                 type: string
 *               theme_secondary:
 *                 type: string
 *               theme_tertiary:
 *                 type: string
 *               settings:
 *                 type: object
 *     responses:
 *       201:
 *         description: Space created successfully
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
 *                     space:
 *                       $ref: '#/components/schemas/Space'
 *                     default_dashboard:
 *                       type: object
 *                     ai_agents_pack:
 *                       type: object
 *                       nullable: true
 *                     business_pack:
 *                       type: object
 *                       nullable: true
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /spaces/{id}:
 *   get:
 *     tags: [Spaces]
 *     summary: Get space by ID
 *     description: Returns space with its projects and dashboard. Checks user access permissions.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Space ID
 *     responses:
 *       200:
 *         description: Space with projects and dashboard
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
 *                     space:
 *                       $ref: '#/components/schemas/Space'
 *                     projects:
 *                       type: array
 *                       items:
 *                         type: object
 *                     dashboard:
 *                       type: object
 *       403:
 *         description: Forbidden - no access to this space
 *       404:
 *         description: Space not found
 */

/**
 * @swagger
 * /spaces/{id}:
 *   put:
 *     tags: [Spaces]
 *     summary: Update space
 *     description: Updates space properties. Only owner or admin can update. Cannot change space type.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Space ID
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
 *               theme_primary:
 *                 type: string
 *               theme_secondary:
 *                 type: string
 *               theme_tertiary:
 *                 type: string
 *               settings:
 *                 type: object
 *               access_control:
 *                 type: string
 *                 enum: [roles, members]
 *     responses:
 *       200:
 *         description: Space updated
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Space not found
 */

/**
 * @swagger
 * /spaces/{id}:
 *   delete:
 *     tags: [Spaces]
 *     summary: Delete space
 *     description: Deletes space with CASCADE delete of all projects, tables, and dashboards. Only owner or admin can delete.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Space ID
 *     responses:
 *       200:
 *         description: Space deleted
 *       403:
 *         description: Forbidden - only owner or admin can delete
 *       404:
 *         description: Space not found
 */

export default function registerCrudRoutes(router) {
  router.get('/', async (req, res) => {
    try {
      const spaces = await getSpacesByUser(req.user.id, req.user.role);
      success(res, spaces);
    } catch (err) {
      apiLogger.error('Error fetching spaces:', err);
      error(res, 'FETCH_ERROR', err.message, 500);
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { name, description, icon, type, theme_primary, theme_secondary, theme_tertiary, settings } = req.body;

      // Validation
      if (!name) {
        return badRequest(res, 'name is required', 'VALIDATION_ERROR');
      }

      if (!type) {
        return badRequest(res, 'type is required', 'VALIDATION_ERROR');
      }

      const space = await createSpace({
        owner_id: req.user.id,
        name,
        description,
        icon,
        type,
        theme_primary,
        theme_secondary,
        theme_tertiary,
        settings
      });

      // If AI type, create AI Agents pack
      let aiAgentsPack = null;
      if (type === 'ai') {
        try {
          aiAgentsPack = await createAIAgentsPack(space.id, req.user.id);
          apiLogger.info(`AI Agents pack created for space ${space.id}:`, aiAgentsPack);
        } catch (packError) {
          apiLogger.error('Error creating AI Agents pack:', packError);
          // Don't fail space creation if pack fails
        }
      }

      // If Business type, create Business Pack
      let businessPack = null;
      if (type === 'business') {
        try {
          businessPack = await createBusinessPack(space.id, req.user.id);
          apiLogger.info(`Business pack created for space ${space.id}:`, businessPack);
        } catch (packError) {
          apiLogger.error('Error creating Business pack:', packError);
          // Don't fail space creation if pack fails
        }
      }

      // If Kanban type, create Kanban Pack
      let kanbanPack = null;
      if (type === 'kanban') {
        try {
          kanbanPack = await installKanbanPack(space.id, req.user.id);
          apiLogger.info(`Kanban pack created for space ${space.id}:`, kanbanPack);
        } catch (packError) {
          apiLogger.error('Error creating Kanban pack:', packError);
          // Don't fail space creation if pack fails
        }
      }

      // Get default dashboard
      const dashboard = await getSpaceDashboard(space.id);

      created(res, {
        space,
        default_dashboard: dashboard,
        ai_agents_pack: aiAgentsPack,
        business_pack: businessPack,
        kanban_pack: kanbanPack
      });
    } catch (err) {
      apiLogger.error('Error creating space:', err);

      if (err.message.includes('Invalid space type')) {
        return badRequest(res, err.message, 'VALIDATION_ERROR');
      }

      error(res, 'CREATE_ERROR', err.message, 500);
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);

      const space = await getSpaceById(spaceId);

      if (!space) {
        return notFound(res, 'Space');
      }

      // Check access using SpaceService (supports roles mode and members mode)
      const hasAccess = await checkUserSpaceAccess(req.user.id, req.user.role, space, space.access_control);

      if (!hasAccess) {
        return error(res, 'FORBIDDEN', 'You are not authorized to access this space', 403);
      }

      // Get projects in space filtered by user's granular access
      const isOwner = space.owner_id === req.user.id;
      const isSysAdmin = req.user.role === 'admin' || req.user.role === 'owner';

      // Owner and sys admins see all projects, others see filtered
      const projects = (isOwner || isSysAdmin)
        ? await getProjectsBySpace(spaceId)
        : await getProjectsBySpaceForUser(spaceId, req.user.id, space.access_control, space.owner_id);

      // Get space dashboard
      const dashboard = await getSpaceDashboard(spaceId);

      success(res, {
        space,
        projects,
        dashboard
      });
    } catch (err) {
      apiLogger.error('Error fetching space:', err);
      error(res, 'FETCH_ERROR', err.message, 500);
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);
      const { name, description, icon, type, theme_primary, theme_secondary, theme_tertiary, settings, access_control, tickets_config, files_config } = req.body;

      const space = await getSpaceById(spaceId);

      if (!space) {
        return notFound(res, 'Space');
      }

      // Check access using SpaceService - only owner and admins can update
      const isOwner = space.owner_id === req.user.id;
      const isSysAdmin = req.user.role === 'admin' || req.user.role === 'owner';
      const hasAccess = await checkUserSpaceAccess(req.user.id, req.user.role, space, space.access_control);

      if (!isOwner && !isSysAdmin && !hasAccess) {
        return error(res, 'FORBIDDEN', 'You are not authorized to update this space', 403);
      }

      // Prevent changing type
      if (type && type !== space.type) {
        return badRequest(res, 'Cannot change space type. Delete and recreate instead.', 'VALIDATION_ERROR');
      }

      const updated = await updateSpace(spaceId, {
        name,
        description,
        icon,
        theme_primary,
        theme_secondary,
        theme_tertiary,
        settings,
        access_control,
        tickets_config,
        files_config
      });

      success(res, updated);
    } catch (err) {
      apiLogger.error('Error updating space:', err);
      error(res, 'UPDATE_ERROR', err.message, 500);
    }
  });

  // PATCH alias — frontend uses apiClient.patch() for partial updates (e.g. tickets_config)
  router.patch('/:id', async (req, res) => {
    try {
      apiLogger.info({ body: req.body, params: req.params }, 'PATCH /spaces/:id received');
      const spaceId = parseInt(req.params.id);
      const space = await getSpaceById(spaceId);
      if (!space) return notFound(res, 'Space');

      const isOwner = space.owner_id === req.user.id;
      const isSysAdmin = req.user.role === 'admin' || req.user.role === 'owner';
      const hasAccess = await checkUserSpaceAccess(req.user.id, req.user.role, space, space.access_control);
      if (!isOwner && !isSysAdmin && !hasAccess) {
        return error(res, 'FORBIDDEN', 'You are not authorized to update this space', 403);
      }

      const updated = await updateSpace(spaceId, req.body);
      success(res, updated);
    } catch (err) {
      apiLogger.error('Error patching space:', err);
      error(res, 'UPDATE_ERROR', err.message, 500);
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);

      const space = await getSpaceById(spaceId);

      if (!space) {
        return notFound(res, 'Space');
      }

      // Only owner or system admin can delete space
      const isOwner = space.owner_id === req.user.id;
      const isSysAdmin = req.user.role === 'admin' || req.user.role === 'owner';

      if (!isOwner && !isSysAdmin) {
        return error(res, 'FORBIDDEN', 'You are not authorized to delete this space', 403);
      }

      await deleteSpace(spaceId);

      success(res, { message: 'Space deleted successfully' });
    } catch (err) {
      apiLogger.error('Error deleting space:', err);
      error(res, 'DELETE_ERROR', err.message, 500);
    }
  });
}
