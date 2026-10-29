/**
 * Web Search / Scrape Tool Handlers
 *
 * Handles: web_search, deep_scrape
 *
 * Provider model (cost-first, ADR-0040 vault-aware):
 *   - web_search  → SearXNG (self-hosted metasearch, $0/query) is PRIMARY.
 *                   Firecrawl is an optional fallback iff a key is configured.
 *   - deep_scrape → Firecrawl if a key exists, else a native fetch+strip
 *                   fallback so the researcher pipeline never goes fully dark.
 *
 * SearXNG endpoint is resolved from the `searxng_url` vault secret /
 * SEARXNG_URL env, defaulting to the localhost container on this box.
 */

import { dbGet } from '../../database/connection.js';
import { aiLogger } from '../../utils/logger.js';
import { getSecret } from '../secrets/getSecret.js';
import { z } from 'zod';

const DEFAULT_SEARXNG_URL = 'http://127.0.0.1:8890';
// Secondary SearXNG (backup). On this box it's the DEV (.22) instance reached
// over a persistent SSH tunnel (systemd: searxng-dev-tunnel → 127.0.0.1:8891).
// Used only if the local SearXNG is down — a real metasearch fallback that
// beats scraping Bing. Empty string disables it.
const DEFAULT_SEARXNG_FALLBACK_URL = 'http://127.0.0.1:8891';

/**
 * Resolve the SearXNG base URL (no trailing slash). Vault first, env, default.
 */
async function getSearxngUrl() {
  let url = DEFAULT_SEARXNG_URL;
  try {
    url = (await getSecret('searxng_url', 'SEARXNG_URL')) || DEFAULT_SEARXNG_URL;
  } catch (err) {
    aiLogger.debug(`getSearxngUrl: secret lookup failed, using default (${err.message})`);
  }
  return url.replace(/\/+$/, '');
}

/**
 * Resolve the backup SearXNG base URL (no trailing slash), or '' if disabled.
 * Vault `searxng_fallback_url` / env `SEARXNG_FALLBACK_URL`, else the tunnel default.
 */
async function getSearxngFallbackUrl() {
  let url = DEFAULT_SEARXNG_FALLBACK_URL;
  try {
    const secret = await getSecret('searxng_fallback_url', 'SEARXNG_FALLBACK_URL');
    if (secret !== undefined && secret !== null) url = secret;
  } catch (err) {
    aiLogger.debug(`getSearxngFallbackUrl: secret lookup failed, using default (${err.message})`);
  }
  return (url || '').replace(/\/+$/, '');
}

// Firecrawl `tbs` recency tokens → SearXNG `time_range`.
const TIME_FILTER_MAP = {
  'qdr:d': 'day', 'qdr:w': 'week', 'qdr:m': 'month', 'qdr:y': 'year',
  day: 'day', week: 'week', month: 'month', year: 'year'
};

/**
 * Query SearXNG and return normalized results.
 * Throws on transport / non-2xx so callers can decide on fallback.
 */
async function searxngSearch(query, { limit = 5, timeFilter, base } = {}) {
  base = base || (await getSearxngUrl());
  const params = new URLSearchParams({ q: query, format: 'json' });
  const timeRange = timeFilter && TIME_FILTER_MAP[timeFilter];
  if (timeRange) params.set('time_range', timeRange);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let resp;
  try {
    resp = await fetch(`${base}/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(t);
  }
  if (!resp.ok) {
    throw new Error(`SearXNG returned HTTP ${resp.status} (is JSON format enabled in settings.yml?)`);
  }
  const data = await resp.json();
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows.slice(0, Math.min(limit, 20)).map((r, i) => ({
    index: i + 1,
    title: r.title || 'Untitled',
    url: r.url,
    description: r.content || '',
    ...(r.engine ? { source: r.engine } : {}),
    ...(r.publishedDate ? { published: r.publishedDate } : {})
  }));
}

// Decode the HTML entities Bing sprinkles through hrefs and snippets.
function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#0?183;/g, '·').replace(/&#0?32;/g, ' ')
    .replace(/&#x?[0-9a-f]+;/gi, ' ');
}

const stripHtml = (s) => decodeEntities((s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// Bing wraps result links as bing.com/ck/a?...&u=a1<base64url>. Unwrap to the
// real destination; return null for anything we can't resolve to an http(s) URL.
function unwrapBingUrl(href) {
  const u = decodeEntities(href);
  const m = u.match(/[?&]u=a1([^&]+)/);
  if (m) {
    try {
      let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const dec = Buffer.from(b64, 'base64').toString('utf8');
      if (/^https?:\/\//.test(dec)) return dec;
    } catch { /* fall through */ }
  }
  return /^https?:\/\//.test(u) && !/bing\.com\/ck\//.test(u) ? u : null;
}

/**
 * Last-resort native search via Bing's HTML SERP ($0, no key, no container).
 * Fires only when SearXNG is down, so a media-box reboot / docker outage no
 * longer blinds the researcher the way a missing Firecrawl key used to.
 * (DuckDuckGo's HTML endpoint anti-bot-blocks datacenter IPs — Bing doesn't.)
 * Fragile by nature (third-party HTML) — best-effort, throws on failure.
 */
async function bingSearch(query, { limit = 5 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let resp;
  try {
    resp = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en&cc=US`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(t);
  }
  if (!resp.ok) throw new Error(`Bing returned HTTP ${resp.status}`);
  const html = await resp.text();
  if (/captcha|unusual traffic|are you a robot/i.test(html)) {
    throw new Error('Bing served an anti-bot page (rate-limited)');
  }
  const results = [];
  const cap = Math.min(limit, 20);
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    if (results.length >= cap) break;
    const h = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!h) continue;
    const url = unwrapBingUrl(h[1]);
    if (!url) continue;
    const p = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    results.push({
      index: results.length + 1,
      title: stripHtml(h[2]) || 'Untitled',
      url,
      description: p ? stripHtml(p[1]).substring(0, 300) : '',
      source: 'bing'
    });
  }
  return results;
}

/**
 * Best-effort content enrichment of the top hits via native fetch+strip.
 * Parallel, never fatal — failures leave the result with its snippet only.
 */
async function enrichTopResults(results, n = 3) {
  const top = results.slice(0, Math.min(results.length, n));
  await Promise.all(top.map(async (r) => {
    try {
      const s = await nativeScrape(r.url);
      r.content = (s.content || '').substring(0, 5000);
    } catch { /* leave description only */ }
  }));
}

/**
 * Native, dependency-light scrape fallback: fetch HTML and strip to text.
 * Lower fidelity than Firecrawl, but keeps deep_scrape alive at $0.
 */
async function nativeScrape(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GodCRM-researcher/1.0)' },
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(t);
  }
  if (!resp.ok) throw new Error(`fetch returned HTTP ${resp.status}`);
  const html = await resp.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    title: titleMatch ? titleMatch[1].trim() : 'Unknown',
    description: descMatch ? descMatch[1].trim() : '',
    content: text
  };
}

/**
 * Get Firecrawl API key from database
 */
async function getFirecrawlApiKey(spaceId = null) {
  // Legacy per-space override table (ai_api_keys) is optional — it is absent on
  // vault-provisioned boxes (ADR-0040). Its absence must NOT crash the vault
  // path: a missing relation here used to throw and kill web_search entirely.
  let keyRow = null;
  try {
    if (spaceId) {
      keyRow = await dbGet(`
        SELECT api_key FROM ai_api_keys
        WHERE provider = 'firecrawl' AND is_active = 1 AND space_id = ?
        LIMIT 1
      `, [spaceId]);
    }
    if (!keyRow) {
      keyRow = await dbGet(`
        SELECT api_key FROM ai_api_keys
        WHERE provider = 'firecrawl' AND is_active = 1 AND space_id IS NULL
        LIMIT 1
      `);
    }
  } catch (err) {
    aiLogger.debug(`getFirecrawlApiKey: legacy ai_api_keys lookup skipped (${err.message})`);
  }
  // ADR-0040: vault first, env fallback during transition.
  return keyRow?.api_key || (await getSecret('firecrawl_api_key', 'FIRECRAWL_API_KEY'));
}

/**
 * Initialize Firecrawl client lazily
 */
async function getFirecrawlClient(spaceId = null) {
  const apiKey = await getFirecrawlApiKey(spaceId);
  if (!apiKey) {
    throw new Error('Firecrawl API key not configured. Add it in AI Agents → API Keys.');
  }

  // The SDK still depends on vulnerable Zod 3. Keep the two v1 HTTP contracts
  // used here, validating responses with our patched Zod instead.
  const document = z.object({
    title: z.string().nullish(), url: z.string().optional(),
    description: z.string().nullish(), markdown: z.string().nullish(),
    metadata: z.object({ title: z.string().nullish(), description: z.string().nullish() }).optional(),
    links: z.array(z.string()).optional(),
  });
  const post = async (path, body, schema) => {
    const response = await fetch(`https://api.firecrawl.dev/v1/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Firecrawl HTTP ${response.status}`);
    return schema.parse(await response.json());
  };
  return {
    search: (query, options) => post('search', z.object({
      query: z.string().min(1), limit: z.number().int().min(1).max(10), tbs: z.string().optional(),
      scrapeOptions: z.object({ formats: z.array(z.literal('markdown')) }),
    }).parse({ query, ...options }), z.object({ success: z.literal(true), data: z.array(document.extend({ url: z.string() })) })),
    scrapeUrl: (url, options) => post('scrape', z.object({
      url: z.string().url(), formats: z.array(z.literal('markdown')),
    }).parse({ url, ...options }), z.object({ success: z.literal(true), data: document })),
  };
}

/**
 * Web tool handlers
 */
export const webToolHandlers = {
  async web_search({ query, limit = 5, scrape_content = false, time_filter }, userId, context = {}) {
    // PRIMARY: SearXNG (self-hosted, $0). FALLBACK: Firecrawl iff a key exists.
    try {
      aiLogger.info({ query, limit, time_filter }, 'Executing web_search (searxng)');
      const results = await searxngSearch(query, { limit, timeFilter: time_filter });

      // Optional content enrichment for the top hits (best-effort, never fatal).
      if (scrape_content && results.length) await enrichTopResults(results);

      if (!results.length) {
        return { success: true, query, provider: 'searxng', results: [], message: 'No results found for this query.' };
      }
      return { success: true, query, provider: 'searxng', results_count: results.length, results };
    } catch (searxErr) {
      aiLogger.warn({ err: searxErr.message, query }, 'web_search: local SearXNG down, trying backup SearXNG');

      // FALLBACK 1 (free, real metasearch): backup SearXNG (DEV .22 over tunnel).
      try {
        const fallbackBase = await getSearxngFallbackUrl();
        if (fallbackBase) {
          const results = await searxngSearch(query, { limit, timeFilter: time_filter, base: fallbackBase });
          if (results.length) {
            if (scrape_content) await enrichTopResults(results);
            return {
              success: true, query, provider: 'searxng-backup', results_count: results.length, results,
              note: 'Local SearXNG was unavailable — served via backup SearXNG (DEV box).'
            };
          }
          aiLogger.warn({ query }, 'web_search: backup SearXNG returned 0 results, trying Bing');
        }
      } catch (backupErr) {
        aiLogger.warn({ err: backupErr.message, query }, 'web_search: backup SearXNG failed, trying Bing');
      }

      // FALLBACK 2 (free, no container/key): Bing HTML SERP.
      try {
        const results = await bingSearch(query, { limit });
        if (results.length) {
          if (scrape_content) await enrichTopResults(results);
          return {
            success: true, query, provider: 'bing', results_count: results.length, results,
            note: 'SearXNG was unavailable — served via free Bing HTML fallback.'
          };
        }
        aiLogger.warn({ query }, 'web_search: Bing returned 0 results, trying Firecrawl');
      } catch (bingErr) {
        aiLogger.warn({ err: bingErr.message, query }, 'web_search: Bing fallback failed, trying Firecrawl');
      }

      // FALLBACK 3 (paid, iff a key exists): Firecrawl.
      try {
        const firecrawl = await getFirecrawlClient(context.spaceId);
        const searchOptions = {
          limit: Math.min(limit, 10),
          scrapeOptions: scrape_content ? { formats: ['markdown'] } : { formats: [] }
        };
        if (time_filter) searchOptions.tbs = time_filter;

        const results = await firecrawl.search(query, searchOptions);
        if (!results?.data || results.data.length === 0) {
          return { success: true, query, provider: 'firecrawl', results: [], message: 'No results found for this query.' };
        }
        const formattedResults = results.data.map((item, index) => ({
          index: index + 1,
          title: item.title || 'Untitled',
          url: item.url,
          description: item.description || '',
          ...(scrape_content && item.markdown ? { content: item.markdown.substring(0, 5000) } : {})
        }));
        return { success: true, query, provider: 'firecrawl', results_count: formattedResults.length, results: formattedResults };
      } catch (fcErr) {
        aiLogger.error({ searxErr: searxErr.message, fcErr: fcErr.message, query }, 'web_search: all providers failed');
        return {
          error: `Web search unavailable: ${searxErr.message}`,
          hint: 'All providers failed: SearXNG (local primary), SearXNG (backup DEV .22 over tunnel), Bing (free), Firecrawl (paid, no key). Local SearXNG is the one to fix — `docker ps --filter name=searxng` and `curl 127.0.0.1:8890/search?q=test&format=json`. If the backup also failed, check the tunnel: `systemctl status searxng-dev-tunnel`. Bing failing too suggests this box lost outbound internet or Bing rate-limited it.'
        };
      }
    }
  },

  async deep_scrape({ url, include_links = false }, userId, context = {}) {
    // Firecrawl gives best fidelity (JS render). Use it ONLY if a key exists —
    // otherwise go straight to native, so the keyless $0 path is the normal case
    // (debug), not a per-call "Firecrawl failed" warn that masks real failures.
    const apiKey = await getFirecrawlApiKey(context.spaceId).catch(() => null);
    if (apiKey) {
      try {
        const firecrawl = await getFirecrawlClient(context.spaceId);

        aiLogger.info({ url, include_links }, 'Executing deep_scrape (firecrawl)');

        const result = await firecrawl.scrapeUrl(url, {
          formats: ['markdown']
        });

        if (!result?.success && !result?.markdown) {
          return {
            error: 'Failed to scrape URL',
            url,
            status: result?.statusCode || 'unknown'
          };
        }

        const content = result.markdown || result.data?.markdown || '';
        const metadata = result.metadata || result.data?.metadata || {};

        const response = {
          success: true,
          url,
          title: metadata.title || 'Unknown',
          description: metadata.description || '',
          content: content.substring(0, 15000), // Limit content size
          content_length: content.length
        };

        if (include_links && (result.links || result.data?.links)) {
          response.links = (result.links || result.data?.links || []).slice(0, 20);
        }

        return response;
      } catch (error) {
        // Key WAS present but Firecrawl genuinely failed — this is worth a warn.
        aiLogger.warn({ err: error.message, url }, 'deep_scrape: Firecrawl failed despite key, using native fallback');
      }
    } else {
      aiLogger.debug({ url }, 'deep_scrape: no Firecrawl key, using native scrape ($0)');
    }

    // Native fetch+strip fallback (no key, or Firecrawl errored).
    {
      try {
        const s = await nativeScrape(url);
        return {
          success: true,
          url,
          provider: 'native',
          title: s.title,
          description: s.description,
          content: s.content.substring(0, 15000),
          content_length: s.content.length,
          note: 'Native fetch+strip fallback (Firecrawl unavailable) — lower fidelity, no JS rendering.'
        };
      } catch (nativeErr) {
        aiLogger.error({ nativeErr: nativeErr.message, url }, 'deep_scrape: native scrape failed (and Firecrawl unavailable)');
        return {
          error: nativeErr.message,
          url,
          hint: 'URL may be blocked, require JS rendering/auth, or be unavailable. No Firecrawl key to retry with a headless renderer.'
        };
      }
    }
  }
};
