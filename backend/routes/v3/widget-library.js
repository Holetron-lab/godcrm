/**
 * API v3: Widget Library Routes — ADR-073
 * Endpoints for widget picker system
 */

import express from 'express';
import {
  getLibraryWidgets,
  getFavorites,
  getRecent,
  toggleFavorite,
  addFromLibrary
} from '../../services/WidgetLibraryService.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/v3/widget-library
 * Get library widgets with filters
 * Query params: space_id (required), include_public, category, search, limit, offset
 */
router.get('/widget-library', async (req, res) => {
  try {
    const { space_id, include_public, category, search, limit, offset } = req.query;

    if (!space_id) {
      return badRequest(res, 'space_id query parameter is required');
    }

    const userId = req.user?.id;

    const result = await getLibraryWidgets(parseInt(space_id), {
      include_public: include_public === 'true' || include_public === '1',
      category: category || null,
      search: search || null,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      userId
    });

    success(res, result);
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching widget library');
    error(res, 'INTERNAL_ERROR', err.message);
  }
});

/**
 * GET /api/v3/widget-library/favorites
 * Get user's favorite widgets
 */
router.get('/widget-library/favorites', async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return badRequest(res, 'User authentication required');
    }

    const favorites = await getFavorites(userId);
    success(res, favorites);
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching favorites');
    error(res, 'INTERNAL_ERROR', err.message);
  }
});

/**
 * GET /api/v3/widget-library/recent
 * Get recently used widgets
 * Query params: limit (default 10)
 */
router.get('/widget-library/recent', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { limit } = req.query;

    if (!userId) {
      return badRequest(res, 'User authentication required');
    }

    const recent = await getRecent(userId, limit ? parseInt(limit) : 10);
    success(res, recent);
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching recent widgets');
    error(res, 'INTERNAL_ERROR', err.message);
  }
});

/**
 * POST /api/v3/widget-library/:widgetId/favorite
 * Toggle favorite status for a widget
 */
router.post('/widget-library/:widgetId/favorite', async (req, res) => {
  try {
    const { widgetId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return badRequest(res, 'User authentication required');
    }

    const result = await toggleFavorite(userId, parseInt(widgetId));
    success(res, result);
  } catch (err) {
    apiLogger.error({ err }, 'Error toggling favorite');

    if (err.message === 'Widget not found') {
      return notFound(res, 'Widget');
    }

    error(res, 'INTERNAL_ERROR', err.message);
  }
});

/**
 * POST /api/v3/dashboards/:dashboardId/widgets/from-library
 * Add widget from library to dashboard
 * Body: { source_widget_id, mode: 'reference'|'copy', position: { x, y, w, h } }
 */
router.post('/dashboards/:dashboardId/widgets/from-library', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const { source_widget_id, mode, position } = req.body;
    const userId = req.user?.id;

    if (!source_widget_id) {
      return badRequest(res, 'source_widget_id is required');
    }

    if (!mode || !['reference', 'copy'].includes(mode)) {
      return badRequest(res, 'Invalid mode: must be "reference" or "copy"');
    }

    const result = await addFromLibrary(
      parseInt(dashboardId),
      parseInt(source_widget_id),
      mode,
      position || { x: 0, y: 0, w: 6, h: 4 },
      userId
    );

    created(res, result);
  } catch (err) {
    apiLogger.error({ err }, 'Error adding widget from library');

    if (err.message === 'Source widget not found') {
      return notFound(res, 'Source widget');
    }
    if (err.message === 'Dashboard not found') {
      return notFound(res, 'Dashboard');
    }
    if (err.message.includes('Invalid mode')) {
      return badRequest(res, err.message);
    }

    error(res, 'INTERNAL_ERROR', err.message);
  }
});

export default router;
