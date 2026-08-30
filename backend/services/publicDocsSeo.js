/**
 * publicDocsSeo.js — ADR-190-A: request-time SSR-lite for a public space's
 * documentation hub (`/s/:slug`, `/s/:slug/docs`, `/s/:slug/docs/:docSlug`)
 * plus that hub's contribution to `/sitemap.xml`.
 *
 * ADR-190 did this for `/blog/*`; the docs hub has the same problem and gets
 * the same cure, built out of the same primitives — `esc`, `safeUrl`, `jsonLd`,
 * `injectHead`, `injectRoot`, `loadTemplate`, `renderMarkdown` are all imported
 * from blogSeo.js, and the data comes from the loaders public.js already
 * exports for the anonymous MCP mount. No new SQL here, no new dependency, no
 * new public API surface.
 *
 * WHAT IS DIFFERENT FROM THE BLOG: the blog is a single hard-coded table, this
 * is per-space and opt-in. Nothing is rendered unless the space passes BOTH
 * hard guards (ADR-190-A D2) and its owner has switched `indexable` on:
 *
 *   1. visibility = 'external'          (enforced in getPublicSpaceBySlug SQL)
 *   2. public_password_hash IS NULL     (a gated space must never leak to an index)
 *   3. settings.public_seo.indexable    (opt-in — sharing ≠ indexing)
 *
 * A space that fails any of them falls through to the SPA catch-all untouched,
 * so `/s/*` behaves exactly as it did before this module existed.
 *
 * SECURITY: identical contract to ADR-190. Every value below is authored
 * content and is treated as untrusted — text/attributes through `esc()`, URLs
 * through `safeUrl()`, body markdown through markdown-it with `html:false`,
 * JSON-LD through `jsonLd()`'s `</script>`-breakout escape.
 */

import {
  DEFAULT_SITE_ORIGIN,
  esc,
  safeUrl,
  jsonLd,
  isoDate,
  injectHead,
  injectRoot,
  loadTemplate,
  noCache,
  renderMarkdown,
} from './blogSeo.js';
import {
  getPublicSpaceBySlug,
  readPublicSeoPrefs,
  listIndexableSpaces,
} from './SpaceVisibilityService.js';
import { loadPublicDocumentsRegistry, loadPublicDocument } from '../routes/v3/public.js';
import { apiLogger } from '../utils/logger.js';

const log = apiLogger.child({ module: 'public-docs-seo' });

/** Meta descriptions past ~300 chars are truncated by every consumer anyway. */
const DESCRIPTION_MAX = 300;

// ── resolution ──────────────────────────────────────────────────────────────

/**
 * ADR-190-A D5 — origin resolution, in order:
 *   1. the space's own `public_seo.site_origin`,
 *   2. `process.env.PUBLIC_SITE_ORIGIN`,
 *   3. the compiled default.
 * Steps 2–3 are already folded into `DEFAULT_SITE_ORIGIN` (blogSeo.js), which
 * is why the blog cannot regress when a space sets its own origin (AC-8).
 */
function resolveOrigin(seo) {
  // Absolute http(s) only — `safeUrl` also passes root-relative paths, and a
  // space configured with `site_origin: "/"` would otherwise build `//s/help`
  // (a protocol-relative URL) as its canonical.
  const configured = /^https?:\/\//i.test(String(seo.site_origin || '').trim())
    ? safeUrl(seo.site_origin)
    : '';
  return (configured || DEFAULT_SITE_ORIGIN).replace(/\/+$/, '');
}

/**
 * The two hard guards of D2 + the opt-in, in one place. Returns
 * `{ space, seo, origin }` for a renderable space, or null — and null always
 * means "fall through to the SPA", never "error".
 */
async function resolveIndexableSpace(slug) {
  // Query is `visibility = 'external'` only — guard 1.
  const space = await getPublicSpaceBySlug(slug);
  if (!space) return null;
  // Guard 2: a password-protected space is force-noindex whatever config says.
  if (space.has_password) return null;
  const seo = readPublicSeoPrefs(space.settings);
  if (!seo.indexable) return null;
  return { space, seo, origin: resolveOrigin(seo) };
}

/** Guard 3: only `status = 'published'` rows are ever rendered (D2). */
async function loadPublishedDocs(spaceId) {
  const { documents = [] } = await loadPublicDocumentsRegistry(spaceId);
  return documents.filter((d) => d && d.status === 'published' && !!d.slug);
}

/**
 * Listable = published AND not individually opted out. `seo_noindex` keeps a
 * chapter out of the sitemap and the hub's ItemList, but the page itself still
 * renders (with `robots: noindex`) — a 404 would be a lie to a human reader.
 */
const isListable = (doc) => doc.seo_noindex !== true;

// ── copy resolution (fallback chains from D3) ───────────────────────────────

/** `title_template` carries a single `%s`. Function replacement so a `$&` in a
 *  document title is inserted literally instead of being read as a backref. */
function applyTemplate(template, value) {
  return template.includes('%s') ? template.replace('%s', () => value) : value;
}

function clamp(text, max = DESCRIPTION_MAX) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** seo_title → title_template % name → name. */
function docTitle(doc, seo) {
  if (doc.seo_title) return doc.seo_title;
  return applyTemplate(seo.title_template, doc.name || doc.slug);
}
/** seo_description → registry description → space default_description. */
function docDescription(doc, seo) {
  return clamp(doc.seo_description || doc.description || seo.default_description);
}

/** OG images must be absolute; a configured root-relative path is resolved. */
function absoluteImage(seo, origin) {
  const url = safeUrl(seo.og_image);
  if (!url) return '';
  return url.startsWith('/') ? `${origin}${url}` : url;
}

// ── head + body builders (pure — unit-tested) ──────────────────────────────

function headTags({ title, description, canonical, ogType, image, noindex, lds }) {
  return [
    noindex ? '<meta name="robots" content="noindex, follow">' : '',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="${esc(ogType)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    ...lds.map((ld) => `<script type="application/ld+json">${jsonLd(ld)}</script>`),
  ].filter(Boolean).join('\n  ');
}

/** Declare the language actually served (D6 — one indexed language, no hreflang). */
function setHtmlLang(html, lang) {
  // Both replacements take a function — `lang` is owner-configured text and a
  // `$&`/`` $` `` in it would otherwise be read as a substitution pattern.
  return html.replace(/<html\b[^>]*?\slang="[^"]*"/i, (m) =>
    m.replace(/lang="[^"]*"/i, () => `lang="${esc(lang)}"`));
}

function breadcrumbs(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: it.url,
    })),
  };
}

const publisher = (seo) => ({ '@type': 'Organization', name: seo.site_name });

export function renderDocHead({ doc, seo, origin, slug, hubUrl }) {
  const title = docTitle(doc, seo);
  const description = docDescription(doc, seo);
  const canonical = `${origin}/s/${slug}/docs/${doc.slug}`;
  const article = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: doc.seo_title || doc.name || doc.slug,
    description: description || undefined,
    url: canonical,
    inLanguage: seo.default_lang,
    datePublished: isoDate(doc.created_at) || undefined,
    dateModified: isoDate(doc.updated_at) || undefined,
    author: publisher(seo),
    publisher: publisher(seo),
    isPartOf: { '@type': 'CollectionPage', '@id': hubUrl },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
  };
  return headTags({
    title,
    description,
    canonical,
    ogType: 'article',
    image: absoluteImage(seo, origin),
    noindex: doc.seo_noindex === true,
    lds: [article, breadcrumbs([
      { name: seo.site_name, url: `${origin}/` },
      { name: 'Docs', url: hubUrl },
      { name: doc.seo_title || doc.name || doc.slug, url: canonical },
    ])],
  });
}

/**
 * Atoms → crawler-readable markup. `level` drives the tag (h1/h2/h3 headings,
 * `divider` → <hr>, everything else → a markdown-rendered paragraph block);
 * language falls back to the other column when the requested one is empty, so
 * an RU-only chapter still has a body instead of an empty <article>.
 */
export function renderDocBody(doc, items, lang) {
  const pickText = (item) => {
    const en = typeof item.content_en === 'string' ? item.content_en : '';
    const ru = typeof item.content_ru === 'string' ? item.content_ru : '';
    return (lang === 'ru' ? (ru || en) : (en || ru)).trim();
  };
  const blocks = (items || []).map((item) => {
    const level = String(item.level || 'text');
    if (level === 'divider') return '<hr>';
    const text = pickText(item);
    if (!text) return '';
    if (level === 'h1' || level === 'h2' || level === 'h3') {
      return `<${level}>${esc(text)}</${level}>`;
    }
    return renderMarkdown(text);
  }).filter(Boolean).join('');

  return '<main><article>'
    + `<h1>${esc(doc.seo_title || doc.name || doc.slug)}</h1>`
    + (doc.description ? `<p>${esc(clamp(doc.description))}</p>` : '')
    + blocks
    + '</article></main>';
}

export function renderHubHead({ space, seo, origin, docs }) {
  const hubUrl = `${origin}/s/${space.public_slug}`;
  const title = applyTemplate(seo.title_template, space.name || seo.site_name);
  const description = clamp(seo.default_description);
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': hubUrl,
    name: title,
    description: description || undefined,
    url: hubUrl,
    inLanguage: seo.default_lang,
    publisher: publisher(seo),
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: docs.map((d, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: d.seo_title || d.name || d.slug,
        url: `${hubUrl}/docs/${d.slug}`,
      })),
    },
  };
  return headTags({
    title,
    description,
    canonical: hubUrl,
    ogType: 'website',
    image: absoluteImage(seo, origin),
    noindex: false,
    lds: [collection, breadcrumbs([
      { name: seo.site_name, url: `${origin}/` },
      { name: 'Docs', url: hubUrl },
    ])],
  });
}

export function renderHubBody({ space, seo, origin, docs }) {
  const hubUrl = `${origin}/s/${space.public_slug}`;
  const items = docs.map((d) => {
    const url = `${hubUrl}/docs/${d.slug}`;
    return `<li><a href="${esc(url)}"><h2>${esc(d.seo_title || d.name || d.slug)}</h2></a>`
      + (d.description ? `<p>${esc(clamp(d.description, 200))}</p>` : '')
      + '</li>';
  }).join('');
  return `<main><h1>${esc(applyTemplate(seo.title_template, space.name || seo.site_name))}</h1>`
    + `<nav><ul>${items}</ul></nav></main>`;
}

/** Inject per-document <head> + article body into the SPA template. */
export function renderDocPage(template, ctx) {
  const { doc, seo, origin, slug, items } = ctx;
  const hubUrl = `${origin}/s/${slug}`;
  return setHtmlLang(
    injectRoot(
      injectHead(template, renderDocHead({ doc, seo, origin, slug, hubUrl })),
      renderDocBody(doc, items, seo.default_lang),
    ),
    seo.default_lang,
  );
}

/** Inject hub <head> + chapter list into the SPA template. */
export function renderHubPage(template, ctx) {
  return setHtmlLang(
    injectRoot(injectHead(template, renderHubHead(ctx)), renderHubBody(ctx)),
    ctx.seo.default_lang,
  );
}

// ── sitemap contribution ────────────────────────────────────────────────────

/**
 * `[{ loc, lastmod }]` for every opted-in space's hub + published documents.
 * Injected into blogSeo's `/sitemap.xml` by server.js (AC-6). Returns [] on any
 * failure — the blog sitemap must not go down because a docs registry did.
 */
export async function collectDocsSitemapUrls() {
  const urls = [];
  try {
    for (const space of await listIndexableSpaces()) {
      if (!space.public_seo.in_sitemap) continue;
      try {
        const docs = (await loadPublishedDocs(space.id)).filter(isListable);
        const origin = resolveOrigin(space.public_seo);
        const hub = `${origin}/s/${space.public_slug}`;
        const newest = docs
          .map((d) => d.updated_at)
          .sort((a, b) => String(b).localeCompare(String(a)))[0] || '';
        urls.push({ loc: hub, lastmod: newest });
        for (const doc of docs) {
          urls.push({ loc: `${hub}/docs/${doc.slug}`, lastmod: doc.updated_at });
        }
      } catch (err) {
        log.error({ err, spaceId: space.id }, 'sitemap: skipping space');
      }
    }
  } catch (err) {
    log.error({ err }, 'sitemap: listIndexableSpaces failed — contributing nothing');
  }
  return urls;
}

// ── Express wiring ──────────────────────────────────────────────────────────

/**
 * Register the docs SSR-lite routes. Must be called BEFORE the SPA static mount
 * and the `app.get('*')` catch-all, and AFTER the `/s/:slug/mcp` alias (which
 * these routes must never swallow — they only match the three exact shapes).
 *
 * Every non-renderable case calls `next()`, so an unknown/gated/opted-out space
 * reaches the SPA exactly as it did before.
 */
export function registerPublicDocsSeoRoutes(app, { clientDistPath }) {
  const sendHtml = (res, html, status = 200) => {
    noCache(res);
    res.status(status).type('html').send(html);
  };

  const hub = async (req, res, next) => {
    try {
      const ctx = await resolveIndexableSpace(req.params.slug);
      if (!ctx) return next();
      const docs = (await loadPublishedDocs(ctx.space.id)).filter(isListable);
      sendHtml(res, renderHubPage(loadTemplate(clientDistPath), { ...ctx, docs }));
    } catch (err) {
      log.error({ err, slug: req.params.slug }, 'GET /s/:slug (hub) failed — falling through to SPA');
      next();
    }
  };

  app.get('/s/:slug', hub);
  app.get('/s/:slug/docs', hub);

  app.get('/s/:slug/docs/:docSlug', async (req, res, next) => {
    const { slug, docSlug } = req.params;
    try {
      const ctx = await resolveIndexableSpace(slug);
      if (!ctx) return next();

      // Resolve through the registry (not loadPublicDocument) so `status`,
      // `seo_noindex` and the SEO overrides are applied before anything renders.
      const doc = (await loadPublishedDocs(ctx.space.id)).find((d) => d.slug === docSlug);
      // Unknown/unpublished slug inside an indexed space → SPA shell, 404
      // (same contract as ADR-190 AC-A2: the human still gets the 404 UI).
      if (!doc) return sendHtml(res, loadTemplate(clientDistPath), 404);

      const content = await loadPublicDocument(ctx.space.id, doc.slug);
      const items = content ? content.items : [];
      sendHtml(res, renderDocPage(loadTemplate(clientDistPath), { ...ctx, slug, doc, items }));
    } catch (err) {
      log.error({ err, slug, docSlug }, 'GET /s/:slug/docs/:docSlug failed — falling through to SPA');
      next();
    }
  });
}
