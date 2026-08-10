/**
 * Password Reset routes: /forgot-password, /verify-reset-token, /reset-password
 */
import { sendEmailWithFallback } from '../../../utils/email.js';
import {
  respondSuccess, respondError,
  JWT_SECRET,
  dbGet, dbRun, authLogger, jwt
} from './authShared.js';

/**
 * @param {import('express').Router} router
 */
export default function registerPasswordResetRoutes(router) {

  // POST /api/v3/auth/forgot-password - Request password reset
  router.post('/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return respondError(res, 400, 'EMAIL_REQUIRED', 'Email is required');
      }

      authLogger.info(' Password reset request for:', email);

      const user = await dbGet('SELECT id, email, name FROM users WHERE email = ?', [email]);

      if (!user) {
        // Security: don't reveal if user exists
        authLogger.info(' User not found:', email);
        return respondSuccess(res, {
          message: 'If the email exists, a reset link will be sent'
        });
      }

      // Generate password reset token
      const resetToken = jwt.sign(
        { id: user.id, email: user.email, purpose: 'password-reset' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      const resetLink = `${process.env.APP_URL || 'https://crm.hltrn.cc'}/reset-password?token=${resetToken}`;

      authLogger.info(' Reset link generated for:', user.email);

      // Send email via sendEmailWithFallback
      try {
        const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2196F3;">Password Reset Request</h2>
          <p>Hello ${user.name},</p>
          <p>You requested to reset your password for GOD CRM.</p>
          <p>Click the button below to reset your password:</p>
          <div style="margin: 30px 0;">
            <a href="${resetLink}"
               style="background-color: #2196F3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>Or copy this link to your browser:</p>
          <p style="color: #666; word-break: break-all;">${resetLink}</p>
          <p style="color: #999; font-size: 12px; margin-top: 30px;">
            This link will expire in 1 hour.<br>
            If you didn't request this, please ignore this email.
          </p>
        </div>
      `;

        const result = await sendEmailWithFallback(
          user.email,
          'Password Reset - GOD CRM',
          emailHtml
        );

        if (result.success) {
          authLogger.info(' Reset email sent to:', user.email);
        } else {
          authLogger.error({ err: result.error }, 'Email send error:', result.error);
        }
      } catch (emailError) {
        authLogger.error({ err: emailError }, 'Email send error:', emailError.message);
        // Continue even if email fails (for dev mode)
      }

      return respondSuccess(res, {
        message: 'Password reset instructions have been sent to your email',
        // In dev mode, return token for testing
        ...(process.env.NODE_ENV === 'development' && { resetToken, resetLink })
      });

    } catch (error) {
      authLogger.error({ err: error }, 'Forgot password error:', error);
      return respondError(res, 500, 'FORGOT_PASSWORD_FAILED', 'Failed to process password reset request');
    }
  });

  // GET /api/v3/auth/verify-reset-token/:token - Verify reset token is valid
  router.get('/verify-reset-token/:token', async (req, res) => {
    try {
      const { token } = req.params;

      if (!token) {
        return respondError(res, 400, 'TOKEN_REQUIRED', 'Reset token is required');
      }

      // Verify token
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.purpose !== 'password-reset') {
          return respondError(res, 400, 'INVALID_TOKEN', 'Invalid reset token');
        }
      } catch (err) {
        return respondError(res, 400, 'INVALID_TOKEN', 'Reset token is invalid or expired');
      }

      // Get user info
      const user = await dbGet('SELECT email FROM users WHERE id = ?', [decoded.id]);

      if (!user) {
        return respondError(res, 400, 'USER_NOT_FOUND', 'User not found');
      }

      return respondSuccess(res, {
        valid: true,
        email: user.email
      });

    } catch (error) {
      authLogger.error({ err: error }, 'Verify reset token error:', error);
      return respondError(res, 500, 'VERIFY_TOKEN_FAILED', 'Failed to verify reset token');
    }
  });

  // POST /api/v3/auth/reset-password - Reset password with token
  router.post('/reset-password', async (req, res) => {
    try {
      const { token, password } = req.body;

      if (!token || !password) {
        return respondError(res, 400, 'VALIDATION_ERROR', 'Token and new password are required');
      }

      if (password.length < 8) {
        return respondError(res, 400, 'WEAK_PASSWORD', 'Password must be at least 8 characters long');
      }

      authLogger.info(' Password reset attempt with token');

      // Verify token
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.purpose !== 'password-reset') {
          return respondError(res, 400, 'INVALID_TOKEN', 'Invalid reset token');
        }
      } catch (err) {
        return respondError(res, 400, 'INVALID_TOKEN', 'Reset token is invalid or expired');
      }

      // Update password
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.default.hash(password, 10);

      await dbRun(
        'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [passwordHash, decoded.id]
      );

      authLogger.info(' Password reset successful for user:', decoded.email);

      return respondSuccess(res, {
        message: 'Password has been reset successfully'
      });

    } catch (error) {
      authLogger.error({ err: error }, 'Reset password error:', error);
      return respondError(res, 500, 'RESET_PASSWORD_FAILED', 'Failed to reset password');
    }
  });
}
