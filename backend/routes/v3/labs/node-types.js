/**
 * Labs Node Types Routes
 * GET /node-types - Returns system-wide node types catalog
 */
import { Router } from 'express';
import { apiLogger } from '../../../utils/logger.js';
import { success, badRequest } from '../../../utils/response.js';
import { getAllNodeTypes } from '../../../services/labs/node-types/index.js';

const router = Router();

/**
 * GET /api/v3/labs/node-types
 * Returns system-wide node types catalog (from code, not database)
 */
router.get('/node-types', async (req, res) => {
  try {
    const types = getAllNodeTypes();
    success(res, types);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get node types');
    badRequest(res, 'Failed to get node types');
  }
});

export default router;
