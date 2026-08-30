/**
 * Reddit Tool Handler — read-only pain-mining over public Reddit posts.
 *
 * Handles: reddit_search
 *
 * Feeds the `reddit-roast` skill (sibling to `mom-roast`): mine recurring
 * user pains from public posts, quote the source, weigh by engagement. This
 * tool is READ-ONLY by design — no posting, no DMs, no writes. The business
 * Reddit account used for manual outreach DMs is kept entirely separate from
 * this data path.
 *
 * Why a managed provider instead of Reddit's own OAuth API:
 *   Reddit killed self-service API keys (Nov 2025) and now gates every new
 *   OAuth app behind a manual Responsible Builder Policy review. Additionally,
 *   this box's datacenter IP is reputation-flagged, so hitting reddit.com
 *   directly (or the public `.json`) returns 400/403. We instead read through a
 *   managed data provider (redditapis.com) that already holds approved access
 *   and returns clean JSON — same grey-market resale risk-shape as the
 *   TwitterAPI.io / Tweet Radar stack (ADR-152), consciously accepted there and
 *   here.
 *
 * Credentials live in the `_secrets` vault (ADR-0040): `reddit_api_key`
 * (env fallback `REDDIT_API_KEY`), read via getSecret. Bearer-token auth.
 *
 * Endpoint shape (validated live 2026-07-15/16):
 *   GET https://api.redditapis.com/api/reddit/search
 *   Authorization: Bearer <reddit_api_key>
 *   query params: q (required), subreddit, limit, sort, t, after
 *   → 200 { posts: [...], after: <cursor> }
 *   per-post fields: title, text, subreddit, author, upvotes, comments,
 *                    upvote_ratio, permalink, url, created, created_utc, ...
 */

import { aiLogger } from '../../utils/logger.js';
import { getSecret } from '../secrets/getSecret.js';

// Managed Reddit data provider — replaces the need for our own OAuth app
// (Responsible Builder gate bypassed). Same risk-shape as TwitterAPI.io.
const REDDIT_API_BASE = 'https://api.redditapis.com';

const VALID_SORTS = new Set(['relevance', 'hot', 'top', 'new', 'comments']);
const VALID_TIMES = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);

const log = aiLogger.child ? aiLogger.child({ module: 'reddit_tools' }) : aiLogger;

/** Resolve the provider key: vault first (ADR-0040), env fallback in transition. */
async function getRedditApiKey() {
  return getSecret('reddit_api_key', 'REDDIT_API_KEY');
}

/** GET /api/reddit/search on the managed provider. Returns the raw fetch Response. */
async function searchRaw(apiKey, { query, subreddit, limit, sort, t, after }) {
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(Math.max(Number(limit) || 25, 1), 100)),
  });
  if (subreddit) params.set('subreddit', String(subreddit).replace(/^\/?r\//i, '').trim());
  if (sort) params.set('sort', sort);
  if (t) params.set('t', t);
  if (after) params.set('after', after);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(`${REDDIT_API_BASE}/api/reddit/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** permalink ("/r/sub/comments/…") → an absolute reddit.com URL. */
function toRedditUrl(post) {
  if (post?.url) return post.url;
  const pl = post?.permalink;
  if (pl) return `https://reddit.com${pl.startsWith('/') ? '' : '/'}${pl}`;
  return null;
}

/** Shape one search hit into { pain text, engagement, author, source link }. */
function normalizePost(post, i) {
  return {
    index: i + 1,
    id: post?.name || post?.id || null, // fullname (t3_…) — reuse as `after` cursor
    subreddit: post?.subreddit || null,
    title: String(post?.title || '').trim(),
    text: String(post?.text || '').trim(), // selftext — the pain
    author: post?.author || null,
    engagement: {
      upvotes: post?.upvotes ?? 0,
      comments: post?.comments ?? 0,
      upvote_ratio: post?.upvote_ratio ?? null,
    },
    created_at: post?.created || null, // ISO8601
    created_utc: post?.created_utc ?? null,
    url: toRedditUrl(post),
    ...(post?.over_18 ? { over_18: true } : {}),
    ...(post?.link_url ? { link_url: post.link_url } : {}), // external link if not a self-post
  };
}

export const redditToolHandlers = {
  /**
   * Search PUBLIC Reddit posts and return pain text + engagement + author +
   * source permalink. sort="top" + t="week"/"month" surfaces the hottest recent
   * pain; sort="new" is recency-first. Read-only — never posts or DMs.
   */
  async reddit_search({ query, subreddit, limit = 25, sort, t, after }, userId, context = {}) {
    if (!query || !String(query).trim()) {
      return { error: 'reddit_search requires a non-empty `query`.' };
    }
    const normSort = sort && VALID_SORTS.has(sort) ? sort : undefined;
    const normTime = t && VALID_TIMES.has(t) ? t : undefined;

    let apiKey;
    try {
      apiKey = await getRedditApiKey();
    } catch (err) {
      log.error({ err: err.message }, 'reddit_search: getSecret failed');
      apiKey = null;
    }
    if (!apiKey) {
      return {
        error: 'Reddit search is not configured.',
        hint: 'Seed `reddit_api_key` into the _secrets vault (ADR-0040) via owner Settings → Secrets (env fallback: REDDIT_API_KEY), then retry.',
      };
    }

    try {
      const resp = await searchRaw(apiKey, {
        query: String(query).trim(),
        subreddit,
        limit,
        sort: normSort,
        t: normTime,
        after,
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`search HTTP ${resp.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }

      const data = await resp.json();
      const posts = Array.isArray(data?.posts) ? data.posts : [];
      const results = posts.map((p, i) => normalizePost(p, i));

      if (!results.length) {
        return {
          success: true,
          query,
          provider: 'redditapis',
          ...(subreddit ? { subreddit } : {}),
          ...(normSort ? { sort: normSort } : {}),
          results_count: 0,
          results: [],
          message: 'No public posts matched this query.',
        };
      }
      return {
        success: true,
        query,
        provider: 'redditapis',
        ...(subreddit ? { subreddit } : {}),
        ...(normSort ? { sort: normSort } : {}),
        ...(normTime ? { t: normTime } : {}),
        results_count: results.length,
        results,
        ...(data.after ? { after: data.after } : {}), // pagination cursor
      };
    } catch (err) {
      log.error({ err: err.message, query }, 'reddit_search failed');
      return {
        error: `Reddit search failed: ${err.message}`,
        hint: 'A 401/403 usually means the reddit_api_key is invalid/rotated — check the provider dashboard (redditapis.com) and reseed the vault. A 429 is provider rate-limiting; back off and retry.',
      };
    }
  },
};

export default redditToolHandlers;
