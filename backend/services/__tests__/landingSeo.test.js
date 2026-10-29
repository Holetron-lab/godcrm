// @vitest-environment node
/**
 * landingSeo — SSR-lite render of the marketing landing (chat 3772, GEO pack
 * docs 254978 §6 / 255025 §D.4). Pure render + host gate; no DB, no network
 * (ADR-0009). The blog helper's DB import is mocked because landingSeo pulls
 * its escaping/injection primitives from blogSeo.js.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../routes/v3/public.js', () => ({ fetchPublicRows: vi.fn() }));

const {
  loadLandingCopy, renderLandingBody, renderLandingPage,
  isLandingRequest, registerLandingSeoRoutes, MARKETING_HOSTS,
} = await import('../landingSeo.js');

const TEMPLATE = [
  '<!DOCTYPE html><html lang="en"><head>',
  '<title>GOD CRM — Not that CRM. A substrate between any model and your business</title>',
  '<meta name="description" content="landing description">',
  '<script type="application/ld+json">{"@type":"FAQPage"}</script>',
  '</head><body><div id="root"></div>',
  '<script type="module" src="/src/main.tsx"></script></body></html>',
].join('\n');

const copy = loadLandingCopy();

describe('renderLandingPage — the acceptance criterion (curl -A GPTBot gets text)', () => {
  const html = renderLandingPage(TEMPLATE, copy);

  it('fills #root with H1, the enemy, the four cards, the story, the anchor and the FAQ', () => {
    expect(html).toContain('<div id="root"><main>');
    expect(html).toContain(`<h1>${copy.hero.h1}</h1>`);
    expect(html).toContain("Every tool wants to be a tab you can&#39;t close.");
    const h3s = [...html.matchAll(/<h3>\d\d ([A-Z &]+?)<\/h3>/g)].map((m) => m[1]);
    expect(h3s.slice(0, 4)).toEqual(['CONTEXT', 'RIGHTS', 'MEMORY', 'BUILD']);
    expect(html).toContain('We changed the model about ten times while running a real company on GOD CRM: Claude, Grok');
    expect(html).toContain(copy.underTheHood.anchor.replace(/'/g, '&#39;'));
    const dts = [...html.matchAll(/<dt>(.*?)<\/dt>/g)].map((m) => m[1]);
    expect(dts).toEqual(copy.faq.items.map((i) => i.q.replace(/'/g, '&#39;')));
    expect(html).toContain('<section id="whats-broken">');
  });

  it('keeps the generic head (title/description/JSON-LD) and adds only a canonical', () => {
    expect(html).toContain('<title>GOD CRM — Not that CRM.');
    expect(html).toContain('<meta name="description" content="landing description">');
    expect(html).toContain('{"@type":"FAQPage"}');
    expect(html.match(/<link rel="canonical"/g)).toHaveLength(1);
    expect(html).toContain('<link rel="canonical" href="https://godcrm.ai/">');
  });

  it('omits the enemy link while it is null and renders the MEMORY card link (v3.2)', () => {
    expect(html).not.toContain('<a href="/blog">SEE WHICH');
    expect(html).toContain('<a href="https://rcll.ai">rcll.ai →</a>');
    const withLink = { ...copy, enemy: { ...copy.enemy, link: 'SEE →' } };
    expect(renderLandingBody(withLink)).toContain('<a href="/blog">SEE →</a>');
  });

  it('carries no team numbers and grounds "and life" (calendar, fitness module) for crawlers', () => {
    expect(html).not.toContain('agents run');
    expect(html).toContain('A substrate for business and life');
    expect(html).toContain('Tables, documents, chats, calendar and people in one database.');
    expect(html).toContain('A fitness module ships with it');
  });

  it('escapes every copy field (the JSON may become a table one day)', () => {
    const hostile = {
      ...copy,
      hero: { ...copy.hero, h1: '<script>alert(1)</script>' },
      faq: { ...copy.faq, items: [{ q: 'a<b', a: '"quoted" & more' }] },
    };
    const body = renderLandingBody(hostile);
    expect(body).not.toContain('<script>alert');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).toContain('<dt>a&lt;b</dt><dd>&quot;quoted&quot; &amp; more</dd>');
  });
});

describe('host gate — `/` only where the SPA paints the landing', () => {
  it('matches `/` on the marketing hosts and `/welcome` everywhere', () => {
    for (const hostname of MARKETING_HOSTS) {
      expect(isLandingRequest({ path: '/', hostname })).toBe(true);
    }
    expect(isLandingRequest({ path: '/', hostname: 'app.godcrm.ai' })).toBe(false);
    expect(isLandingRequest({ path: '/', hostname: 'dev.godcrm.ai' })).toBe(false);
    expect(isLandingRequest({ path: '/welcome', hostname: 'app.godcrm.ai' })).toBe(true);
    expect(isLandingRequest({ path: '/welcome', hostname: 'dev.godcrm.ai' })).toBe(true);
    expect(isLandingRequest({ path: '/spaces', hostname: 'godcrm.ai' })).toBe(false);
  });

  it('registers / and /welcome; the app host falls through, the marketing host gets HTML', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-seo-'));
    fs.writeFileSync(path.join(dist, 'index.html'), TEMPLATE);
    const routes = {};
    const app = { get: (p, h) => { routes[p] = h; } };
    registerLandingSeoRoutes(app, { clientDistPath: dist });
    expect(Object.keys(routes).sort()).toEqual(['/', '/welcome']);

    const mkRes = () => {
      const res = { headers: {}, body: null, setHeader: (k, v) => { res.headers[k] = v; }, type: () => res, send: (b) => { res.body = b; return res; } };
      return res;
    };
    const next = vi.fn();
    const appRes = mkRes();
    routes['/']({ path: '/', hostname: 'app.godcrm.ai' }, appRes, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(appRes.body).toBeNull();

    const mkRes2 = mkRes();
    routes['/']({ path: '/', hostname: 'godcrm.ai' }, mkRes2, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mkRes2.body).toContain(`<h1>${copy.hero.h1}</h1>`);
    expect(mkRes2.headers['Cache-Control']).toContain('no-store');
  });
});
