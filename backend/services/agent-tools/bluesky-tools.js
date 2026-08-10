/**
 * Bluesky (AT Protocol) Tool Handler — amplifier-graph social-listening.
 *
 * Handles: bluesky_search
 *
 * Part of the "Austin recon" kosher social-listening stack (see
 * /root/austin-recon/README.md + HANDOFF-ralph.md). Purpose is dual-use —
 * research / integrity / due-diligence: discover *pains* and map *who amplifies
 * them* from PUBLIC posts only. ZERO surveillance, zero person-deanon (no
 * face/geo/IP/breach/username-enumeration — that whole half is cut at the gate).
 *
 * Why authenticated, not the public AppView:
 *   This box's datacenter IP is reputation-flagged — unauthenticated
 *   `public.api.bsky.app` search returns 403. The PDS (`bsky.social`) is
 *   reachable (200), so we authenticate with an app-password via
 *   `com.atproto.server.createSession` → bearer, then call
 *   `app.bsky.feed.searchPosts` on the AppView with that token.
 *
 * Credentials live in the `_secrets` vault (ADR-0040):
 *   `bluesky_handle` / `bluesky_app_password`. The app-password is revocable and
 *   cannot change the account password/email or delete the account — if it
 *   leaks, blast radius is read-only public search.
 *
 * Amplifier signal returned per post: likeCount / repostCount / replyCount /
 * quoteCount; graph node = author.handle.
 */

import { aiLogger } from '../../utils/logger.js';
import { getSecret } from '../secrets/getSecret.js';

// PDS — issues the session (app-password auth). Reachable from this box.
const PDS_BASE = 'https://bsky.social';
// AppView — serves the search index. `api.bsky.app` accepts the PDS bearer;
// `public.api.bsky.app` (unauth) is 403 from this IP, so we never use it.
const APPVIEW_BASE = 'https://api.bsky.app';

// accessJwt is valid ~2h; re-auth defensively well before that. A 401 also
// forces a re-auth regardless (see bluesky_search), so this is just a ceiling.
const SESSION_TTL_MS = 90 * 60 * 1000;

// In-module session cache (per worker process). createSession with an
// app-password is cheap and unmetered, so we don't bother with refreshJwt.
let sessionCache = null; // { accessJwt, did, handle, createdAt }

const log = aiLogger.child ? aiLogger.child({ module: 'bluesky_tools' }) : aiLogger;

/** Resolve creds: vault first (ADR-0040), env fallback during transition. */
async function getBlueskyCreds() {
  const handle = await getSecret('bluesky_handle', 'BLUESKY_HANDLE');
  const appPassword = await getSecret('bluesky_app_password', 'BLUESKY_APP_PASSWORD');
  return { handle, appPassword };
}

/** POST com.atproto.server.createSession → { accessJwt, did, handle }. */
async function createSession(handle, appPassword) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let resp;
  try {
    resp = await fetch(`${PDS_BASE}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    // Most common real failure: AuthFactorTokenRequired / Invalid identifier or
    // password (wrong app-password, or main password used by mistake).
    throw new Error(`createSession HTTP ${resp.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const data = await resp.json();
  if (!data?.accessJwt) throw new Error('createSession returned no accessJwt');
  return { accessJwt: data.accessJwt, did: data.did, handle: data.handle, createdAt: Date.now() };
}

/**
 * Get a live session, reusing the cache unless `force` or TTL-expired.
 * Throws a coded error (BLUESKY_NO_CREDS) when the vault/env has no creds so the
 * handler can surface a clean "not configured" message instead of a 400 dump.
 */
async function getSession({ force = false } = {}) {
  if (!force && sessionCache && Date.now() - sessionCache.createdAt < SESSION_TTL_MS) {
    return sessionCache;
  }
  const { handle, appPassword } = await getBlueskyCreds();
  if (!handle || !appPassword) {
    const err = new Error('Bluesky credentials not configured');
    err.code = 'BLUESKY_NO_CREDS';
    throw err;
  }
  sessionCache = await createSession(handle, appPassword);
  log.info({ handle: sessionCache.handle }, 'bluesky: session established');
  return sessionCache;
}

/** GET app.bsky.feed.searchPosts on the AppView. Returns the raw fetch Response. */
async function searchPostsRaw(query, { limit, sort, since, until }, accessJwt) {
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(Math.max(Number(limit) || 25, 1), 100)),
  });
  if (sort) params.set('sort', sort); // 'top' | 'latest'
  if (since) params.set('since', since); // ISO8601 (indexedAt lower bound)
  if (until) params.set('until', until);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(`${APPVIEW_BASE}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessJwt}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** at://did/app.bsky.feed.post/<rkey> → a clickable bsky.app permalink. */
function toBskyAppUrl(post) {
  const handle = post?.author?.handle;
  const m = String(post?.uri || '').match(/\/app\.bsky\.feed\.post\/([^/]+)$/);
  if (handle && m) return `https://bsky.app/profile/${handle}/post/${m[1]}`;
  return null;
}

/** Shape one searchPosts hit into { pain text, amplifier metrics, graph node }. */
function normalizePost(post, i) {
  const rec = post?.record || {};
  return {
    index: i + 1,
    uri: post?.uri || null,
    text: String(rec.text || '').trim(), // pain
    created_at: rec.createdAt || post?.indexedAt || null,
    author: {
      handle: post?.author?.handle || null, // amplifier graph node
      display_name: post?.author?.displayName || null,
      did: post?.author?.did || null,
    },
    amplifier: {
      likes: post?.likeCount ?? 0,
      reposts: post?.repostCount ?? 0,
      replies: post?.replyCount ?? 0,
      quotes: post?.quoteCount ?? 0,
    },
    url: toBskyAppUrl(post),
    ...(Array.isArray(rec?.langs) ? { langs: rec.langs } : {}),
  };
}

export const blueskyToolHandlers = {
  /**
   * Search PUBLIC Bluesky posts and return pain text + amplifier metrics +
   * author graph node. Sort 'top' ranks by engagement (best for "who amplifies
   * this"); 'latest' is recency-first.
   */
  async bluesky_search({ query, limit = 25, sort = 'top', since, until }, userId, context = {}) {
    if (!query || !String(query).trim()) {
      return { error: 'bluesky_search requires a non-empty `query`.' };
    }
    const normSort = sort === 'latest' ? 'latest' : 'top';
    try {
      let session = await getSession();
      let resp = await searchPostsRaw(query, { limit, sort: normSort, since, until }, session.accessJwt);

      // accessJwt may have expired (ExpiredToken) — re-auth once and retry.
      if (resp.status === 401) {
        log.info('bluesky_search: 401 — re-authenticating and retrying');
        session = await getSession({ force: true });
        resp = await searchPostsRaw(query, { limit, sort: normSort, since, until }, session.accessJwt);
      }

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`searchPosts HTTP ${resp.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }

      const data = await resp.json();
      const posts = Array.isArray(data?.posts) ? data.posts : [];
      const results = posts.map((p, i) => normalizePost(p, i));

      if (!results.length) {
        return { success: true, query, provider: 'bluesky', sort: normSort, results_count: 0, results: [], message: 'No public posts matched this query.' };
      }
      return {
        success: true,
        query,
        provider: 'bluesky',
        sort: normSort,
        results_count: results.length,
        results,
        ...(data.cursor ? { cursor: data.cursor } : {}),
      };
    } catch (err) {
      if (err?.code === 'BLUESKY_NO_CREDS') {
        return {
          error: 'Bluesky amplifier graph is not configured.',
          hint: 'Seed `bluesky_handle` + `bluesky_app_password` into the _secrets vault (ADR-0040), e.g. `node backend/scripts/seed-bluesky-secrets.mjs <handle> <app-password>`, then retry.',
        };
      }
      log.error({ err: err.message, query }, 'bluesky_search failed');
      return {
        error: `Bluesky search failed: ${err.message}`,
        hint: 'If this is a 403, the box IP may be hard-blocked on the unauth AppView — this tool authenticates via the PDS to avoid that. A 400 on createSession usually means a wrong/expired app-password (rotate in Bluesky → Settings → App Passwords, reseed the vault).',
      };
    }
  },
};

// Test-only: reset the in-module session cache between cases.
export function __resetBlueskySessionForTests() {
  sessionCache = null;
}

export default blueskyToolHandlers;
