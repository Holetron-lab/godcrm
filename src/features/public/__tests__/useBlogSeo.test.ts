/**
 * useBlogSeo — ADR-190 Zone C. Tests the pure SEO builders that mirror the
 * backend SSR-lite contract (backend/services/blogSeo.js). The DOM hook itself
 * is exercised at the integration/crawler layer (AC-V); here we prove the
 * frozen shape matches the server field-for-field (AC-C3).
 */

import { describe, it, expect } from 'vitest';
import { buildPostSeo, buildIndexSeo } from '../useBlogSeo';
import type { BuildingInPublicPost } from '../useBuildingInPublic';

function post(overrides: Partial<BuildingInPublicPost> = {}): BuildingInPublicPost {
  return {
    id: 1,
    slug: 'factory-fallen-state',
    title: 'The Fallen State of the Factory',
    excerpt: 'How a plant loses its mind.',
    body: '# hi',
    date: '2026-08-15T16:03:11.000Z',
    tag: 'ops',
    coverUrl: 'https://cdn.godcrm.ai/cover.jpg',
    ctaUrl: 'https://godcrm.ai/demo',
    href: '/blog/factory-fallen-state',
    ...overrides,
  };
}

describe('buildPostSeo — matches server postHead (AC-C3)', () => {
  it('title carries the " — GOD CRM Blog" suffix', () => {
    expect(buildPostSeo(post()).title).toBe('The Fallen State of the Factory — GOD CRM Blog');
  });

  it('canonical = frozen prod origin, not staging', () => {
    expect(buildPostSeo(post()).canonical).toBe('https://godcrm.ai/blog/factory-fallen-state');
  });

  it('emits og:type=article, og:url=canonical, twitter:card summary_large_image', () => {
    const metas = buildPostSeo(post()).metas;
    const get = (attr: string, key: string) =>
      metas.find((m) => m.attr === attr && m.key === key)?.content;
    expect(get('property', 'og:type')).toBe('article');
    expect(get('property', 'og:url')).toBe('https://godcrm.ai/blog/factory-fallen-state');
    expect(get('name', 'twitter:card')).toBe('summary_large_image');
    expect(get('property', 'og:title')).toBe('The Fallen State of the Factory');
  });

  it('JSON-LD BlogPosting has no author, W3C date, canonical url', () => {
    const ld = buildPostSeo(post()).jsonLd as Record<string, unknown>;
    expect(ld['@type']).toBe('BlogPosting');
    expect(ld.author).toBeUndefined();
    expect(ld.datePublished).toBe('2026-08-15');
    expect(ld.url).toBe('https://godcrm.ai/blog/factory-fallen-state');
    expect(ld.mainEntityOfPage).toEqual({ '@type': 'WebPage', '@id': 'https://godcrm.ai/blog/factory-fallen-state' });
    expect(ld.publisher).toEqual({ '@type': 'Organization', name: 'GOD CRM' });
  });

  it('omits description/image/datePublished from JSON-LD when empty', () => {
    const ld = buildPostSeo(post({ excerpt: '', coverUrl: null, date: null })).jsonLd as Record<string, unknown>;
    expect('description' in ld).toBe(false);
    expect('image' in ld).toBe(false);
    expect('datePublished' in ld).toBe(false);
    expect(ld.url).toBe('https://godcrm.ai/blog/factory-fallen-state');
  });

  it('falls back to a default meta description when excerpt is empty', () => {
    const desc = buildPostSeo(post({ excerpt: '' })).metas.find((m) => m.key === 'description')?.content;
    expect(desc).toBe('A post from the GOD CRM blog.');
  });

  it('drops an unsafe (javascript:) cover URL from og:image', () => {
    const metas = buildPostSeo(post({ coverUrl: 'javascript:alert(1)' })).metas;
    expect(metas.some((m) => m.key === 'og:image')).toBe(false);
  });

  it('unparseable date → no datePublished', () => {
    const ld = buildPostSeo(post({ date: 'not-a-date' })).jsonLd as Record<string, unknown>;
    expect('datePublished' in ld).toBe(false);
  });
});

describe('buildIndexSeo — matches server indexHead', () => {
  it('title/canonical/og:type for the listing', () => {
    const seo = buildIndexSeo([post()]);
    expect(seo.title).toBe('Blog — GOD CRM');
    expect(seo.canonical).toBe('https://godcrm.ai/blog');
    expect(seo.metas.find((m) => m.key === 'og:type')?.content).toBe('website');
  });

  it('JSON-LD ItemList positions posts from 1 with absolute urls', () => {
    const ld = buildIndexSeo([post({ slug: 'a', title: 'A' }), post({ slug: 'b', title: 'B' })]).jsonLd as {
      '@type': string;
      itemListElement: Array<{ position: number; url: string; name: string }>;
    };
    expect(ld['@type']).toBe('ItemList');
    expect(ld.itemListElement[0]).toEqual({ '@type': 'ListItem', position: 1, url: 'https://godcrm.ai/blog/a', name: 'A' });
    expect(ld.itemListElement[1].position).toBe(2);
  });
});
