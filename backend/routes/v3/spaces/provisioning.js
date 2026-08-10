/**
 * Spaces Provisioning Routes
 * POST /:id/data-sources-project, POST /:id/users-table,
 * POST /:id/roles-table, POST /:id/variables-table, POST /:id/kanban-pack
 */

import { getSpaceById } from '../../../services/SpaceService.js';
import { getOrCreateDataSourcesProject, getOrCreateUsersTable, getOrCreateRolesTable, getOrCreateVariablesTable } from '../../../services/BusinessPackService.js';
import { installKanbanPack } from '../../../services/KanbanPackService.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, notFound } from '../../../utils/response.js';

/**
 * @swagger
 * /spaces/{id}/data-sources-project:
 *   post:
 *     tags: [Spaces]
 *     summary: Get or create Data Sources project
 *     description: Creates or retrieves the "Источники данных" project for a space
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
 *         description: Data sources project
 *       404:
 *         description: Space not found
 */

/**
 * @swagger
 * /spaces/{id}/users-table:
 *   post:
 *     tags: [Spaces]
 *     summary: Get or create Users table
 *     description: Creates or retrieves the Users table in Data Sources project
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
 *         description: Users table info
 *       404:
 *         description: Space not found
 */

/**
 * @swagger
 * /spaces/{id}/roles-table:
 *   post:
 *     tags: [Spaces]
 *     summary: Get or create Roles table
 *     description: Creates or retrieves the Roles table in Data Sources project
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
 *         description: Roles table info
 *       404:
 *         description: Space not found
 */

/**
 * @swagger
 * /spaces/{id}/variables-table:
 *   post:
 *     tags: [Spaces]
 *     summary: Get or create Variables table
 *     description: Creates or retrieves the Variables table in System Data project (ADR-026)
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
 *         description: Variables table info
 *       404:
 *         description: Space not found
 */

/**
 * @swagger
 * /spaces/{id}/kanban-pack:
 *   post:
 *     tags: [Spaces]
 *     summary: Install Kanban Pack
 *     description: Installs Kanban/Tickets pack (7 tables, 3 projects) into an existing space. Idempotent.
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
 *         description: Kanban pack installed (or already exists)
 *       404:
 *         description: Space not found
 */

export default function registerProvisioningRoutes(router) {
  router.post('/:id/data-sources-project', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);
      const userId = req.user.id;

      const space = await getSpaceById(spaceId);
      if (!space) {
        return notFound(res, 'Space');
      }

      const result = await getOrCreateDataSourcesProject(spaceId, userId);

      success(res, result);
    } catch (err) {
      apiLogger.error('Error creating data sources project:', err);
      error(res, 'CREATE_ERROR', err.message, 500);
    }
  });

  router.post('/:id/users-table', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);
      const userId = req.user.id;

      const space = await getSpaceById(spaceId);
      if (!space) {
        return notFound(res, 'Space');
      }

      const result = await getOrCreateUsersTable(spaceId, userId);

      success(res, result);
    } catch (err) {
      apiLogger.error('Error creating users table:', err);
      error(res, 'CREATE_ERROR', err.message, 500);
    }
  });

  router.post('/:id/roles-table', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);
      const userId = req.user.id;

      const space = await getSpaceById(spaceId);
      if (!space) {
        return notFound(res, 'Space');
      }

      const result = await getOrCreateRolesTable(spaceId, userId);

      success(res, result);
    } catch (err) {
      apiLogger.error('Error creating roles table:', err);
      error(res, 'CREATE_ERROR', err.message, 500);
    }
  });

  router.post('/:id/variables-table', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);
      const userId = req.user.id;

      const space = await getSpaceById(spaceId);
      if (!space) {
        return notFound(res, 'Space');
      }

      const result = await getOrCreateVariablesTable(spaceId, userId);

      success(res, result);
    } catch (err) {
      apiLogger.error('Error creating variables table:', err);
      error(res, 'CREATE_ERROR', err.message, 500);
    }
  });

  router.post('/:id/kanban-pack', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);
      const userId = req.user.id;

      const space = await getSpaceById(spaceId);
      if (!space) {
        return notFound(res, 'Space');
      }

      const result = await installKanbanPack(spaceId, userId);

      success(res, result);
    } catch (err) {
      apiLogger.error('Error installing kanban pack:', err);
      error(res, 'CREATE_ERROR', err.message, 500);
    }
  });
}
