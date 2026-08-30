/**
 * ADR-190-A — docs-hub SSR-lite: guards, render output, escaping, sitemap.
 *
 * AC-4 is the test that matters: a password-protected or non-external space is
 * force-noindex and force-excluded from the sitemap EVEN WITH indexable:true.
 * AC-9 re-asserts the ADR-190 escaping contract on this new surface.
 *
 * Both the DB and the public loaders are mocked — hermetic, no master (ADR-0009).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getPublicSpaceBySlug = vi.fn();
const listIndexableSpaces = vi.fn();
const loadPublicDocumentsRegistry = vi.fn();
const loadPublicDocument = vi.fn();

// Keep the real readPublicSeoPrefs — the guard logic under test depends on it.
vi.mock('../SpaceVisibilityService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getPublicSpaceBySlug, listIndexableSpaces };
});
// blogSeo pulls fetchPublicRows from public.js; stub the whole module so the
// DB graph never loads (same trick as blogSeo.test.js).
vi.mock('../../routes/v3/public.js', () => ({
  fetchPublicRows: vi.fn(),
  loadPublicDocumentsRegistry,
  loadPublicDocument,
}));
vi.mock('../../database/connection.js', () => ({
  dbGet: vi.fn(), dbRun: vi.fn(), dbAll: vi.fn(),
}));

const mod = await import('../publicDocsSeo.js');
const {
  renderDocPage, renderHubPage, renderDocBody, collectDocsSitemapUrls,
  registerPublicDocsSeoRoutes,
} = mod;

const SEO = {
  indexable: true,
  in_sitemap: true,
  site_origin: 'https://godcrm.ai',
  site_name: 'GOD CRM',
  title_template: '%s — GOD CRM Docs',
  default_description: 'GOD CRM documentation — spaces, tables, agents, modules and widgets.',
  og_image: '/og/docs.png',
  default_lang: 'en',
};

const DOC = {
  id: 46043,
  slug: '01-what-is-god-crm',
  name: 'What is GOD CRM?',
  description: 'A CRM you describe in plain language instead of configuring.',
  status: 'published',
  seo_title: '',
  seo_description: '',
  seo_noindex: false,
  created_at: '2026-06-01T10:00:00Z',
  updated_at: '2026-06-22T10:55:38Z',
};

const ITEMS = [
  { level: 'text', content_en: 'GOD CRM is a **universal** system.', content_ru: 'Это система.' },
  { level: 'h2', content_en: 'The One-Sentence Answer', content_ru: 'Ответ' },
  { level: 'divider', content_en: '', content_ru: '' },
  { level: 'text', content_en: '', content_ru: 'Только по-русски.' },
];

const TEMPLATE = [
  '<!DOCTYPE html><html lang="en"><head>',
  '<title>GOD CRM — the self-configuring CRM</title>',
  '<meta name="description" content="generic landing copy">',
  '<meta property="og:url" content="https://godcrm.ai/">',
  '</head><body><div id="root"></div></body></html>',
].join('\n');

const ctx = (over = {}) => ({
  space: { id: 7773, name: 'GOD CRM Public', public_slug: 'help' },
  seo: SEO,
  origin: 'https://godcrm.ai',
  slug: 'help',
  doc: DOC,
  items: ITEMS,
  ...over,
});

const parseLd = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">(.+?)<\/script>/gs)].map((m) =>
    JSON.parse(m[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&')),
  );

beforeEach(() => {
  getPublicSpaceBySlug.mockReset();
  listIndexableSpaces.mockReset();
  loadPublicDocumentsRegistry.mockReset();
  loadPublicDocument.mockReset();
});

describe('renderDocPage (AC-5)', () => {
  const html = renderDocPage(TEMPLATE, ctx());

  it('replaces the generic head with per-doc title/description/canonical', () => {
    expect(html).toContain('<title>What is GOD CRM? — GOD CRM Docs</title>');
    expect(html).not.toContain('self-configuring CRM</title>');
    expect((html.match(/<title>/g) || []).length).toBe(1);
    expect(html).toContain(
      '<link rel="canonical" href="https://godcrm.ai/s/help/docs/01-what-is-god-crm">',
    );
    expect((html.match(/rel="canonical"/g) || []).length).toBe(1);
    expect(html).toContain('<meta name="description" content="A CRM you describe in plain language instead of configuring.">');
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta property="og:url" content="https://godcrm.ai/s/help/docs/01-what-is-god-crm">');
    expect(html).not.toContain('content="https://godcrm.ai/"');
  });

  it('absolutises a root-relative og:image against the resolved origin', () => {
    expect(html).toContain('<meta property="og:image" content="https://godcrm.ai/og/docs.png">');
  });

  it('emits TechArticle + BreadcrumbList JSON-LD', () => {
    const lds = parseLd(html);
    const article = lds.find((l) => l['@type'] === 'TechArticle');
    expect(article.headline).toBe('What is GOD CRM?');
    expect(article.url).toBe('https://godcrm.ai/s/help/docs/01-what-is-god-crm');
    expect(article.inLanguage).toBe('en');
    expect(article.datePublished).toBe('2026-06-01');
    expect(article.dateModified).toBe('2026-06-22');
    expect(article.isPartOf['@id']).toBe('https://godcrm.ai/s/help');
    expect(lds.find((l) => l['@type'] === 'BreadcrumbList').itemListElement).toHaveLength(3);
  });

  it('renders the body into #root and declares the served language (D6)', () => {
    expect(html).toMatch(/<div id="root"><main><article>/);
    expect(html).toContain('<h1>What is GOD CRM?</h1>');
    expect(html).toContain('<strong>universal</strong>');
    expect(html).toContain('<h2>The One-Sentence Answer</h2>');
    expect(html).toContain('<hr>');
    expect(html).not.toContain('hreflang');
    expect(html).toContain('<html lang="en">');
  });

  it('per-document overrides win over the templated defaults (D3)', () => {
    const over = renderDocPage(TEMPLATE, ctx({
      doc: { ...DOC, seo_title: 'What is GOD CRM?', seo_description: 'Custom.', seo_noindex: true },
    }));
    expect(over).toContain('<title>What is GOD CRM?</title>');
    expect(over).toContain('<meta name="description" content="Custom.">');
    expect(over).toContain('<meta name="robots" content="noindex, follow">');
  });

  it('falls back to the other language column when the served one is empty', () => {
    expect(renderDocBody(DOC, ITEMS, 'en')).toContain('Только по-русски.');
    expect(renderDocBody(DOC, ITEMS, 'ru')).toContain('Это система.');
  });
});

describe('escaping contract (AC-9)', () => {
  const evil = renderDocPage(TEMPLATE, ctx({
    doc: {
      ...DOC,
      name: '"><script>alert(1)</script>',
      description: '<img src=x onerror=alert(1)>',
    },
    seo: { ...SEO, og_image: 'javascript:alert(1)' },
    items: [{ level: 'text', content_en: '<script>alert(document.cookie)</script>\n\nok' },
      { level: 'h2', content_en: '<svg onload=alert(1)>' }],
  }));

  it('neutralises authored HTML in head, body and JSON-LD', () => {
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).not.toContain('<img src=x onerror=alert(1)>');
    expect(evil).not.toContain('<script>alert(document.cookie)</script>');
    expect(evil).not.toContain('<svg onload=alert(1)>');
    expect(evil).toContain('&lt;script&gt;');
    // Only the two ld+json blocks this module emits — no injected third.
    expect((evil.match(/<script type="application\/ld\+json">/g) || []).length).toBe(2);
    // javascript: og_image dropped by safeUrl → no og:image at all.
    expect(evil).not.toContain('og:image');
  });

  it('a `$&`-style title is inserted literally, not as a regex backref', () => {
    const html = renderDocPage(TEMPLATE, ctx({ doc: { ...DOC, name: '$& $` chapter' } }));
    expect(html).toContain('<title>$&amp; $` chapter — GOD CRM Docs</title>');
  });
});

describe('renderHubPage', () => {
  const html = renderHubPage(TEMPLATE, {
    space: { id: 7773, name: 'GOD CRM Public', public_slug: 'help' },
    seo: SEO,
    origin: 'https://godcrm.ai',
    docs: [DOC, { ...DOC, slug: '02-four-layers', name: 'The four layers' }],
  });

  it('emits CollectionPage + ItemList and links every chapter', () => {
    const collection = parseLd(html).find((l) => l['@type'] === 'CollectionPage');
    expect(collection.mainEntity['@type']).toBe('ItemList');
    expect(collection.mainEntity.itemListElement).toHaveLength(2);
    expect(collection.mainEntity.itemListElement[1].url)
      .toBe('https://godcrm.ai/s/help/docs/02-four-layers');
    expect(html).toContain('<link rel="canonical" href="https://godcrm.ai/s/help">');
    expect(html).toContain('href="https://godcrm.ai/s/help/docs/01-what-is-god-crm"');
    expect(html).toContain('<meta property="og:type" content="website">');
  });
});

describe('collectDocsSitemapUrls (AC-6)', () => {
  it('lists the hub + every published, listable doc with lastmod', async () => {
    listIndexableSpaces.mockResolvedValue([
      { id: 7773, name: 'GOD CRM Public', public_slug: 'help', public_seo: SEO },
    ]);
    loadPublicDocumentsRegistry.mockResolvedValue({
      documents: [
        DOC,
        { ...DOC, slug: 'draft-one', status: 'draft' },
        { ...DOC, slug: 'hidden-one', seo_noindex: true },
        { ...DOC, slug: '02-four-layers', updated_at: '2026-07-01T00:00:00Z' },
      ],
    });

    const urls = await collectDocsSitemapUrls();
    expect(urls.map((u) => u.loc)).toEqual([
      'https://godcrm.ai/s/help',
      'https://godcrm.ai/s/help/docs/01-what-is-god-crm',
      'https://godcrm.ai/s/help/docs/02-four-layers',
    ]);
    expect(urls[0].lastmod).toBe('2026-07-01T00:00:00Z'); // hub = newest chapter
  });

  it('skips a space that opted out of the sitemap but stays indexable', async () => {
    listIndexableSpaces.mockResolvedValue([
      { id: 1, name: 'X', public_slug: 'x', public_seo: { ...SEO, in_sitemap: false } },
    ]);
    expect(await collectDocsSitemapUrls()).toEqual([]);
    expect(loadPublicDocumentsRegistry).not.toHaveBeenCalled();
  });

  it('never throws — a failing registry contributes nothing (AC-8 safety)', async () => {
    listIndexableSpaces.mockRejectedValue(new Error('db down'));
    expect(await collectDocsSitemapUrls()).toEqual([]);
  });
});

describe('route guards (AC-4) — the test that matters', () => {
  /** Minimal Express double: records handlers, drives one through req/res/next. */
  function mount() {
    const routes = {};
    const app = { get: (path, handler) => { routes[path] = handler; } };
    registerPublicDocsSeoRoutes(app, { clientDistPath: '/nonexistent' });
    return {
      routes,
      call: async (path, params) => {
        const res = {
          _status: 200, _body: null, _headers: {},
          setHeader(k, v) { this._headers[k] = v; },
          status(s) { this._status = s; return this; },
          type() { return this; },
          send(b) { this._body = b; return this; },
        };
        let nexted = false;
        await routes[path]({ params }, res, () => { nexted = true; });
        return { res, nexted };
      },
    };
  }

  it('registers exactly the three shapes and never /s/:slug/mcp', () => {
    expect(Object.keys(mount().routes).sort())
      .toEqual(['/s/:slug', '/s/:slug/docs', '/s/:slug/docs/:docSlug']);
  });

  it('password-protected space → falls through, even with indexable:true', async () => {
    getPublicSpaceBySlug.mockResolvedValue({
      id: 7773, name: 'X', public_slug: 'help', has_password: true,
      settings: JSON.stringify({ public_seo: { indexable: true, in_sitemap: true } }),
    });
    const { nexted } = await mount().call('/s/:slug/docs/:docSlug', { slug: 'help', docSlug: 'a' });
    expect(nexted).toBe(true);
    expect(loadPublicDocumentsRegistry).not.toHaveBeenCalled();
  });

  it('non-external space → falls through (the SQL never returns it)', async () => {
    getPublicSpaceBySlug.mockResolvedValue(null);
    expect((await mount().call('/s/:slug', { slug: 'internal-space' })).nexted).toBe(true);
  });

  it('external + no password but not opted in → falls through', async () => {
    getPublicSpaceBySlug.mockResolvedValue({
      id: 7773, name: 'X', public_slug: 'help', has_password: false, settings: null,
    });
    expect((await mount().call('/s/:slug', { slug: 'help' })).nexted).toBe(true);
  });

  it('an unpublished doc inside an indexed space is never rendered', async () => {
    getPublicSpaceBySlug.mockResolvedValue({
      id: 7773, name: 'X', public_slug: 'help', has_password: false,
      settings: JSON.stringify({ public_seo: { indexable: true } }),
    });
    loadPublicDocumentsRegistry.mockResolvedValue({
      documents: [{ ...DOC, slug: 'secret-draft', status: 'draft' }],
    });
    // Template read fails on the fake dist path → handler must still not leak
    // the draft; it either 404s the shell or falls through, never renders it.
    const { res, nexted } = await mount()
      .call('/s/:slug/docs/:docSlug', { slug: 'help', docSlug: 'secret-draft' });
    expect(nexted || res._status === 404).toBe(true);
    expect(String(res._body ?? '')).not.toContain('secret-draft');
    expect(loadPublicDocument).not.toHaveBeenCalled();
  });
});
