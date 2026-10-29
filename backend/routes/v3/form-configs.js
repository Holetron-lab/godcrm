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

    // Every form type stored for the table — the builder restores its
    // checkboxes from this, so re-saving does not silently unpublish `custom`.
    const storedTypes = await dbAll(
      `SELECT DISTINCT form_type FROM system_form_configs WHERE table_id = ?`,
      [tableId]
    );

    res.json({
      success: true,
      data: {
        id: config.id,
        tableId: config.table_id,
        formType: config.form_type,
        formTypes: storedTypes.map((r) => r.form_type),
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
    const { formType = 'edit', formTypes, name, config, isDefault = true } = req.body;

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

    // The builder saves one config for several form types at once
    // (add_row / edit_row / custom). `custom` is the published link
    // (/forms/:tableId): listed → upserted, unlisted → unpublished.
    const types = Array.isArray(formTypes) && formTypes.length > 0
      ? [...new Set([formType, ...formTypes].filter((t) => typeof t === 'string' && t))]
      : [formType];

    const configJson = JSON.stringify(config || {});
    const now = new Date().toISOString();
    let primary = null;

    for (const type of types) {
      const existing = await dbGet(
        `SELECT id FROM system_form_configs
         WHERE table_id = ? AND form_type = ? AND is_default = ?`,
        [tableId, type, isDefault ? 1 : 0]
      );
      let id;
      let createdNow = false;
      if (existing) {
        await dbRun(
          `UPDATE system_form_configs
           SET name = ?, config = ?, updated_at = ?
           WHERE id = ?`,
          [name || null, configJson, now, existing.id]
        );
        id = existing.id;
      } else {
        const result = await dbRun(
          `INSERT INTO system_form_configs
           (table_id, form_type, name, config, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [tableId, type, name || null, configJson, isDefault ? 1 : 0, now, now]
        );
        id = result.lastInsertRowid || result.lastID;
        createdNow = true;
      }
      if (type === formType) primary = { id, createdNow };
    }

    if (Array.isArray(formTypes) && !types.includes('custom')) {
      await dbRun(
        `DELETE FROM system_form_configs WHERE table_id = ? AND form_type = 'custom'`,
        [tableId]
      );
    }

    res.status(primary.createdNow ? 201 : 200).json({
      success: true,
      data: {
        id: primary.id,
        tableId: parseInt(tableId),
        formType,
        formTypes: types,
        name,
        config,
        isDefault,
        updatedAt: now
      },
      message: primary.createdNow ? 'Form configuration created' : 'Form configuration updated',
      timestamp: now
    });
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
