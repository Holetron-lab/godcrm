/**
 * landingSeo.js — request-time SSR-lite for the marketing landing: `/` on the
 * marketing hosts (godcrm.ai, www.godcrm.ai) and `/welcome` on every host.
 *
 * ADR-190 did this for /blog/*, ADR-190-A for the public docs hub; the landing
 * had the same hole (GEO audit, chat 3772, doc 254978 §1/§6): a crawler that
 * does not run JS got <title> + two JSON-LD blocks and no text. Same cure,
 * same primitives — `esc`, `injectRoot`, `loadTemplate`, `noCache` come from
 * blogSeo.js. No data source: the copy is the committed
 * `shared/landing-copy.json`, the SAME file src/pages/landing/LandingPage.tsx
 * renders for humans, so the two surfaces cannot drift. React mounts on top
 * (createRoot → replaces the server markup; progressive enhancement, Zone C).
 *
 * The generic <head> is kept: index.html already carries the landing's
 * title/description/OG/Organization/SoftwareApplication/FAQPage, so only a
 * canonical is added here — the SPA shell has none, and `/welcome` must point
 * at the apex.
 *
 * Host gate: `/` is the landing only where the SPA's RootIndex would render it
 * (src/shared/utils/marketingBounce.ts MARKETING_HOSTS). On app hosts `/` is
 * the workspace entry and falls through to the SPA untouched.
 *
 * SECURITY: the copy is committed, not authored at runtime, but it goes through
 * `esc()` anyway — the module must stay safe if the JSON ever becomes a table.
 */

import { readFileSync } from 'fs';
import { esc, injectRoot, loadTemplate, noCache } from './blogSeo.js';
import { apiLogger } from '../utils/logger.js';

const log = apiLogger.child({ module: 'landing-seo' });

/** Mirror of MARKETING_HOSTS in src/shared/utils/marketingBounce.ts. */
export const MARKETING_HOSTS = ['godcrm.ai', 'www.godcrm.ai'];
const CANONICAL = 'https://godcrm.ai/';

const COPY_URL = new URL('../../shared/landing-copy.json', import.meta.url);
export function loadLandingCopy() {
  return JSON.parse(readFileSync(COPY_URL, 'utf8'));
}

// ── pure render (unit-tested) ───────────────────────────────────────────────

/** `{pre, glow, post}` → one plain sentence (the glow is a visual, not a word). */
const headline = (h) => esc(`${h.pre}${h.glow}${h.post}`);

const section = (id, title, inner) =>
  `<section${id ? ` id="${esc(id)}"` : ''}><h2>${esc(title)}</h2>${inner}</section>`;

const cards = (items, render) => items.map(render).join('');

export function renderLandingBody(copy) {
  const { hero, enemy, inside, story, connect, build, underTheHood, broken, faq, finalCta, footer } = copy;
  const swapQuote = `${story.swapQuote.pre}${story.modelSwaps}${story.swapQuote.post}`;
  const ctaLinks = `<p><a href="${esc(copy.sourceRepoUrl)}">Self-host GOD CRM</a> · <a href="/s/help">Read the docs</a></p>`;

  return '<main>'
    + `<header><p>${esc(hero.kicker)}</p><h1>${esc(hero.h1)}</h1><p>${esc(hero.thesis)}</p>${ctaLinks}<p>${esc(hero.tags)}</p></header>`
    + section('', enemy.title,
      `<p>${headline(enemy.headline)}</p><p>${esc(enemy.body)}</p>`
      + (enemy.link ? `<p><a href="/blog">${esc(enemy.link)}</a></p>` : ''))
    + section('inside', inside.title,
      `<p>${headline(inside.headline)}</p><p>${esc(inside.kicker)}</p>`
      + cards(inside.cards, (c) => `<article><h3>${esc(c.num)} ${esc(c.label)}</h3><p>${esc(c.body)}</p>`
        + (c.link ? `<p><a href="${esc(c.link.href)}">${esc(c.link.label)}</a></p>` : '') + '</article>')
      + `<p>${esc(inside.outro)}</p>`)
    + section('', story.title,
      `<p>${headline(story.headline)}</p><p>${esc(story.body)}</p>`
      + `<p>${esc(swapQuote)} ${esc(story.conclusion)}</p><p>${esc(story.credit)}</p>`)
    + section('connect-mcp', connect.title,
      `<p>${headline(connect.headline)}</p><p>${esc(connect.body)}</p>`
      + `<p>Endpoint: <code>${esc(copy.mcpEndpoint)}</code></p>`
      + `<pre><code>claude mcp add --transport http godcrm ${esc(copy.mcpEndpoint)}</code></pre>`
      + `<p>${esc(connect.note)}</p>`)
    + section('', build.title,
      `<p>${headline(build.headline)}</p><table><thead><tr>`
      + `<th>${esc(build.columns.need)}</th><th>${esc(build.columns.widgets)}</th><th>${esc(build.columns.code)}</th>`
      + '</tr></thead><tbody>'
      + cards(build.rows, (r) => `<tr><th scope="row">${esc(r.need)}</th><td>${esc(r.widgets)}</td><td>${esc(r.code)}</td></tr>`)
      + `</tbody></table><p>${esc(build.outro)}</p>`)
    + section('', underTheHood.title,
      `<p>${headline(underTheHood.headline)}</p>`
      + cards(underTheHood.cards, (c) => `<article><h3>${esc(c.num)} ${esc(c.label)} (${esc(c.tag)})</h3><p>${esc(c.body)}</p><p>${esc(c.long)}</p></article>`)
      + `<p>${esc(underTheHood.anchor)}</p>`)
    + section('whats-broken', broken.title,
      `<p>${headline(broken.headline)}</p><p>${esc(broken.body)}</p><ul>`
      + cards(broken.items, (i) => `<li>${esc(i)}</li>`)
      + '</ul>')
    + section('faq', faq.title,
      `<p>${headline(faq.headline)}</p><dl>`
      + cards(faq.items, (i) => `<dt>${esc(i.q)}</dt><dd>${esc(i.a)}</dd>`)
      + '</dl>')
    + section('', finalCta.title,
      `<p>${headline(finalCta.headline)}</p><p>${esc(finalCta.body)}</p>${ctaLinks}`)
    + `<footer><p>${esc(footer.copyright)}</p>${cards(footer.lines, (l) => `<p>${esc(l)}</p>`)}<p><a href="/blog">Blog</a></p></footer>`
    + '</main>';
}

/** Add the canonical only — the rest of the generic <head> IS the landing's head. */
function injectCanonical(html) {
  return html.replace(/<\/head>/i, () => `  <link rel="canonical" href="${CANONICAL}">\n</head>`);
}

export function renderLandingPage(template, copy = loadLandingCopy()) {
  return injectCanonical(injectRoot(template, renderLandingBody(copy)));
}

/** `/welcome` anywhere; `/` only where the SPA itself paints the landing. */
export function isLandingRequest(req, hosts = MARKETING_HOSTS) {
  if (req.path === '/welcome') return true;
  return req.path === '/' && hosts.includes(String(req.hostname || '').toLowerCase());
}

// ── Express wiring ──────────────────────────────────────────────────────────

/**
 * Register the landing SSR-lite routes. Must be called BEFORE the SPA static
 * mount (express.static serves dist/index.html for `/` itself) and the
 * `app.get('*')` catch-all. Every non-landing or failing case calls `next()`.
 */
export function registerLandingSeoRoutes(app, { clientDistPath, hosts = MARKETING_HOSTS }) {
  let copy = null;
  const handler = (req, res, next) => {
    if (!isLandingRequest(req, hosts)) return next();
    try {
      copy = copy || loadLandingCopy();
      noCache(res);
      res.type('html').send(renderLandingPage(loadTemplate(clientDistPath), copy));
    } catch (err) {
      log.error({ err, path: req.path }, 'landing SSR-lite failed — falling through to SPA');
      next();
    }
  };
  app.get('/', handler);
  app.get('/welcome', handler);
}
