import { logger, apiLogger } from '../utils/logger.js';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import CryptoJS from 'crypto-js';
import nodemailer from 'nodemailer';
import { dbRun, dbGet } from '../database/init.js';
import { authenticate } from '../middleware/auth.js';
import { success, badRequest, unauthorized, serverError } from '../utils/response.js';
import { getSecret } from '../services/secrets/getSecret.js';

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return badRequest(res, 'User already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await dbRun(
      'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)',
      [email, passwordHash, name, 'admin']
    );

    const userId = result.lastInsertRowid;

    // Create default business/workspace for the user (if not exists)
    const businessResult = await dbRun(
      'INSERT INTO businesses (name, description, owner_id) VALUES (?, ?, ?)',
      ['My Workspace', 'Personal workspace', userId]
    );
    const businessId = businessResult.lastID;

    // Encrypt the password for storage in Password Manager
    const encryptionKey = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
    const encryptedPassword = CryptoJS.AES.encrypt(password, encryptionKey).toString();
    const encryptedLogin = CryptoJS.AES.encrypt(email, encryptionKey).toString();

    // Create first entry in Password Manager: GOD CRM Account
    await dbRun(
      `INSERT INTO services (
        business_id, 
        name, 
        description, 
        type, 
        login_encrypted, 
        password_encrypted,
        url
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        'GOD CRM Account',
        'Your account credentials for this GOD CRM workspace',
        'System',
        encryptedLogin,
        encryptedPassword,
        'http://localhost:3000'
      ]
    );

    return success(res, { userId }, 'Account created. Default workspace and password entry added.');
  } catch (err) {
    logger.error('Registration error:', err);
    return serverError(res, err.message);
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, totpCode } = req.body;
    
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return unauthorized(res, 'Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return unauthorized(res, 'Invalid credentials');
    }

    // Check 2FA if enabled
    if (user.totp_enabled) {
      if (!totpCode) {
        return success(res, { requireTotp: true });
      }
      
      const verified = speakeasy.totp.verify({
        secret: user.totp_secret,
        encoding: 'base32',
        token: totpCode
      });

      if (!verified) {
        return unauthorized(res, 'Invalid 2FA code');
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return success(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    return serverError(res, err.message);
  }
});

// Setup 2FA
router.post('/setup-2fa', authenticate, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `Business CRM (${req.user.email})`
    });

    await dbRun(
      'UPDATE users SET totp_secret = ? WHERE id = ?',
      [secret.base32, req.user.id]
    );

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    return success(res, {
      secret: secret.base32,
      qrCode
    });
  } catch (err) {
    return serverError(res, err.message);
  }
});

// Verify and enable 2FA
router.post('/verify-2fa', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    
    const user = await dbGet('SELECT totp_secret FROM users WHERE id = ?', [req.user.id]);
    
    const verified = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: code
    });

    if (!verified) {
      return badRequest(res, 'Invalid code');
    }

    await dbRun('UPDATE users SET totp_enabled = 1 WHERE id = ?', [req.user.id]);

    return success(res, null);
  } catch (err) {
    return serverError(res, err.message);
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await dbGet(
      'SELECT id, email, name, role, totp_enabled FROM users WHERE id = ?',
      [req.user.id]
    );
    return success(res, user);
  } catch (err) {
    return serverError(res, err.message);
  }
});

// Forgot password - send reset email
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    logger.info('🔐 Password reset request for:', email);
    
    const user = await dbGet('SELECT id, email, name FROM users WHERE email = ?', [email]);
    
    if (!user) {
      // По соображениям безопасности не сообщаем что пользователь не найден
      return success(res, null, 'If the email exists, a reset link will be sent');
    }

    // Генерируем токен для сброса пароля
    const resetToken = jwt.sign(
      { id: user.id, email: user.email, purpose: 'password-reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const resetLink = `${process.env.APP_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
    
    logger.info('🔗 Reset link:', resetLink);

    // Отправка email через nodemailer
    try {
      // ADR-0040: SMTP creds via vault (env fallback during transition).
      const smtpUser = await getSecret('smtp_user', 'SMTP_USER');
      const smtpPass = await getSecret('smtp_pass', 'SMTP_PASS');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });

      const mailOptions = {
        from: process.env.SMTP_FROM || smtpUser,
        to: user.email,
        subject: 'Password Reset - GOD CRM',
        html: `
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
        `
      };

      await transporter.sendMail(mailOptions);
      logger.info('✅ Reset email sent to:', user.email);
    } catch (emailError) {
      logger.error('❌ Email send error:', emailError.message);
      // Продолжаем даже если email не отправился (для dev режима)
    }

    const responseData = process.env.NODE_ENV === 'development' ? { resetToken } : null;
    return success(res, responseData, 'Password reset instructions have been sent to your email');
  } catch (err) {
    logger.error('❌ Forgot password error:', err);
    return serverError(res, err.message);
  }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return badRequest(res, 'Token and new password are required');
    }

    logger.info('🔐 Password reset attempt with token');

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.purpose !== 'password-reset') {
        return badRequest(res, 'Invalid reset token');
      }
    } catch (jwtErr) {
      return badRequest(res, 'Invalid or expired reset token');
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await dbRun(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [passwordHash, decoded.id]
    );

    logger.info('✅ Password reset successful for user:', decoded.email);

    return success(res, null, 'Password has been reset successfully');
  } catch (err) {
    logger.error('❌ Reset password error:', err);
    return serverError(res, err.message);
  }
});

export default router;
