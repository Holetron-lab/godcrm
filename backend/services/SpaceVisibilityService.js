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
    public_sidebar: readPublicSidebarPrefs(space.settings),
    public_seo: readPublicSeoPrefs(space.settings)
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

// ============================================================
// ADR-190-A D1 — per-space SEO settings in spaces.settings.public_seo
// ============================================================

/**
 * Defaults used when `public_seo` is absent, empty or unparseable (AC-1).
 *
 * `indexable` / `in_sitemap` default to FALSE on purpose: publishing a space by
 * slug is a sharing decision, indexing it is a marketing decision, and they are
 * made by different people at different times (ADR-190-A D1).
 *
 * ponytail: `site_origin` and `og_image` default to '' rather than to the
 * literal values printed in the ADR-190-A shape block. The block calls them
 * "the values used when absent", but D5 mandates a three-step origin fallback
 * (space → PUBLIC_SITE_ORIGIN → compiled default) which a non-empty default
 * would make unreachable, and the documented `/og/godcrm-docs.png` asset does
 * not exist in the webroot. Empty means "not configured" and lets the chain run.
 */
const PUBLIC_SEO_DEFAULTS = Object.freeze({
  indexable: false,
  in_sitemap: false,
  site_origin: '',
  site_name: 'GOD CRM',
  title_template: '%s — GOD CRM Docs',
  default_description: 'GOD CRM documentation — spaces, tables, agents, modules and widgets.',
  og_image: '',
  default_lang: 'en'
});

/** Parse `spaces.settings`, tolerating a JSON string, an object, or garbage. */
function parseSettings(settingsText) {
  if (!settingsText) return null;
  if (typeof settingsText === 'object') return settingsText;
  if (typeof settingsText === 'string') {
    try {
      return JSON.parse(settingsText);
    } catch {
      return null;
    }
  }
  return null;
}

/** Trimmed string or the default — keeps a blank/non-string out of the head. */
function str(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Origin with trailing slashes stripped. Canonicals are built by concatenation
 * (`origin + '/s/' + slug`), so a stored `https://godcrm.ai/` would emit
 * `https://godcrm.ai//s/help` — a different URL from the one the env branch of
 * D5 emits, which trims. Normalising here keeps both branches on one address.
 */
function originStr(value, fallback) {
  return str(value, fallback).replace(/\/+$/, '');
}

/**
 * Parse `spaces.settings` and extract the public_seo preferences with defaults.
 * Same contract as readPublicSidebarPrefs: total, never throws, unknown keys
 * dropped. Single reader for getVisibility, the SSR routes and the sitemap, so
 * the guards in publicDocsSeo.js cannot drift from what the settings UI shows.
 */
export function readPublicSeoPrefs(settingsText) {
  const raw = parseSettings(settingsText)?.public_seo;
  const seo = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return {
    indexable: seo.indexable === true,
    in_sitemap: seo.in_sitemap === true,
    site_origin: originStr(seo.site_origin, PUBLIC_SEO_DEFAULTS.site_origin),
    site_name: str(seo.site_name, PUBLIC_SEO_DEFAULTS.site_name),
    title_template: str(seo.title_template, PUBLIC_SEO_DEFAULTS.title_template),
    default_description: str(seo.default_description, PUBLIC_SEO_DEFAULTS.default_description),
    og_image: str(seo.og_image, PUBLIC_SEO_DEFAULTS.og_image),
    default_lang: str(seo.default_lang, PUBLIC_SEO_DEFAULTS.default_lang)
  };
}

/**
 * Merge new public_seo preferences into spaces.settings JSON (read-modify-write,
 * so `public_sidebar` and every other sibling key survives — AC-2).
 *
 * The merge is two-level: siblings of `public_seo` survive, and so do the keys
 * *inside* it that this call did not mention. Without the inner merge a partial
 * write — the settings UI saving one toggle, or PATCH /public-seo by contract —
 * would silently reset `site_name`, `title_template` and `site_origin` to their
 * defaults, because the reader is total and fills every absent key.
 */
export async function setPublicSeoPrefs(spaceId, prefs) {
  const space = await dbGet('SELECT id, settings FROM spaces WHERE id = ?', [spaceId]);
  if (!space) {
    throw new Error('Space not found');
  }

  const current = parseSettings(space.settings) || {};
  const stored = (current.public_seo && typeof current.public_seo === 'object' && !Array.isArray(current.public_seo))
    ? current.public_seo
    : {};
  const incoming = (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) ? prefs : {};
  // Normalise through the reader so only known keys, of known types, persist.
  const next = { ...current, public_seo: readPublicSeoPrefs({ public_seo: { ...stored, ...incoming } }) };

  await dbRun(
    'UPDATE spaces SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [JSON.stringify(next), spaceId]
  );

  return next.public_seo;
}

/**
 * List every space that is allowed to appear in the sitemap (ADR-190-A D2).
 * The two hard guards live in the SQL, not in the caller: a non-external or
 * password-protected space can never be returned, whatever its config says.
 */
export async function listIndexableSpaces() {
  const spaces = await dbAll(`
    SELECT id, name, public_slug, settings
    FROM spaces
    WHERE visibility = 'external'
      AND public_password_hash IS NULL
      AND public_slug IS NOT NULL
    ORDER BY id
  `);
  return spaces
    .map(s => ({ ...s, public_seo: readPublicSeoPrefs(s.settings) }))
    .filter(s => s.public_seo.indexable);
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
