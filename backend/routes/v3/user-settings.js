// API v3: User Settings Routes
// Handles user preferences like spaces order
/**
 * @swagger
 * components:
 *   schemas:
 *     UserSettings:
 *       type: object
 *       properties:
 *         spacesOrder:
 *           type: object
 *           additionalProperties:
 *             type: integer
 */
import express from 'express';
import { dbGet, dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { getUserDashboard, createDashboard } from '../../services/DashboardService.js';
import { success, badRequest, error } from '../../utils/response.js';

const router = express.Router();

/**
 * GET /api/v3/user-settings/spaces-order
 * Get spaces order for authenticated user
 * Returns: { spacesOrder: { [spaceId]: number } }
 * @swagger
 * /api/v3/user-settings/spaces-order:
 *   get:
 *     summary: Get spaces order for user
 *     tags: [User Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User spaces order
 */
router.get('/spaces-order', async (req, res) => {
  try {
    const userId = req.user.id;
    
    const setting = await dbGet(
      `SELECT setting_value_encrypted as value FROM user_settings 
       WHERE user_id = ? AND setting_key = 'spaces_order'`,
      [userId]
    );
    
    // Return the order object or empty object
    let spacesOrder = {};
    if (setting?.value) {
      try {
        spacesOrder = JSON.parse(setting.value);
      } catch (e) {
        apiLogger.error('Failed to parse spaces_order:', e);
        spacesOrder = {};
      }
    }
    
    success(res, { spacesOrder });
  } catch (err) {
    apiLogger.error('Error fetching spaces order:', err);
    error(res, 'FETCH_ERROR', err.message, 500);
  }
});

/**
 * PUT /api/v3/user-settings/spaces-order
 * Update spaces order for authenticated user
 * Body: { spacesOrder: { [spaceId]: number } }
 * @swagger
 * /api/v3/user-settings/spaces-order:
 *   put:
 *     summary: Update spaces order for user
 *     tags: [User Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserSettings'
 *     responses:
 *       200:
 *         description: Order updated
 */
router.put('/spaces-order', async (req, res) => {
  try {
    const userId = req.user.id;
    const { spacesOrder } = req.body;
    
    if (typeof spacesOrder !== 'object' || spacesOrder === null || Array.isArray(spacesOrder)) {
      return badRequest(res, 'spacesOrder must be an object with spaceId keys and number values');
    }
    
    const valueJson = JSON.stringify(spacesOrder);
    
    // Upsert the setting
    await dbRun(
      `INSERT INTO user_settings (user_id, setting_key, setting_value_encrypted, setting_type)
       VALUES (?, 'spaces_order', ?, 'preference')
       ON CONFLICT(user_id, setting_key) 
       DO UPDATE SET setting_value_encrypted = ?, last_used_at = CURRENT_TIMESTAMP`,
      [userId, valueJson, valueJson]
    );
    
    success(res, { spacesOrder });
  } catch (err) {
    apiLogger.error('Error updating spaces order:', err);
    error(res, 'UPDATE_ERROR', err.message, 500);
  }
});

/**
 * PATCH /api/v3/user-settings/spaces-order/:spaceId
 * Update order for a single space
 * Body: { order: number }
 */
router.patch('/spaces-order/:spaceId', async (req, res) => {
  try {
    const userId = req.user.id;
    const spaceId = parseInt(req.params.spaceId, 10);
    const { order } = req.body;
    
    if (isNaN(spaceId)) {
      return badRequest(res, 'Invalid spaceId');
    }
    
    if (typeof order !== 'number') {
      return badRequest(res, 'order must be a number');
    }
    
    // Get current settings
    const setting = await dbGet(
      `SELECT setting_value_encrypted as value FROM user_settings 
       WHERE user_id = ? AND setting_key = 'spaces_order'`,
      [userId]
    );
    
    let spacesOrder = {};
    if (setting?.value) {
      try {
        spacesOrder = JSON.parse(setting.value);
      } catch (e) {
        spacesOrder = {};
      }
    }
    
    // Update order for this space
    spacesOrder[spaceId] = order;
    
    const valueJson = JSON.stringify(spacesOrder);
    
    // Upsert
    await dbRun(
      `INSERT INTO user_settings (user_id, setting_key, setting_value_encrypted, setting_type)
       VALUES (?, 'spaces_order', ?, 'preference')
       ON CONFLICT(user_id, setting_key) 
       DO UPDATE SET setting_value_encrypted = ?, last_used_at = CURRENT_TIMESTAMP`,
      [userId, valueJson, valueJson]
    );
    
    success(res, { spacesOrder });
  } catch (err) {
    apiLogger.error('Error updating space order:', err);
    error(res, 'UPDATE_ERROR', err.message, 500);
  }
});

/**
 * DELETE /api/v3/user-settings/spaces-order
 * Reset spaces order to default
 */
router.delete('/spaces-order', async (req, res) => {
  try {
    const userId = req.user.id;
    
    await dbRun(
      `DELETE FROM user_settings WHERE user_id = ? AND setting_key = 'spaces_order'`,
      [userId]
    );
    
    success(res, { spacesOrder: {} });
  } catch (err) {
    apiLogger.error('Error resetting spaces order:', err);
    error(res, 'DELETE_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/user-settings/home-dashboard
 * Get or create home dashboard for authenticated user
 * Returns: { id, name, icon, ... }
 */
router.get('/home-dashboard', async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Try to get existing home dashboard
    let dashboard = await getUserDashboard(userId);
    
    // Create if doesn't exist
    if (!dashboard) {
      dashboard = await createDashboard({
        user_id: userId,
        name: 'Home',
        icon: '🏠',
        is_default: true
      });
      apiLogger.info(`Created home dashboard for user ${userId}`);
    }
    
    success(res, dashboard);
  } catch (err) {
    apiLogger.error('Error fetching home dashboard:', err);
    error(res, 'FETCH_ERROR', err.message, 500);
  }
});

export default router;
