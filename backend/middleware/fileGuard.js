// ADR-0016 Phase 1+2: Authenticated file delivery + per-column visibility
//
// Replaces the open `app.use('/uploads', express.static(...))` and
// `app.use('/downloads', ...)` mounts that previously served any uploaded
// file to any caller (including unauthenticated). Look up the requested
// path against the `files` table, read the owning column's
// `column.config.visibility` ('public' | 'internal' | 'private') and gate
// access:
//
//   - public   -> serve unconditionally (no JWT required)
//   - internal -> require any valid JWT
//   - private  -> require JWT AND space membership for files.space_id
//
// Files with no `column_id` (legacy / orphan / system uploads such as
// avatars) are forced to `private`. Files with no DB row at all return 404
// so unknown paths cannot leak directory listings or metadata.
//
// On `public` we skip JWT entirely; on the other two we delegate to the
// existing `authenticate` middleware (so the same JWT/cookie/API-key/query
// token sources work as for /api/v3/* routes).
//
// `mountPrefix` lets one factory power both `/uploads` and `/downloads` —
// the URL we look up in `files.url` is `<mountPrefix><req.path>` (e.g.
// `/uploads/spaces/12/foo.png`).

import { dbGet, safeJsonParse } from '../database/connection.js';
import { authenticate } from './auth.js';
import { checkUserSpaceAccess } from '../services/space/access.js';
import { apiLogger } from '../utils/logger.js';

const VALID_VISIBILITY = ['private', 'internal', 'public'];

// User avatars are uploaded straight to disk by /api/v3/auth/avatar and never
// registered in the `files` table (see backend/routes/v3/auth/profile.js).
// Without a special-case they would 404 through fileGuard. They're never
// secret (any logged-in user can see colleagues' avatars in chat lists), so
// treat the whole prefix as `internal` — JWT/cookie required, no DB row.
const PUBLIC_PREFIX_RULES = [
  { prefix: '/uploads/avatars/', visibility: 'internal' },
];

/**
 * Look up the `files` row for a request path and figure out the effective
 * visibility. Resolution order (ADR-0016 P5):
 *   1. Static prefix rules (e.g. /uploads/avatars/ -> internal, no DB lookup)
 *   2. Owning column's `config.visibility` if file.column_id is set
 *   3. file.visibility column (P5 — covers chat attachments and agent uploads)
 *   4. fallback `private`
 *
 * @param {string} fullUrl - full URL stored in files.url (e.g. "/uploads/foo.png")
 * @returns {Promise<{file: object|null, visibility: string} | null>} null only
 *   when no DB row AND no matching prefix rule (still 404 for unknown paths).
 */
export async function lookupFileVisibility(fullUrl) {
  // (1) Static prefix rules — bypass DB. fileGuard still runs auth, but we
  //     don't need a `files` row to gate a well-known asset family.
  for (const rule of PUBLIC_PREFIX_RULES) {
    if (fullUrl.startsWith(rule.prefix)) {
      return { file: null, visibility: rule.visibility };
    }
  }

  const file = await dbGet(
    'SELECT id, column_id, space_id, url, visibility FROM files WHERE url = ?',
    [fullUrl]
  );
  if (!file) return null;

  // (2) Column-bound files — column.config.visibility wins, since a column
  //     may override per-row choices made at upload time.
  if (file.column_id) {
    const column = await dbGet(
      'SELECT id, config FROM table_columns WHERE id = ?',
      [file.column_id]
    );

    let visibility = 'private';
    if (column && column.config) {
      const cfg = safeJsonParse(column.config, {}) || {};
      if (typeof cfg.visibility === 'string' && VALID_VISIBILITY.includes(cfg.visibility)) {
        visibility = cfg.visibility;
      }
    }
    return { file, visibility };
  }

  // (3) Orphan files — read files.visibility (P5). The CHECK constraint on
  //     the column guarantees the value is one of the valid ones, but we
  //     still validate defensively in case the DB was patched out-of-band.
  let visibility = 'private';
  if (typeof file.visibility === 'string' && VALID_VISIBILITY.includes(file.visibility)) {
    visibility = file.visibility;
  }
  return { file, visibility };
}

/**
 * Build the file-guard middleware for a given mount prefix.
 *
 * @param {string} mountPrefix - "/uploads" or "/downloads" — concatenated with
 *   `req.path` to reconstruct the URL that was stored in files.url
 *   on upload.
 */
export function createFileGuard(mountPrefix) {
  if (typeof mountPrefix !== 'string' || !mountPrefix.startsWith('/')) {
    throw new Error('createFileGuard: mountPrefix must start with /');
  }

  return async function fileGuard(req, res, next) {
    try {
      // req.path on a sub-mounted middleware is relative ("/foo/bar.png") —
      // recombine with the prefix to hit the same value stored at upload time.
      const fullUrl = `${mountPrefix}${req.path}`;

      const lookup = await lookupFileVisibility(fullUrl);
      if (!lookup) {
        // Unknown path — no DB row. Closed by default, matches ADR §Phase 1.
        return res.status(404).json({
          success: false,
          error: { code: 'FILE_NOT_FOUND', message: 'File not found' }
        });
      }

      const { file, visibility } = lookup;

      // PUBLIC — no auth, fall through to express.static.
      if (visibility === 'public') {
        return next();
      }

      // INTERNAL or PRIVATE — both require a valid JWT first.
      // Reuse authenticate(): on success it calls next(); on failure it
      // writes the 401 directly via `res.status().json()` and never calls
      // next(). We resolve the promise on EITHER signal so this never
      // hangs even if authenticate's contract changes.
      await new Promise((resolve, reject) => {
        // Wrap res.json so any direct write resolves the promise too.
        const origJson = res.json.bind(res);
        res.json = (...args) => {
          const r = origJson(...args);
          resolve();
          return r;
        };
        try {
          const ret = authenticate(req, res, (err) => (err ? reject(err) : resolve()));
          if (ret && typeof ret.then === 'function') {
            ret.then(() => resolve(), reject);
          }
        } catch (err) {
          reject(err);
        }
      }).catch(() => {});

      // If authenticate already responded (401), bail. headersSent is the
      // standard way to detect that without coupling to the response shape.
      if (res.headersSent) return;

      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
        });
      }

      if (visibility === 'internal') {
        return next();
      }

      // PRIVATE — JWT + space membership.
      // No DB row at all (matched via static prefix rule but flagged
      // private) — refuse: prefix rules with private visibility have no
      // space_id to gate on, so they can't satisfy the membership check.
      if (!file) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'No file metadata for this path' }
        });
      }
      // No space_id on the file row (very old uploads) — refuse: closed by
      // default, owners must re-upload under a column to share.
      if (!file.space_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'No space membership for this file' }
        });
      }

      const space = await dbGet(
        'SELECT id, type, owner_id, visibility, access_control FROM spaces WHERE id = ?',
        [file.space_id]
      );
      if (!space) {
        return res.status(404).json({
          success: false,
          error: { code: 'SPACE_NOT_FOUND', message: 'Owning space no longer exists' }
        });
      }

      const accessControl = safeJsonParse(space.access_control, null);
      const hasAccess = await checkUserSpaceAccess(
        req.user.id,
        req.user.role,
        space,
        accessControl
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'No access to this space' }
        });
      }

      return next();
    } catch (err) {
      apiLogger.error({ err, path: req.path, mountPrefix }, '[fileGuard] error');
      return res.status(500).json({
        success: false,
        error: { code: 'FILE_GUARD_ERROR', message: 'File access check failed' }
      });
    }
  };
}

// Pre-built guards for the two static mounts in server.js.
export const uploadsFileGuard = createFileGuard('/uploads');
export const downloadsFileGuard = createFileGuard('/downloads');

export { VALID_VISIBILITY };
