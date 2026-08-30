/**
 * blogSeo.js — ADR-190: request-time SSR-lite for /blog/* + sitemap/robots.
 *
 * The marketing blog lives at SPA routes /blog and /blog/:slug. nginx hands
 * crawlers the static dist/index.html (a ~2.6 KB generic shell) because every
 * per-post <title>, meta, canonical, OG and article body is injected
 * client-side after React hydration (src/features/public/usePublicSeo.ts).
 * Bots that do not execute JS see nothing → the blog is invisible to search.
 *
 * This module intercepts /blog, /blog/:slug, /sitemap.xml and /robots.txt
 * BEFORE the SPA catch-all (backend/server.js `app.get('*')`), reads the
 * already-public published mirror (table 100245, space `s/help`) via the shared
 * public read helper (fetchPublicRows — no new SQL, no new API), and injects a
 * crawler-readable <head> (title/description/canonical/OG/twitter) + JSON-LD
 * BlogPosting + the rendered article body into the index.html template. React
 * still mounts on top for humans (progressive enhancement, Zone C).
 *
 * SECURITY (ADR-190 §Consequences — HARD, non-negotiable): every row-derived
 * value is authored content and is treated as untrusted. Text/attributes are
 * HTML-escaped (`esc`); URLs are scheme-filtered (`safeUrl` → http(s) or
 * root-relative only); the markdown body is rendered with markdown-it
 * `html:false` (raw HTML escaped, javascript:/vbscript:/data: links blocked by
 * markdown-it's default validateLink); JSON-LD is escaped against a
 * `</script>` breakout. No new markdown dependency — markdown-it already ships
 * in package.json.
 */

import fs from 'fs';
import path from 'path';
import MarkdownIt from 'markdown-it';
import { fetchPublicRows } from '../routes/v3/public.js';
import { apiLogger } from '../utils/logger.js';

/** Published-post mirror table (s/help space). See useBuildingInPublic.ts. */
const BLOG_TABLE_ID = 100245;
/**
 * Canonical origin for absolute URLs (AC-A3). Overridable for staging.
 * Exported as `DEFAULT_SITE_ORIGIN` because ADR-190-A D5 makes the origin
 * per-space data: `public_seo.site_origin` → `PUBLIC_SITE_ORIGIN` → this.
 * The blog itself is not space-scoped, so it stays on steps 2–3 (AC-8).
 */
const SITE_ORIGIN = (process.env.PUBLIC_SITE_ORIGIN || 'https://app.godcrm.ai').replace(/\/+$/, '');
export const DEFAULT_SITE_ORIGIN = SITE_ORIGIN;
const SITE_NAME = 'GOD CRM';

const log = apiLogger.child({ module: 'blog-seo' });

// html:false → raw HTML inside a post body is escaped, not executed;
// markdown-it's default validateLink blocks javascript:/vbscript:/data: URIs.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

// linkify-it prepends `http://` to every schemeless match (`godcrm.ai/s/help/mcp`,
// `www.foo.bar`). On an https page that ships crawlers an insecure href that only
// resolves through a 301 — for our own CTAs the redirect is a downgrade signal, and
// the SPA (react-markdown + remark-gfm) does not autolink schemeless hosts at all,
// so the two surfaces disagreed. Default schemeless autolinks to https instead;
// an explicitly authored `http://…` keeps its scheme (match.schema is non-empty).
const linkifyNormalize = md.linkify.normalize.bind(md.linkify);
md.linkify.normalize = (match) => {
  linkifyNormalize(match);
  if (!match.schema && match.url.startsWith('http://')) {
    match.url = `https://${match.url.slice('http://'.length)}`;
  }
};

/**
 * Render authored markdown to HTML under the ADR-190 escaping contract.
 * Exported so publicDocsSeo renders document atoms through the *same*
 * configured instance — a second `new MarkdownIt()` elsewhere is exactly how
 * `html:false` gets silently dropped on one surface (ADR-190-A AC-9).
 */
export function renderMarkdown(text) {
  return md.render(String(text ?? ''));
}

// ── escaping helpers ────────────────────────────────────────────────────────
const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** HTML-escape a value for use in text or a double-quoted attribute. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);
}
/** Only allow http(s) or root-relative URLs in href/src/canonical; else ''. */
export function safeUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
  return '';
}
/** JSON-LD payload: neutralise the chars that could break out of <script>. */
export function jsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
/** ISO date (YYYY-MM-DD) or '' if unparseable — used for <lastmod>. */
export function isoDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// ── row → post shape (mirrors src/features/public/useBuildingInPublic.ts) ────
function rowToPost(row) {
  const d = (row && row.data) || {};
  const slug = typeof d.slug === 'string' ? d.slug : '';
  if (!slug) return null;
  const str = (v) => (typeof v === 'string' ? v : '');
  return {
    id: row.id,
    slug,
    title: str(d.title) || slug,
    excerpt: str(d.excerpt),
    body: str(d.body),
    date: (typeof d.date === 'string' && d.date) ? d.date : (row.updated_at || row.created_at || null),
    tag: str(d.tag) || null,
    cover: safeUrl(d.cover),
    ctaUrl: safeUrl(d.cta_url),
    url: `${SITE_ORIGIN}/blog/${slug}`,
  };
}

/** Load all published posts via the shared public helper, newest first. */
async function loadPosts() {
  const { rows } = await fetchPublicRows(BLOG_TABLE_ID, { limit: 500, offset: 0 });
  return rows
    .map(rowToPost)
    .filter(Boolean)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// ── HTML template surgery (pure — unit-tested) ──────────────────────────────
// Duplicate <title>/og:* → most crawlers use the FIRST occurrence, so the
// generic SPA tags must be removed before the per-post ones are injected.
function stripGenericSeo(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name=["']description["'][^>]*>/i, '')
    .replace(/<meta\s+property=["']og:(title|description|url|type)["'][^>]*>/gi, '')
    .replace(/<meta\s+name=["']twitter:(card|title|description)["'][^>]*>/gi, '');
}
/**
 * Replace the generic SPA head tags with `headHtml`. Shared with publicDocsSeo.
 *
 * The replacement is a FUNCTION, not a string: `headHtml` is built from authored
 * content, and in a string replacement `$&`, `` $` `` and `$'` are substitution
 * patterns. A post (or document) titled with `` $` `` would otherwise splice the
 * whole preceding document back into its own <head>. `esc()` does not — and
 * should not — escape `$`, so the defence belongs here.
 */
export function injectHead(html, headHtml) {
  return stripGenericSeo(html).replace(/<\/head>/i, () => `  ${headHtml}\n</head>`);
}
/** Fill the empty SPA mount point with crawler-readable markup. */
export function injectRoot(html, bodyHtml) {
  return html.replace(/<div id="root">\s*<\/div>/i, () => `<div id="root">${bodyHtml}</div>`);
}

function postHead(post) {
  const title = `${post.title} — ${SITE_NAME} Blog`;
  const desc = post.excerpt || `A post from the ${SITE_NAME} blog.`;
  const canonical = post.url;
  // Re-sanitise here so the injector is self-defending regardless of caller.
  const image = safeUrl(post.cover);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt || undefined,
    datePublished: isoDate(post.date) || undefined,
    image: image || undefined,
    url: canonical,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    publisher: { '@type': 'Organization', name: SITE_NAME },
  };
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(post.title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(post.title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<script type="application/ld+json">${jsonLd(ld)}</script>`,
  ].filter(Boolean).join('\n  ');
}

function postBody(post) {
  const bodyHtml = post.body
    ? md.render(post.body)
    : (post.excerpt ? `<p>${esc(post.excerpt)}</p>` : '');
  const coverUrl = safeUrl(post.cover);
  const cover = coverUrl ? `<img src="${esc(coverUrl)}" alt="">` : '';
  const ctaUrl = safeUrl(post.ctaUrl);
  const cta = ctaUrl
    ? `<p><a href="${esc(ctaUrl)}" rel="noopener noreferrer">Learn more →</a></p>`
    : '';
  const meta = [post.date ? esc(post.date) : '', post.tag ? esc(post.tag) : '']
    .filter(Boolean).join(' · ');
  return '<main><article>'
    + (meta ? `<p>${meta}</p>` : '')
    + `<h1>${esc(post.title)}</h1>`
    + cover
    + bodyHtml
    + cta
    + '</article></main>';
}

function indexHead(posts) {
  const title = `Blog — ${SITE_NAME}`;
  const desc = `Notes from building ${SITE_NAME} in the open.`;
  const canonical = `${SITE_ORIGIN}/blog`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: posts.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: p.url,
      name: p.title,
    })),
  };
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<script type="application/ld+json">${jsonLd(ld)}</script>`,
  ].join('\n  ');
}

function indexBody(posts) {
  const items = posts.map((p) =>
    `<li><a href="${esc(p.url)}"><h2>${esc(p.title)}</h2></a>`
    + (p.excerpt ? `<p>${esc(p.excerpt)}</p>` : '')
    + '</li>'
  ).join('');
  return `<main><h1>${esc(SITE_NAME)} Blog</h1><ul>${items}</ul></main>`;
}

/** Inject per-post <head> + article body into the SPA template. */
export function renderPostPage(template, post) {
  return injectRoot(injectHead(template, postHead(post)), postBody(post));
}
/** Inject listing <head> + ItemList body into the SPA template. */
export function renderIndexPage(template, posts) {
  return injectRoot(injectHead(template, indexHead(posts)), indexBody(posts));
}
/**
 * sitemap.xml listing the /blog index + every published post (AC-A7), plus any
 * `extraUrls` contributed by another module (ADR-190-A: opted-in public-space
 * docs). With no extras the output is byte-identical to ADR-190 (AC-8).
 */
export function renderSitemap(posts, extraUrls = []) {
  const urls = [
    { loc: `${SITE_ORIGIN}/blog`, lastmod: posts[0] ? posts[0].date : '' },
    ...posts.map((p) => ({ loc: p.url, lastmod: p.date })),
    ...extraUrls,
  ];
  const body = urls.map(({ loc, lastmod }) => {
    const lm = isoDate(lastmod);
    return `  <url><loc>${esc(loc)}</loc>${lm ? `<lastmod>${lm}</lastmod>` : ''}</url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
/** robots.txt allowing all + advertising the sitemap (AC-A8). */
export function renderRobots() {
  return `User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

// ── Express wiring ──────────────────────────────────────────────────────────
let _templateCache = null;
/** Read (and cache) the built SPA shell. Shared with publicDocsSeo. */
export function loadTemplate(clientDistPath) {
  if (_templateCache) return _templateCache;
  _templateCache = fs.readFileSync(path.join(clientDistPath, 'index.html'), 'utf8');
  return _templateCache;
}
export function noCache(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

/**
 * Register the SSR-lite + sitemap/robots routes on the Express app. Must be
 * called BEFORE the SPA static mount + `app.get('*')` catch-all (AC-A1).
 *
 * `extraSitemapUrls` (optional) is an async `() => [{ loc, lastmod }]` provider
 * so another module can contribute URLs without owning /sitemap.xml. Injected
 * by server.js rather than imported here — publicDocsSeo imports *from* this
 * module, and a back-import would close a cycle (ADR-190-A D4).
 */
export function registerBlogSeoRoutes(app, { clientDistPath, extraSitemapUrls = null }) {
  const spaShell = (res, status = 200) => {
    // Human clients still get the SPA (client-side render / 404 UI).
    noCache(res);
    res.status(status).type('html').send(loadTemplate(clientDistPath));
  };

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(renderRobots());
  });

  app.get('/sitemap.xml', async (req, res) => {
    try {
      const posts = await loadPosts();
      // A failing contributor must not take the blog sitemap down with it.
      let extra = [];
      if (extraSitemapUrls) {
        try {
          extra = await extraSitemapUrls();
        } catch (err) {
          log.error({ err }, 'sitemap contributor failed — serving blog URLs only');
        }
      }
      res.type('application/xml').send(renderSitemap(posts, extra));
    } catch (err) {
      log.error({ err }, 'GET /sitemap.xml failed');
      res.status(500).type('text/plain').send('sitemap unavailable');
    }
  });

  app.get('/blog', async (req, res) => {
    try {
      const posts = await loadPosts();
      noCache(res);
      res.type('html').send(renderIndexPage(loadTemplate(clientDistPath), posts));
    } catch (err) {
      log.error({ err }, 'GET /blog failed — falling back to SPA shell');
      spaShell(res);
    }
  });

  app.get('/blog/:slug', async (req, res) => {
    try {
      const posts = await loadPosts();
      const post = posts.find((p) => p.slug === req.params.slug);
      // AC-A2: unknown slug → 404, but still the SPA shell (human 404 UI).
      if (!post) return spaShell(res, 404);
      noCache(res);
      res.type('html').send(renderPostPage(loadTemplate(clientDistPath), post));
    } catch (err) {
      log.error({ err, slug: req.params.slug }, 'GET /blog/:slug failed — falling back to SPA shell');
      spaShell(res);
    }
  });
}
