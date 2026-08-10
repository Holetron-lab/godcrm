/**
 * Spaces Visibility Routes (ADR-105)
 * GET /:id/visibility, PUT /:id/visibility,
 * PUT /:id/public-password, DELETE /:id/public-password,
 * PATCH /:id/public-slug (T-152460)
 */

import { dbGet, dbRun } from '../../../database/connection.js';
import { getSpaceById } from '../../../services/SpaceService.js';
import { getVisibility, setVisibility, setPassword, removePassword, setPublicSidebarPrefs } from '../../../services/SpaceVisibilityService.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, badRequest, notFound, forbidden } from '../../../utils/response.js';

/**
 * Public slug validation rules (T-152460).
 * - 3-64 chars
 * - Must start with [a-z0-9]
 * - Subsequent chars: [a-z0-9-]
 */
const PUBLIC_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,63}$/;

/**
 * Reserved slugs that cannot be assigned to a space's public_slug.
 * These collide with platform/router paths.
 */
const RESERVED_PUBLIC_SLUGS = new Set([
  'api',
  's',
  'admin',
  'login',
  'auth',
  'public',
  'static',
  'assets',
  'uploads',
  'downloads',
  'health',
  'welcome',
  'marketplace',
  'settings',
  'chat',
  'dashboard'
]);

/**
 * Helper: verify that the current user is the space owner or a system admin.
 * Returns { space, isOwner, isSysAdmin } on success, or sends an error response and returns null.
 */
export async function requireOwnerOrAdmin(req, res) {
  const spaceId = parseInt(req.params.id);
  const space = await getSpaceById(spaceId);

  if (!space) {
    notFound(res, 'Space');
    return null;
  }

  const isOwner = space.owner_id === req.user.id;
  const isSysAdmin = req.user.role === 'admin' || req.user.role === 'owner';

  // Also check space-level admin access via user_access_permissions (ADR-105)
  let isSpaceAdmin = false;
  if (!isOwner && !isSysAdmin) {
    try {
      const { dbGet } = await import('../../../database/connection.js');
      const perm = await dbGet(
        `SELECT access_level FROM user_access_permissions
         WHERE user_id = ? AND space_id = ? AND access_level IN ('admin', 'owner')`,
        [req.user.id, spaceId]
      );
      isSpaceAdmin = !!perm;
    } catch {
      // Ignore — fall through to deny
    }
  }

  if (!isOwner && !isSysAdmin && !isSpaceAdmin) {
    forbidden(res, 'Only space owner or admin can perform this action');
    return null;
  }

  return { space, isOwner, isSysAdmin };
}

export default function registerVisibilityRoutes(router) {
  /**
   * GET /spaces/:id/visibility
   * Returns the current visibility settings for a space.
   */
  router.get('/:id/visibility', async (req, res) => {
    try {
      const result = await requireOwnerOrAdmin(req, res);
      if (!result) return;

      const visibility = await getVisibility(result.space.id);

      if (!visibility) {
        return notFound(res, 'Space visibility');
      }

      success(res, visibility);
    } catch (err) {
      apiLogger.error('Error fetching space visibility:', err);
      error(res, 'FETCH_ERROR', err.message, 500);
    }
  });

  /**
   * PUT /spaces/:id/visibility
   * Update space visibility level.
   * Body: { visibility: 'internal'|'open'|'external', customSlug?, clearSlug? }
   */
  router.put('/:id/visibility', async (req, res) => {
    try {
      const result = await requireOwnerOrAdmin(req, res);
      if (!result) return;

      const { visibility, customSlug, clearSlug } = req.body;

      if (!visibility) {
        return badRequest(res, 'visibility is required', 'VALIDATION_ERROR');
      }

      const validLevels = ['internal', 'open', 'external'];
      if (!validLevels.includes(visibility)) {
        return badRequest(res, `visibility must be one of: ${validLevels.join(', ')}`, 'VALIDATION_ERROR');
      }

      const updated = await setVisibility(result.space.id, visibility, {
        customSlug,
        clearSlugOnDowngrade: !!clearSlug
      });

      success(res, updated);
    } catch (err) {
      apiLogger.error('Error updating space visibility:', err);

      if (err.message.includes('Invalid visibility') || err.message.includes('Invalid custom slug') || err.message.includes('already in use')) {
        return badRequest(res, err.message, 'VALIDATION_ERROR');
      }

      error(res, 'UPDATE_ERROR', err.message, 500);
    }
  });

  /**
   * PUT /spaces/:id/public-password
   * Set or update the public password for an external space.
   * Body: { password }
   */
  router.put('/:id/public-password', async (req, res) => {
    try {
      const result = await requireOwnerOrAdmin(req, res);
      if (!result) return;

      // Verify space is external
      const visibility = await getVisibility(result.space.id);
      if (!visibility || visibility.visibility !== 'external') {
        return badRequest(res, 'Password protection is only available for spaces with external visibility', 'VALIDATION_ERROR');
      }

      const { password } = req.body;

      if (!password || typeof password !== 'string' || password.trim().length === 0) {
        return badRequest(res, 'password is required and must be a non-empty string', 'VALIDATION_ERROR');
      }

      await setPassword(result.space.id, password);

      success(res, { message: 'Password set successfully', has_password: true });
    } catch (err) {
      apiLogger.error('Error setting space password:', err);
      error(res, 'UPDATE_ERROR', err.message, 500);
    }
  });

  /**
   * DELETE /spaces/:id/public-password
   * Remove the public password from a space.
   */
  router.delete('/:id/public-password', async (req, res) => {
    try {
      const result = await requireOwnerOrAdmin(req, res);
      if (!result) return;

      await removePassword(result.space.id);

      success(res, { message: 'Password removed successfully', has_password: false });
    } catch (err) {
      apiLogger.error('Error removing space password:', err);
      error(res, 'DELETE_ERROR', err.message, 500);
    }
  });

  /**
   * PATCH /spaces/:id/public-slug  (T-152460)
   * Rename the public_slug of a space.
   *
   * Body: { slug: string }
   *
   * Responses (exact shape per T-152460 contract):
   *   200 → { space: { ...updated row... } }
   *   400 → { error: "invalid_slug", message }
   *   409 → { error: "slug_reserved", message }
   *   409 → { error: "slug_taken",    message }
   *   401/403 → from middleware / requireOwnerOrAdmin
   *   404 → space not found
   */
  /**
   * PATCH /spaces/:id/public-sidebar
   * Owner-managed public viewer sidebar preferences.
   * Body: { default_open?: boolean, hidden?: boolean }
   * Persists into spaces.settings.public_sidebar JSON.
   */
  router.patch('/:id/public-sidebar', async (req, res) => {
    try {
      const authz = await requireOwnerOrAdmin(req, res);
      if (!authz) return;

      const { default_open, hidden } = req.body || {};

      if (default_open !== undefined && typeof default_open !== 'boolean') {
        return badRequest(res, 'default_open must be a boolean', 'VALIDATION_ERROR');
      }
      if (hidden !== undefined && typeof hidden !== 'boolean') {
        return badRequest(res, 'hidden must be a boolean', 'VALIDATION_ERROR');
      }

      const current = await getVisibility(authz.space.id);
      const merged = await setPublicSidebarPrefs(authz.space.id, {
        default_open: default_open !== undefined ? default_open : current.public_sidebar.default_open,
        hidden: hidden !== undefined ? hidden : current.public_sidebar.hidden
      });

      success(res, { public_sidebar: merged });
    } catch (err) {
      apiLogger.error('Error updating public sidebar prefs:', err);
      error(res, 'UPDATE_ERROR', err.message, 500);
    }
  });

  router.patch('/:id/public-slug', async (req, res) => {
    try {
      // Authz (owner / sys-admin / space-admin)
      const authz = await requireOwnerOrAdmin(req, res);
      if (!authz) return;

      const { slug } = req.body || {};

      // Validate slug format
      if (typeof slug !== 'string' || !PUBLIC_SLUG_REGEX.test(slug)) {
        return res.status(400).json({
          error: 'invalid_slug',
          message: 'Slug must be 3–64 chars, start with [a-z0-9], and contain only lowercase letters, digits, and hyphens.'
        });
      }

      // Reserved-words check
      if (RESERVED_PUBLIC_SLUGS.has(slug)) {
        return res.status(409).json({
          error: 'slug_reserved',
          message: `Slug "${slug}" is reserved and cannot be used.`
        });
      }

      const spaceId = authz.space.id;

      // Uniqueness pre-check (UNIQUE partial index also guards at DB level)
      const collision = await dbGet(
        'SELECT id FROM spaces WHERE public_slug = ? AND id != ?',
        [slug, spaceId]
      );
      if (collision) {
        return res.status(409).json({
          error: 'slug_taken',
          message: `Slug "${slug}" is already taken by another space.`
        });
      }

      // Persist
      try {
        await dbRun(
          'UPDATE spaces SET public_slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [slug, spaceId]
        );
      } catch (dbErr) {
        // Defense in depth: handle race against UNIQUE index
        const code = dbErr && (dbErr.code || dbErr.original?.code);
        if (code === '23505') {
          return res.status(409).json({
            error: 'slug_taken',
            message: `Slug "${slug}" is already taken by another space.`
          });
        }
        throw dbErr;
      }

      const updatedSpace = await getSpaceById(spaceId);

      apiLogger.info(
        { spaceId, newSlug: slug, actorId: req.user?.id },
        'Space public_slug renamed'
      );

      return res.status(200).json({ space: updatedSpace });
    } catch (err) {
      apiLogger.error('Error renaming space public_slug:', err);
      return res.status(500).json({
        error: 'internal_error',
        message: err.message || 'Internal server error'
      });
    }
  });
}
