// Space Visibility Service - v0.001.000
// Manages space visibility levels: internal, open, external (ADR-105)
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { dbRun, dbGet, dbAll } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

/**
 * Valid visibility levels
 * - internal: visible only to explicit members (default)
 * - open:     visible to all authenticated users in the workspace
 * - external: accessible via a public_slug link, optionally password-protected
 */
const VISIBILITY_LEVELS = ['internal', 'open', 'external'];

/**
 * bcrypt salt rounds (consistent with AuthService)
 */
const SALT_ROUNDS = 10;

/**
 * Get current visibility of a space
 * @param {number} spaceId - Space ID
 * @returns {Promise<{visibility, public_slug, has_password, public_sidebar}|null>}
 *   Returns null if space not found
 */
export async function getVisibility(spaceId) {
  const space = await dbGet(
    'SELECT visibility, public_slug, public_password_hash, settings FROM spaces WHERE id = ?',
    [spaceId]
  );

  if (!space) {
    return null;
  }

  return {
    visibility: space.visibility || 'internal',
    public_slug: space.public_slug || null,
    has_password: !!space.public_password_hash,
    public_sidebar: readPublicSidebarPrefs(space.settings)
  };
}

/**
 * Parse spaces.settings JSON and extract the public_sidebar preferences with
 * defaults. Used by tree endpoint + getVisibility so the public viewer and the
 * owner settings UI agree on the canonical shape.
 *
 * Defaults: open by default (default_open=true), menu visible (hidden=false).
 */
export function readPublicSidebarPrefs(settingsText) {
  let parsed = null;
  if (settingsText) {
    if (typeof settingsText === 'string') {
      try {
        parsed = JSON.parse(settingsText);
      } catch {
        parsed = null;
      }
    } else if (typeof settingsText === 'object') {
      parsed = settingsText;
    }
  }
  const raw = parsed?.public_sidebar ?? {};
  return {
    default_open: raw.default_open !== false,
    hidden: raw.hidden === true
  };
}

/**
 * Merge new public_sidebar preferences into spaces.settings JSON.
 * Owner-edited from the External visibility panel.
 */
export async function setPublicSidebarPrefs(spaceId, prefs) {
  const space = await dbGet(
    'SELECT id, settings FROM spaces WHERE id = ?',
    [spaceId]
  );
  if (!space) {
    throw new Error('Space not found');
  }

  let current = {};
  if (space.settings) {
    if (typeof space.settings === 'string') {
      try {
        current = JSON.parse(space.settings) || {};
      } catch {
        current = {};
      }
    } else if (typeof space.settings === 'object') {
      current = { ...space.settings };
    }
  }

  const next = {
    ...current,
    public_sidebar: {
      default_open: prefs.default_open !== false,
      hidden: prefs.hidden === true
    }
  };

  await dbRun(
    'UPDATE spaces SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [JSON.stringify(next), spaceId]
  );

  return next.public_sidebar;
}

/**
 * Update space visibility
 * When setting to 'external': auto-generates public_slug if not present.
 * When changing FROM 'external' to another level: optionally clears public_slug.
 *
 * @param {number} spaceId - Space ID
 * @param {string} visibility - Target visibility level ('internal' | 'open' | 'external')
 * @param {object} [options] - Additional options
 * @param {boolean} [options.clearSlugOnDowngrade=false] - Clear public_slug when leaving 'external'
 * @param {string}  [options.customSlug] - Custom slug to use instead of auto-generated one
 * @returns {Promise<{visibility: string, public_slug: string|null, has_password: boolean}>}
 * @throws {Error} If space not found or visibility value invalid
 */
export async function setVisibility(spaceId, visibility, options = {}) {
  const { clearSlugOnDowngrade = false, customSlug } = options;

  // Validate visibility
  if (!VISIBILITY_LEVELS.includes(visibility)) {
    throw new Error(`Invalid visibility. Must be one of: ${VISIBILITY_LEVELS.join(', ')}`);
  }

  // Verify space exists and get current state
  const space = await dbGet(
    'SELECT id, name, visibility, public_slug FROM spaces WHERE id = ?',
    [spaceId]
  );

  if (!space) {
    throw new Error('Space not found');
  }

  const previousVisibility = space.visibility || 'internal';
  let newSlug = space.public_slug;

  // When setting to 'external': auto-generate slug if missing
  if (visibility === 'external' && !newSlug) {
    newSlug = customSlug || await generatePublicSlug(space.name, spaceId);
  }

  // When custom slug is provided for an external space, use it
  if (visibility === 'external' && customSlug) {
    // Validate custom slug format
    const sanitized = sanitizeSlug(customSlug);
    if (!sanitized) {
      throw new Error('Invalid custom slug: must contain at least one URL-safe character');
    }
    // Ensure uniqueness
    const existing = await dbGet(
      'SELECT id FROM spaces WHERE public_slug = ? AND id != ?',
      [sanitized, spaceId]
    );
    if (existing) {
      throw new Error('Custom slug is already in use');
    }
    newSlug = sanitized;
  }

  // When changing FROM 'external' to another level: optionally clear slug
  if (previousVisibility === 'external' && visibility !== 'external' && clearSlugOnDowngrade) {
    newSlug = null;
  }

  // Update the space
  await dbRun(
    'UPDATE spaces SET visibility = ?, public_slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [visibility, newSlug, spaceId]
  );

  apiLogger.info(
    { spaceId, from: previousVisibility, to: visibility, slug: newSlug },
    'Space visibility updated'
  );

  return getVisibility(spaceId);
}

/**
 * Generate a unique, URL-friendly slug from a space name
 *
 * Sanitises the name to lowercase ASCII + hyphens, then appends a short random
 * suffix to guarantee uniqueness across all spaces.
 *
 * @param {string} spaceName - Human-readable space name
 * @param {number} spaceId - Space ID (used to exclude self when checking uniqueness)
 * @returns {Promise<string>} Unique slug
 */
export async function generatePublicSlug(spaceName, spaceId) {
  const base = sanitizeSlug(spaceName) || 'space';

  // Append a short random suffix for uniqueness
  const suffix = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  let candidate = `${base}-${suffix}`;

  // Double-check uniqueness (collision is extremely unlikely but we guard anyway)
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const existing = await dbGet(
      'SELECT id FROM spaces WHERE public_slug = ? AND id != ?',
      [candidate, spaceId]
    );
    if (!existing) {
      return candidate;
    }
    // Regenerate on collision
    const retrySuffix = crypto.randomBytes(4).toString('hex');
    candidate = `${base}-${retrySuffix}`;
  }

  // Fallback: use spaceId to guarantee uniqueness
  return `${base}-${spaceId}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Set password protection for an external space
 * Hashes the password with bcrypt and stores in public_password_hash.
 *
 * @param {number} spaceId - Space ID
 * @param {string} password - Plain-text password to set
 * @returns {Promise<void>}
 * @throws {Error} If space not found or password is empty
 */
export async function setPassword(spaceId, password) {
  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    throw new Error('Password must be a non-empty string');
  }

  const space = await dbGet('SELECT id FROM spaces WHERE id = ?', [spaceId]);
  if (!space) {
    throw new Error('Space not found');
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  await dbRun(
    'UPDATE spaces SET public_password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [hash, spaceId]
  );

  apiLogger.info({ spaceId }, 'Space password set');
}

/**
 * Remove password protection from a space
 *
 * @param {number} spaceId - Space ID
 * @returns {Promise<void>}
 * @throws {Error} If space not found
 */
export async function removePassword(spaceId) {
  const space = await dbGet('SELECT id FROM spaces WHERE id = ?', [spaceId]);
  if (!space) {
    throw new Error('Space not found');
  }

  await dbRun(
    'UPDATE spaces SET public_password_hash = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [spaceId]
  );

  apiLogger.info({ spaceId }, 'Space password removed');
}

/**
 * Verify a password against a space's stored hash
 *
 * @param {number} spaceId - Space ID
 * @param {string} password - Plain-text password to verify
 * @returns {Promise<boolean>} true if password matches, false otherwise
 * @throws {Error} If space not found
 */
export async function verifyPassword(spaceId, password) {
  const space = await dbGet(
    'SELECT public_password_hash FROM spaces WHERE id = ?',
    [spaceId]
  );

  if (!space) {
    throw new Error('Space not found');
  }

  // No password set means no protection - always pass
  if (!space.public_password_hash) {
    return true;
  }

  if (!password || typeof password !== 'string') {
    return false;
  }

  return bcrypt.compare(password, space.public_password_hash);
}

/**
 * Get a space by its public slug (external access)
 * Only returns spaces with visibility = 'external'.
 *
 * @param {string} slug - Public slug to look up
 * @returns {Promise<object|null>} Space object (without password hash) or null
 */
export async function getPublicSpaceBySlug(slug) {
  if (!slug || typeof slug !== 'string') {
    return null;
  }

  const space = await dbGet(
    "SELECT * FROM spaces WHERE public_slug = ? AND visibility = 'external'",
    [slug]
  );

  if (!space) {
    return null;
  }

  // Strip the password hash from the response - callers should use verifyPassword()
  const { public_password_hash, ...safeSpace } = space;

  return {
    ...safeSpace,
    has_password: !!public_password_hash
  };
}

/**
 * Check if a space has 'open' visibility
 *
 * @param {number} spaceId - Space ID
 * @returns {Promise<boolean>} true if visibility is 'open'
 */
export async function isOpenSpace(spaceId) {
  const space = await dbGet(
    'SELECT visibility FROM spaces WHERE id = ?',
    [spaceId]
  );

  if (!space) {
    return false;
  }

  return space.visibility === 'open';
}

/**
 * List all spaces with 'open' visibility (for authenticated users)
 * Returns basic space info without sensitive data.
 *
 * @returns {Promise<Array<object>>} Array of open spaces
 */
export async function getOpenSpaces() {
  const spaces = await dbAll(`
    SELECT
      s.id,
      s.name,
      s.description,
      s.icon,
      s.type,
      s.theme_primary,
      s.theme_secondary,
      s.theme_tertiary,
      s.owner_id,
      s.created_at,
      s.updated_at,
      COALESCE((SELECT COUNT(*) FROM projects p WHERE p.space_id = s.id), 0) as projects_count
    FROM spaces s
    WHERE s.visibility = 'open'
    ORDER BY s.name ASC
  `);

  return spaces;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Sanitize a string into a URL-friendly slug
 * - Converts to lowercase
 * - Replaces non-alphanumeric characters with hyphens
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 * - Truncates to 60 characters (leaving room for suffix)
 *
 * @param {string} text - Raw text to sanitize
 * @returns {string} Sanitized slug (may be empty if input has no usable characters)
 */
function sanitizeSlug(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric -> hyphen
    .replace(/-+/g, '-')          // collapse consecutive hyphens
    .replace(/^-|-$/g, '')        // trim leading/trailing hyphens
    .slice(0, 60);                // cap length to leave room for suffix
}
