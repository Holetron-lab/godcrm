// system/settingsController.js — Rate limits, system info, settings, SMTP

import express from 'express';
import CryptoJS from 'crypto-js';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import SMTPService from '../../../services/SMTPService.js';
import { success, badRequest, serverError } from '../../../utils/response.js';
import { ownerOnly } from './helpers.js';

const router = express.Router();

// In-memory storage for verification codes
const verificationCodes = new Map();

/**
 * GET /api/v3/system/rate-limit-config
 * Get current rate limit configuration
 */
router.get('/rate-limit-config', ownerOnly, async (req, res) => {
  try {
    // Get from system_settings table or return defaults
    const setting = await dbGet(
      "SELECT value FROM system_settings WHERE key = 'rate_limit_config'"
    );

    const config = setting?.value
      ? (typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value)
      : {
          auth_max_attempts: 10,
          auth_window_minutes: 15,
          global_max_requests: 1000,
          global_window_minutes: 15
        };

    return success(res, config);
  } catch (error) {
    apiLogger.error('Error fetching rate limit config:', error);
    return serverError(res, error.message);
  }
});

/**
 * PUT /api/v3/system/rate-limit-config
 * Update rate limit configuration
 */
router.put('/rate-limit-config', ownerOnly, async (req, res) => {
  try {
    const { auth_max_attempts, auth_window_minutes, global_max_requests, global_window_minutes } = req.body;

    // Validate
    if (auth_max_attempts < 1 || auth_max_attempts > 100) {
      return badRequest(res, 'auth_max_attempts must be between 1 and 100', 'VALIDATION_ERROR');
    }

    const config = {
      auth_max_attempts: parseInt(auth_max_attempts) || 10,
      auth_window_minutes: parseInt(auth_window_minutes) || 15,
      global_max_requests: parseInt(global_max_requests) || 1000,
      global_window_minutes: parseInt(global_window_minutes) || 15
    };

    // Ensure system_settings table exists
    await dbRun(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Upsert setting
    await dbRun(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('rate_limit_config', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(config)]
    );

    apiLogger.info({ userId: req.user.id, config }, 'Rate limit config updated');

    return success(res, { ...config, message: 'Rate limit configuration updated. Restart server to apply changes.' });
  } catch (error) {
    apiLogger.error('Error updating rate limit config:', error);
    return serverError(res, error.message);
  }
});

/**
 * GET /api/v3/system/info
 * Get system info (owner only)
 */
router.get('/info', ownerOnly, async (req, res) => {
  try {
    const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
    const spaceCount = await dbGet('SELECT COUNT(*) as count FROM spaces');
    const projectCount = await dbGet('SELECT COUNT(*) as count FROM projects');

    return success(res, {
      version: process.env.npm_package_version || '0.003.000',
      node_version: process.version,
      environment: process.env.NODE_ENV || 'development',
      database: 'PostgreSQL',
      stats: {
        users: userCount?.count || 0,
        spaces: spaceCount?.count || 0,
        projects: projectCount?.count || 0
      }
    });
  } catch (error) {
    apiLogger.error('Error fetching system info:', error);
    return serverError(res, error.message);
  }
});

/**
 * GET /api/v3/system/settings
 * Get system settings (non-sensitive only)
 */
router.get('/settings', ownerOnly, async (req, res) => {
  try {
    const settings = await dbAll(
      'SELECT key, value FROM system_settings WHERE key NOT LIKE ?',
      ['%password%']
    );

    const settingsObj = {};
    for (const setting of settings) {
      settingsObj[setting.key] = setting.value;
    }

    return success(res, settingsObj);
  } catch (error) {
    apiLogger.error('Error fetching system settings:', error);
    return serverError(res, error.message);
  }
});

/**
 * POST /api/v3/system/smtp-settings
 * Save SMTP configuration and send verification email
 */
router.post('/smtp-settings', ownerOnly, async (req, res) => {
  try {
    const { host, port, user, password, from } = req.body;

    // Validate
    if (!host || !port || !user || !password || !from) {
      return badRequest(res, 'All SMTP fields are required', 'VALIDATION_ERROR');
    }

    const smtpConfig = { host, port: parseInt(port), user, password, from };

    // Validate SMTP config
    try {
      SMTPService.validate(smtpConfig);
    } catch (validationError) {
      return badRequest(res, validationError.message, 'VALIDATION_ERROR');
    }

    // Generate verification code
    const code = SMTPService.generateVerificationCode();

    // Send test email
    const emailResult = await SMTPService.sendTestEmail(
      smtpConfig,
      req.user.email,
      code
    );

    if (!emailResult.success) {
      return badRequest(res, 'Failed to send test email: ' + emailResult.error, 'SMTP_SEND_FAILED');
    }

    // Store verification code (10 minutes)
    verificationCodes.set(req.user.id, {
      code,
      config: smtpConfig,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    // Auto-cleanup
    setTimeout(() => verificationCodes.delete(req.user.id), 10 * 60 * 1000);

    apiLogger.info({ userId: req.user.id, host }, 'SMTP verification email sent');

    return success(res, { message: 'Verification code sent to ' + req.user.email });
  } catch (error) {
    apiLogger.error('Error saving SMTP settings:', error);
    return serverError(res, error.message);
  }
});

/**
 * POST /api/v3/system/smtp-verify
 * Verify code and save SMTP configuration
 */
router.post('/smtp-verify', ownerOnly, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return badRequest(res, 'Verification code is required', 'CODE_REQUIRED');
    }

    const verificationData = verificationCodes.get(req.user.id);

    if (!verificationData) {
      return badRequest(res, 'Verification code expired or not found', 'CODE_EXPIRED');
    }

    if (Date.now() > verificationData.expiresAt) {
      verificationCodes.delete(req.user.id);
      return badRequest(res, 'Verification code has expired', 'CODE_EXPIRED');
    }

    if (code !== verificationData.code) {
      return badRequest(res, 'Invalid verification code', 'INVALID_CODE');
    }

    // Encrypt password
    const encryptionKey = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
    const encryptedPassword = CryptoJS.AES.encrypt(
      verificationData.config.password,
      encryptionKey
    ).toString();

    // Save SMTP config
    const smtpConfigJson = JSON.stringify({
      host: verificationData.config.host,
      port: verificationData.config.port,
      user: verificationData.config.user,
      password: encryptedPassword,
      from: verificationData.config.from
    });

    // Ensure table exists
    await dbRun(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        encrypted INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(
      `INSERT INTO system_settings (key, value, encrypted, updated_at)
       VALUES ('smtp_config', ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [smtpConfigJson]
    );

    await dbRun(
      `INSERT INTO system_settings (key, value, encrypted, updated_at)
       VALUES ('smtp_configured', 'true', 0, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP`
    );

    verificationCodes.delete(req.user.id);

    apiLogger.info({ userId: req.user.id }, 'SMTP configured successfully');

    return success(res, { message: 'SMTP configured successfully' });
  } catch (error) {
    apiLogger.error('Error verifying SMTP:', error);
    return serverError(res, error.message);
  }
});

export default router;
