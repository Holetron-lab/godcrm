/**
 * ADR-190 Zone A — blogSeo SSR-lite render + escaping proof.
 *
 * Covers the security-critical surface (AC-A3/A4/A5 escaping) and the pure
 * render outputs (AC-A6/A7/A8). The DB helper is mocked so this stays a fast,
 * hermetic unit test — no combat-master access (ADR-0009).
 */
import { describe, it, expect, vi } from 'vitest';

// Avoid pulling the public.js → db graph; the render fns don't use it.
vi.mock('../../routes/v3/public.js', () => ({ fetchPublicRows: vi.fn() }));

const {
  esc, safeUrl, jsonLd, renderMarkdown,
  renderPostPage, renderIndexPage, renderSitemap, renderRobots,
} = await import('../blogSeo.js');

const TEMPLATE = [
  '<!DOCTYPE html><html lang="en"><head>',
  '<title>GOD CRM — the self-configuring CRM</title>',
  '<meta name="description" content="generic landing copy">',
  '<meta property="og:type" content="website">',
  '<meta property="og:title" content="GOD CRM">',
  '<meta property="og:url" content="https://godcrm.ai/">',
  '<meta name="twitter:card" content="summary_large_image">',
  '<meta name="twitter:title" content="GOD CRM">',
  '</head><body><div id="root"></div>',
  '<script type="module" src="/src/main.tsx"></script></body></html>',
].join('\n');

const POST = {
  slug: 'the-factory-floor',
  title: 'The Factory Floor',
  excerpt: 'How we rebuilt the plant.',
  body: '# Heading\n\nSome **bold** text with a [link](https://example.com).',
  date: '2026-08-10T12:00:00Z',
  tag: 'ops',
  cover: 'https://cdn.example.com/cover.png',
  ctaUrl: 'https://example.com/learn',
  url: 'https://app.godcrm.ai/blog/the-factory-floor',
};

describe('escaping helpers', () => {
  it('esc neutralises HTML metacharacters', () => {
    expect(esc('<script>&"\'')).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });
  it('safeUrl passes http(s)/root-relative, drops javascript:', () => {
    expect(safeUrl('https://x.io/a')).toBe('https://x.io/a');
    expect(safeUrl('/rel')).toBe('/rel');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,x')).toBe('');
  });
  it('jsonLd escapes < > & so it cannot break out of <script>', () => {
    const out = jsonLd({ x: '</script><img onerror=1>' });
    expect(out).not.toContain('</script>');
    expect(out).toContain('\\u003c/script');
  });
});

describe('renderMarkdown linkify scheme', () => {
  it('schemeless hosts autolink to https, not http', () => {
    expect(renderMarkdown('see godcrm.ai/s/help/mcp now'))
      .toContain('href="https://godcrm.ai/s/help/mcp"');
    expect(renderMarkdown('see www.godcrm.ai/x')).toContain('href="https://www.godcrm.ai/x"');
    expect(renderMarkdown('see godcrm.ai/s/help/mcp')).not.toContain('http://');
  });
  it('an explicitly authored scheme is preserved', () => {
    expect(renderMarkdown('http://legacy.example.com/a')).toContain('href="http://legacy.example.com/a"');
    expect(renderMarkdown('[x](http://legacy.example.com/a)')).toContain('href="http://legacy.example.com/a"');
  });
  it('mailto autolinks are untouched', () => {
    expect(renderMarkdown('write to hi@godcrm.ai')).toContain('href="mailto:hi@godcrm.ai"');
  });
});

describe('renderPostPage', () => {
  const html = renderPostPage(TEMPLATE, POST);

  it('AC-A3: per-post title replaces the generic one (only one <title>)', () => {
    expect(html).toContain('<title>The Factory Floor — GOD CRM Blog</title>');
    expect(html).not.toContain('self-configuring CRM</title>');
    expect((html.match(/<title>/g) || []).length).toBe(1);
  });
  it('AC-A3: canonical + OG point at the post, not the root', () => {
    expect(html).toContain('<link rel="canonical" href="https://app.godcrm.ai/blog/the-factory-floor">');
    expect(html).toContain('<meta property="og:url" content="https://app.godcrm.ai/blog/the-factory-floor">');
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).not.toContain('content="https://godcrm.ai/"');
    expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/cover.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });
  it('AC-A4: valid JSON-LD BlogPosting is injected', () => {
    const m = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
    expect(m).toBeTruthy();
    const ld = JSON.parse(m[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));
    expect(ld['@type']).toBe('BlogPosting');
    expect(ld.headline).toBe('The Factory Floor');
    expect(ld.datePublished).toBe('2026-08-10');
    expect(ld.mainEntityOfPage['@id']).toBe('https://app.godcrm.ai/blog/the-factory-floor');
  });
  it('AC-A5: article body rendered from markdown into #root', () => {
    expect(html).toMatch(/<div id="root"><main><article>/);
    expect(html).toContain('<h1>The Factory Floor</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.com"');
  });
  it('AC-A5: stored-XSS in body/title is neutralised', () => {
    const evil = renderPostPage(TEMPLATE, {
      ...POST,
      title: '<img src=x onerror=alert(1)>',
      body: '<script>alert(document.cookie)</script>\n\nok',
      cover: 'javascript:alert(1)',
    });
    expect(evil).not.toContain('<img src=x onerror=alert(1)>');
    expect(evil).not.toContain('<script>alert(document.cookie)</script>');
    expect(evil).toContain('&lt;script&gt;');
    // javascript: cover dropped → no og:image emitted
    expect(evil).not.toContain('og:image');
  });
});

describe('renderIndexPage (AC-A6)', () => {
  const html = renderIndexPage(TEMPLATE, [POST]);
  it('emits ItemList JSON-LD + linked titles', () => {
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('href="https://app.godcrm.ai/blog/the-factory-floor"');
    expect(html).toContain('<title>Blog — GOD CRM</title>');
  });
});

describe('renderSitemap (AC-A7)', () => {
  const xml = renderSitemap([POST]);
  it('lists the index + each post with lastmod', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<loc>https://app.godcrm.ai/blog</loc>');
    expect(xml).toContain('<loc>https://app.godcrm.ai/blog/the-factory-floor</loc>');
    expect(xml).toContain('<lastmod>2026-08-10</lastmod>');
  });
});

describe('renderRobots (AC-A8)', () => {
  it('allows all + advertises the sitemap', () => {
    expect(renderRobots()).toBe(
      'User-agent: *\nAllow: /\nSitemap: https://app.godcrm.ai/sitemap.xml\n'
    );
  });
});
