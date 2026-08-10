// backend/middleware/requestContext.js
//
// ADR-0066 P0 — Request-context middleware for `/api/v3/*`.
//
// Populates three properties on every Express request reaching `/api/v3`:
//   - req.requestId  → UUIDv4 correlating all writes inside one HTTP
//                      request (audit_log.request_id).
//   - req.spaceId    → best-effort numeric space id (audit_log.space_id).
//   - req.actingAs   → ADR-0065 placeholder. Always `null` until the
//                      ephemeral-permission-downgrade ADR ships. Wired
//                      here so writeAudit() does not need a code change
//                      when 0065 lands — only the resolver below.
//
// MUST be mounted BEFORE `authenticate` so the requestId is available
// even on auth failures (otherwise a 401 audit row has no correlation
// id). Auth-dependent fields (actingAs in the future) tolerate a
// missing req.user — the resolver short-circuits to `null`.

import { randomUUID } from 'node:crypto';

// Matches /spaces/<id> anywhere in the path (e.g. /api/v3/spaces/11,
// /api/v3/spaces/11/tables, /api/v3/spaces/11/projects/42/...).
// First numeric segment wins.
const SPACE_PATH_RE = /\/spaces\/(\d+)(?:\/|$|\?)/;

/**
 * Best-effort extraction of a numeric space id from URL / body / query.
 * Returns `null` if no plausible value found. Never throws.
 */
function resolveSpaceId(req) {
  // 1) URL path — most reliable signal.
  const pathMatch =
    req.originalUrl && SPACE_PATH_RE.exec(req.originalUrl.split('?')[0]);
  if (pathMatch) {
    const n = Number(pathMatch[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // 2) Body — `space_id`, `spaceId`, or nested `data.space_id`.
  const body = req.body;
  if (body && typeof body === 'object') {
    const candidates = [
      body.space_id,
      body.spaceId,
      body.data && body.data.space_id,
      body.data && body.data.spaceId,
    ];
    for (const v of candidates) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  // 3) Query string.
  if (req.query) {
    const n = Number(req.query.space_id ?? req.query.spaceId);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

/**
 * ADR-0065 hook — resolves the user this request is impersonating, if
 * any. Returns `null` always until ADR-0065 lands. Implementing this as
 * an async resolver (rather than a literal `null`) keeps the middleware
 * signature stable when 0065 wires `_perm_test_sessions` lookups here.
 */
// eslint-disable-next-line no-unused-vars
async function resolveActingAs(req) {
  // TODO(ADR-0065): SELECT acting_as FROM _perm_test_sessions
  //   WHERE actor_id = req.user.id AND (expires_at IS NULL OR expires_at > NOW())
  //   LIMIT 1;
  // Dead code until then — must always return null without throwing.
  return null;
}

/**
 * Express middleware. Async because resolveActingAs is async (forward-
 * looking), but the body never awaits anything that can throw — we just
 * set the three properties and call next().
 */
export async function requestContext(req, _res, next) {
  try {
    req.requestId = req.headers['x-request-id'] || randomUUID();
    req.spaceId = resolveSpaceId(req);
    req.actingAs = await resolveActingAs(req);
  } catch {
    // Defensive: if anything in the resolvers throws, the request still
    // proceeds — context fields just stay unset. writeAudit() tolerates
    // missing fields.
    req.requestId = req.requestId || randomUUID();
    if (!('spaceId' in req)) req.spaceId = null;
    if (!('actingAs' in req)) req.actingAs = null;
  }
  next();
}

export default requestContext;
