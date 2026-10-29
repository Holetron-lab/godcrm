/**
 * Profile routes: /profile (GET/PATCH), /avatar (POST/DELETE), /email (PATCH)
 */
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import {
  respondSuccess, respondError,
  requireAuth,
  dbGet, dbRun, authLogger
} from './authShared.js';
import { regenerateReferralCode } from '../../../services/AuthService.js';

// ---------------------------------------------------------------------------
// Avatar upload configuration (ADR-099)
// ---------------------------------------------------------------------------
const UPLOAD_BASE_PATH = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';
const AVATARS_DIR = path.join(UPLOAD_BASE_PATH, 'avatars');

// Ensure avatars directory exists on module load
if (!fs.existsSync(AVATARS_DIR)) {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  authLogger.info('Created avatars directory:', AVATARS_DIR);
}

// Multer config for avatar upload
const ALLOWED_IMAGE_MIMES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'
];

const avatarStorage = multer.memoryStorage();
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PNG, JPG, GIF, WebP, SVG`));
    }
  }
});

/**
 * Sanitize SVG content by removing dangerous elements and attributes
 */
function sanitizeSVG(svgContent) {
  // Remove script tags and their content
  let sanitized = svgContent.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove event handler attributes (onload, onerror, onclick, etc.)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*\S+/gi, '');
  // Remove javascript: URIs
  sanitized = sanitized.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  sanitized = sanitized.replace(/xlink:href\s*=\s*["']javascript:[^"']*["']/gi, 'xlink:href="#"');
  // Remove foreignObject (can embed HTML)
  sanitized = sanitized.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  // Remove iframe
  sanitized = sanitized.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  sanitized = sanitized.replace(/<iframe[\s\S]*?\/>/gi, '');
  // Remove use element (can reference external resources)
  sanitized = sanitized.replace(/<use[\s\S]*?<\/use>/gi, '');
  sanitized = sanitized.replace(/<use[\s\S]*?\/>/gi, '');
  return sanitized;
}

/**
 * Delete old avatar file from disk (only if it's a URL path, not base64)
 */
function deleteOldAvatarFile(avatarValue) {
  if (!avatarValue || avatarValue.startsWith('data:')) return;

  // Extract relative path: /uploads/avatars/... -> full disk path
  if (avatarValue.startsWith('/uploads/')) {
    const filePath = path.join(UPLOAD_BASE_PATH, avatarValue.replace('/uploads/', ''));
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        authLogger.info('Deleted old avatar file:', filePath);
      } catch (err) {
        authLogger.error({ err }, 'Failed to delete old avatar:', filePath);
      }
    }
  }
}

// Accent colour picked next to the avatar. Agent users keep it on the agent
// row (data->>'color') so the space's Agents table stays the source of truth;
// humans keep it on users.color. Readers COALESCE(row colour, users.color).
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const PROFILE_SELECT = `SELECT u.id, u.email, u.name, u.avatar, u.role, u.totp_enabled, u.created_at, u.referral_code,
         u.user_type, COALESCE(ar.data->>'color', u.color) AS color
  FROM users u
  LEFT JOIN table_rows ar ON ar.id = u.managed_by_agent_row_id AND ar.table_id = u.managed_by_agent_table_id
  WHERE u.id = ?`;

async function saveAgentRowColor(userId, color) {
  const link = await dbGet(
    "SELECT managed_by_agent_table_id AS table_id, managed_by_agent_row_id AS row_id FROM users WHERE id = ? AND user_type = 'agent'",
    [userId]
  );
  if (!link?.row_id) return false;
  const r = await dbRun(
    `UPDATE table_rows SET data = data || jsonb_build_object('color', ?::text), updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND table_id = ?`,
    [color, link.row_id, link.table_id]
  );
  return r.changes > 0;
}

/**
 * @param {import('express').Router} router
 */
export default function registerProfileRoutes(router) {

  // GET /api/v2/auth/profile - Get current user profile
  router.get('/profile', requireAuth, async (req, res) => {
    try {
      const user = await dbGet(PROFILE_SELECT, [req.user.id]);

      if (!user) {
        return respondError(res, 404, 'USER_NOT_FOUND', 'User not found');
      }

      return respondSuccess(res, user);
    } catch (error) {
      authLogger.error({ err: error }, 'Get profile error:', error);
      return respondError(res, 500, 'PROFILE_FETCH_FAILED', 'Failed to fetch profile');
    }
  });

  // PATCH /api/v2/auth/profile - Update profile (name, avatar)
  router.patch('/profile', requireAuth, async (req, res) => {
    try {
      const { name, avatar } = req.body;
      let { color } = req.body;
      const userId = req.user.id;

      const updates = [];
      const params = [];

      if (name !== undefined) {
        updates.push('name = ?');
        params.push(name);
      }

      if (avatar !== undefined) {
        updates.push('avatar = ?');
        params.push(avatar);
      }

      if (color !== undefined) {
        if (color !== null) {
          color = typeof color === 'string' ? color.trim().toLowerCase() : color;
          if (!HEX_COLOR.test(color)) {
            return respondError(res, 400, 'INVALID_COLOR', 'Color must be #rrggbb or null');
          }
        }
        // Agent users own their colour on the agent row; only humans (or
        // unlinked agents) fall through to users.color.
        if (!(color !== null && await saveAgentRowColor(userId, color))) {
          updates.push('color = ?');
          params.push(color);
        }
      }

      if (updates.length === 0 && color === undefined) {
        return respondError(res, 400, 'NO_UPDATES', 'No fields to update');
      }

      if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(userId);
        await dbRun(
          `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
          params
        );
      }

      const user = await dbGet(PROFILE_SELECT, [userId]);

      return respondSuccess(res, user);
    } catch (error) {
      authLogger.error({ err: error }, 'Update profile error:', error);
      return respondError(res, 500, 'PROFILE_UPDATE_FAILED', 'Failed to update profile');
    }
  });

  // POST /api/v3/auth/referral-code/regenerate — ADR-183-A D3.
  // Self-service reroll of the caller's OWN referral code. The value is entirely
  // server-minted (not client-supplied — that would be the rejected vanity-code
  // surface): only the suffix changes, the name-prefix is frozen. The caller's
  // incoming edge (referred_by — who invited them) is untouched. D5: this
  // invalidates already-shared ?ref=<old> links (best-effort attribution, no gate).
  router.post('/referral-code/regenerate', requireAuth, async (req, res) => {
    try {
      const referral_code = await regenerateReferralCode(req.user.id);
      return respondSuccess(res, { referral_code });
    } catch (error) {
      authLogger.error({ err: error, userId: req.user.id }, 'Referral code regeneration error:', error);
      return respondError(res, 500, 'REFERRAL_REGEN_FAILED', 'Failed to regenerate referral code');
    }
  });

  // POST /api/v2/auth/avatar - Upload avatar image
  router.post('/avatar', requireAuth, (req, res) => {
    avatarUpload.single('avatar')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return respondError(res, 400, 'FILE_TOO_LARGE', 'File size exceeds 5MB limit');
        }
        return respondError(res, 400, 'UPLOAD_ERROR', err.message);
      }

      if (!req.file) {
        return respondError(res, 400, 'NO_FILE', 'No avatar file provided');
      }

      try {
        const userId = req.user.id;
        const file = req.file;
        const timestamp = Date.now();
        let ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        let fileBuffer = file.buffer;

        if (file.mimetype === 'image/svg+xml') {
          // Sanitize SVG
          const svgContent = fileBuffer.toString('utf8');
          const sanitized = sanitizeSVG(svgContent);
          fileBuffer = Buffer.from(sanitized, 'utf8');
          ext = '.svg';
        } else {
          // Resize and compress raster images with sharp
          try {
            const sharp = (await import('sharp')).default;
            fileBuffer = await sharp(fileBuffer)
              .resize(256, 256, { fit: 'cover', position: 'center' })
              .jpeg({ quality: 80 })
              .toBuffer();
            ext = '.jpg';
          } catch (sharpErr) {
            authLogger.error({ err: sharpErr }, 'Sharp processing failed, saving original');
            // Fall through with original buffer
          }
        }

        const filename = `${userId}_${timestamp}${ext}`;
        const filePath = path.join(AVATARS_DIR, filename);
        const avatarUrl = `/uploads/avatars/${filename}`;

        // Get old avatar to delete later
        const currentUser = await dbGet('SELECT avatar FROM users WHERE id = ?', [userId]);

        // Save new file
        fs.writeFileSync(filePath, fileBuffer);

        // Update DB
        await dbRun(
          'UPDATE users SET avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [avatarUrl, userId]
        );

        // Delete old avatar file
        if (currentUser?.avatar) {
          deleteOldAvatarFile(currentUser.avatar);
        }

        authLogger.info(`Avatar uploaded for user ${userId}: ${avatarUrl}`);

        return respondSuccess(res, { avatar: avatarUrl });
      } catch (error) {
        authLogger.error({ err: error }, 'Avatar upload error:', error);
        return respondError(res, 500, 'AVATAR_UPLOAD_FAILED', 'Failed to upload avatar');
      }
    });
  });

  // DELETE /api/v2/auth/avatar - Remove avatar
  router.delete('/avatar', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;

      // Get current avatar
      const user = await dbGet('SELECT avatar FROM users WHERE id = ?', [userId]);

      // Delete file from disk
      if (user?.avatar) {
        deleteOldAvatarFile(user.avatar);
      }

      // Set avatar to NULL
      await dbRun(
        'UPDATE users SET avatar = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [userId]
      );

      authLogger.info(`Avatar deleted for user ${userId}`);

      return respondSuccess(res, { avatar: null });
    } catch (error) {
      authLogger.error({ err: error }, 'Avatar delete error:', error);
      return respondError(res, 500, 'AVATAR_DELETE_FAILED', 'Failed to delete avatar');
    }
  });

  // PATCH /api/v2/auth/email - Change email
  router.patch('/email', requireAuth, async (req, res) => {
    try {
      const { newEmail, password } = req.body;
      const userId = req.user.id;

      if (!newEmail || !password) {
        return respondError(res, 400, 'VALIDATION_ERROR', 'New email and password are required');
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        return respondError(res, 400, 'INVALID_EMAIL', 'Invalid email format');
      }

      const bcrypt = await import('bcrypt');

      // Get current user
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);

      if (!user) {
        return respondError(res, 404, 'USER_NOT_FOUND', 'User not found');
      }

      // Verify password
      const isValidPassword = await bcrypt.default.compare(password, user.password_hash);

      if (!isValidPassword) {
        return respondError(res, 401, 'INVALID_PASSWORD', 'Password is incorrect');
      }

      // Check if email already taken
      const existingUser = await dbGet('SELECT id FROM users WHERE email = ? AND id != ?', [newEmail, userId]);

      if (existingUser) {
        return respondError(res, 409, 'EMAIL_TAKEN', 'This email is already in use');
      }

      // Update email
      await dbRun(
        'UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newEmail, userId]
      );

      return respondSuccess(res, { email: newEmail, message: 'Email updated successfully' });
    } catch (error) {
      authLogger.error({ err: error }, 'Email change error:', error);
      return respondError(res, 500, 'EMAIL_CHANGE_FAILED', 'Failed to change email');
    }
  });
}
