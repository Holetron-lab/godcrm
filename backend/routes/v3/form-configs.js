import { logger, apiLogger } from '../../utils/logger.js';
import express from 'express';
import { authenticate } from '../../middleware/auth.js';
import { dbGet, dbRun, dbAll, sqlTrue, toBool } from '../../database/connection.js';

const router = express.Router();

/**
 * GET /api/v2/form-configs/:tableId
 * Get form config for a specific table
 */
router.get('/:tableId', authenticate, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { formType = 'edit' } = req.query;

    const config = await dbGet(
      `SELECT * FROM system_form_configs 
       WHERE table_id = ? AND form_type = ? AND is_default = ${sqlTrue()}`,
      [tableId, formType]
    );

    if (!config) {
      // Return empty config if not found
      return res.json({
        success: true,
        data: null,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: {
        id: config.id,
        tableId: config.table_id,
        formType: config.form_type,
        name: config.name,
        config: JSON.parse(config.config || '{}'),
        isDefault: Boolean(config.is_default),
        createdAt: config.created_at,
        updatedAt: config.updated_at
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching form config:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FORM_CONFIG_FETCH_ERROR',
        message: 'Failed to fetch form configuration'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/v2/form-configs/:tableId/all
 * Get all form configs for a table (both edit and add)
 */
router.get('/:tableId/all', authenticate, async (req, res) => {
  try {
    const { tableId } = req.params;

    const configs = await dbAll(
      `SELECT * FROM system_form_configs WHERE table_id = ?`,
      [tableId]
    );

    res.json({
      success: true,
      data: configs.map(config => ({
        id: config.id,
        tableId: config.table_id,
        formType: config.form_type,
        name: config.name,
        config: JSON.parse(config.config || '{}'),
        isDefault: Boolean(config.is_default),
        createdAt: config.created_at,
        updatedAt: config.updated_at
      })),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching form configs:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FORM_CONFIGS_FETCH_ERROR',
        message: 'Failed to fetch form configurations'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/v2/form-configs/:tableId
 * Create or update form config for a table
 */
router.post('/:tableId', authenticate, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { formType = 'edit', name, config, isDefault = true } = req.body;

    // Validate config is object
    if (config && typeof config !== 'object') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CONFIG',
          message: 'Config must be a valid JSON object'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if config already exists
    const existing = await dbGet(
      `SELECT id FROM system_form_configs 
       WHERE table_id = ? AND form_type = ? AND is_default = ?`,
      [tableId, formType, isDefault ? 1 : 0]
    );

    const configJson = JSON.stringify(config || {});
    const now = new Date().toISOString();

    if (existing) {
      // Update existing
      await dbRun(
        `UPDATE system_form_configs 
         SET name = ?, config = ?, updated_at = ?
         WHERE id = ?`,
        [name || null, configJson, now, existing.id]
      );

      res.json({
        success: true,
        data: {
          id: existing.id,
          tableId: parseInt(tableId),
          formType,
          name,
          config,
          isDefault,
          updatedAt: now
        },
        message: 'Form configuration updated',
        timestamp: now
      });
    } else {
      // Create new
      const result = await dbRun(
        `INSERT INTO system_form_configs 
         (table_id, form_type, name, config, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tableId, formType, name || null, configJson, isDefault ? 1 : 0, now, now]
      );

      res.status(201).json({
        success: true,
        data: {
          id: result.lastInsertRowid || result.lastID,
          tableId: parseInt(tableId),
          formType,
          name,
          config,
          isDefault,
          createdAt: now,
          updatedAt: now
        },
        message: 'Form configuration created',
        timestamp: now
      });
    }
  } catch (error) {
    logger.error('Error saving form config:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FORM_CONFIG_SAVE_ERROR',
        message: 'Failed to save form configuration'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/v2/form-configs/:tableId
 * Delete form config for a table
 */
router.delete('/:tableId', authenticate, async (req, res) => {
  try {
    const { tableId } = req.params;
    const { formType = 'edit' } = req.query;

    await dbRun(
      `DELETE FROM system_form_configs 
       WHERE table_id = ? AND form_type = ?`,
      [tableId, formType]
    );

    res.json({
      success: true,
      message: 'Form configuration deleted',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error deleting form config:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FORM_CONFIG_DELETE_ERROR',
        message: 'Failed to delete form configuration'
      },
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
