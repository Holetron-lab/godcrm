/**
 * Spaces Variables Routes
 * GET /:id/variables, POST /:id/variables/recalculate
 */

import { getSpaceById } from '../../../services/SpaceService.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, notFound } from '../../../utils/response.js';

/**
 * @swagger
 * /spaces/{id}/variables:
 *   get:
 *     tags: [Spaces]
 *     summary: Get space variables
 *     description: Returns all variables for a space (ADR-026). Shortcut to Universal Table.
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
 *         description: List of variables
 *       404:
 *         description: Space not found
 */

/**
 * @swagger
 * /spaces/{id}/variables/recalculate:
 *   post:
 *     tags: [Spaces]
 *     summary: Recalculate space variables
 *     description: Triggers recalculation of all variables for a space (ADR-026)
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
 *         description: Recalculation result
 *       404:
 *         description: Space not found
 */

export default function registerVariablesRoutes(router) {
  router.get('/:id/variables', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);

      const space = await getSpaceById(spaceId);
      if (!space) {
        return notFound(res, 'Space');
      }

      // Get Variables from SpaceService
      const { getSpaceVariables } = await import('../../../services/SpaceService.js');
      const result = await getSpaceVariables(spaceId);

      success(res, result);
    } catch (err) {
      apiLogger.error('Error fetching space variables:', err);
      error(res, 'FETCH_ERROR', err.message, 500);
    }
  });

  router.post('/:id/variables/recalculate', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);

      const space = await getSpaceById(spaceId);
      if (!space) {
        return notFound(res, 'Space');
      }

      // Recalculate variables
      const { recalculateSpaceVariables } = await import('../../../services/SpaceService.js');
      const result = await recalculateSpaceVariables(spaceId);

      success(res, result);
    } catch (err) {
      apiLogger.error('Error recalculating space variables:', err);
      error(res, 'RECALCULATE_ERROR', err.message, 500);
    }
  });
}
