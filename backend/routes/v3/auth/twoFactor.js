/**
 * Two-Factor Authentication routes: /2fa/setup, /2fa/verify, /2fa (DELETE)
 */
import {
  respondSuccess, respondError,
  requireAuth,
  dbGet, dbRun, authLogger
} from './authShared.js';

/**
 * @param {import('express').Router} router
 */
export default function registerTwoFactorRoutes(router) {

  // POST /api/v2/auth/2fa/setup - Setup 2FA (generate QR code)
  router.post('/2fa/setup', requireAuth, async (req, res) => {
    try {
      const speakeasy = await import('speakeasy');
      const QRCode = await import('qrcode');

      const user = await dbGet('SELECT email FROM users WHERE id = ?', [req.user.id]);

      const secret = speakeasy.default.generateSecret({
        name: `CRM (${user.email})`,
        issuer: 'Business CRM'
      });

      // Store secret temporarily (not enabled yet)
      await dbRun(
        'UPDATE users SET totp_secret = ? WHERE id = ?',
        [secret.base32, req.user.id]
      );

      const qrCode = await QRCode.default.toDataURL(secret.otpauth_url);

      return respondSuccess(res, {
        secret: secret.base32,
        qrCode
      });
    } catch (error) {
      authLogger.error({ err: error }, '2FA setup error:', error);
      return respondError(res, 500, '2FA_SETUP_FAILED', 'Failed to setup 2FA');
    }
  });

  // POST /api/v2/auth/2fa/verify - Verify and enable 2FA
  router.post('/2fa/verify', requireAuth, async (req, res) => {
    try {
      const { code } = req.body;

      if (!code) {
        return respondError(res, 400, 'CODE_REQUIRED', 'Verification code is required');
      }

      const speakeasy = await import('speakeasy');

      const user = await dbGet('SELECT totp_secret FROM users WHERE id = ?', [req.user.id]);

      if (!user.totp_secret) {
        return respondError(res, 400, 'SETUP_REQUIRED', 'Please setup 2FA first');
      }

      const verified = speakeasy.default.totp.verify({
        secret: user.totp_secret,
        encoding: 'base32',
        token: code,
        window: 1
      });

      if (!verified) {
        return respondError(res, 400, 'INVALID_CODE', 'Invalid verification code');
      }

      await dbRun('UPDATE users SET totp_enabled = 1 WHERE id = ?', [req.user.id]);

      return respondSuccess(res, { enabled: true, message: '2FA enabled successfully' });
    } catch (error) {
      authLogger.error({ err: error }, '2FA verify error:', error);
      return respondError(res, 500, '2FA_VERIFY_FAILED', 'Failed to verify 2FA');
    }
  });

  // DELETE /api/v2/auth/2fa - Disable 2FA
  router.delete('/2fa', requireAuth, async (req, res) => {
    try {
      const { password, code } = req.body;

      if (!password) {
        return respondError(res, 400, 'PASSWORD_REQUIRED', 'Password is required to disable 2FA');
      }

      const bcrypt = await import('bcrypt');
      const speakeasy = await import('speakeasy');

      const user = await dbGet('SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = ?', [req.user.id]);

      if (!user.totp_enabled) {
        return respondError(res, 400, 'NOT_ENABLED', '2FA is not enabled');
      }

      // Verify password
      const isValidPassword = await bcrypt.default.compare(password, user.password_hash);

      if (!isValidPassword) {
        return respondError(res, 401, 'INVALID_PASSWORD', 'Password is incorrect');
      }

      // Optionally verify TOTP code if provided
      if (code) {
        const verified = speakeasy.default.totp.verify({
          secret: user.totp_secret,
          encoding: 'base32',
          token: code,
          window: 1
        });

        if (!verified) {
          return respondError(res, 400, 'INVALID_CODE', 'Invalid verification code');
        }
      }

      await dbRun('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [req.user.id]);

      return respondSuccess(res, { enabled: false, message: '2FA disabled successfully' });
    } catch (error) {
      authLogger.error({ err: error }, '2FA disable error:', error);
      return respondError(res, 500, '2FA_DISABLE_FAILED', 'Failed to disable 2FA');
    }
  });
}
