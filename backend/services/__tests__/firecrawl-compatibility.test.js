// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../database/connection.js', () => ({ dbGet: vi.fn(async () => ({ api_key: 'test-only' })) }));
vi.mock('../secrets/getSecret.js', () => ({ getSecret: vi.fn(async () => null) }));
// Prevent the old SDK from ever reaching the network during the RED run.
vi.mock('axios', () => ({ default: { post: vi.fn(async () => { throw new Error('SDK disabled in test'); }) } }));
import { webToolHandlers } from '../agent-tools/web-tools.js';

afterEach(() => vi.unstubAllGlobals());

it('preserves Firecrawl search request options and result projection', async () => {
  const fetch = vi.fn(async (url) => {
    if (url !== 'https://api.firecrawl.dev/v1/search') throw new Error('offline fallback');
    return Response.json({ success: true, data: [{ title: 'Title', url: 'https://example.test', description: 'About', markdown: 'Text' }] });
  });
  vi.stubGlobal('fetch', fetch);
  const result = await webToolHandlers.web_search({ query: 'test', limit: 20, scrape_content: true, time_filter: 'qdr:d' }, 1);
  expect(result).toMatchObject({ success: true, provider: 'firecrawl', results_count: 1, results: [{ title: 'Title', content: 'Text' }] });
  const [, options] = fetch.mock.calls.find(([url]) => url.includes('firecrawl'));
  expect(JSON.parse(options.body)).toEqual({ query: 'test', limit: 10, scrapeOptions: { formats: ['markdown'] }, tbs: 'qdr:d' });
  expect(options.headers.Authorization).toBe('Bearer test-only');
});

it('preserves scrape metadata, links and content limits', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: {
    markdown: 'x'.repeat(16000), metadata: { title: 'Title', description: 'About' }, links: ['https://example.test']
  } })));
  const result = await webToolHandlers.deep_scrape({ url: 'https://example.test', include_links: true }, 1);
  expect(result).toMatchObject({ success: true, title: 'Title', content_length: 16000, links: ['https://example.test'] });
  expect(result.content).toHaveLength(15000);
});

it.each([Response.json({ success: true, data: [{ url: 42 }] }), Response.json({ error: 'bad' }, { status: 429 })])(
  'fails closed on malformed or failed Firecrawl search responses', async response => {
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (!url.includes('api.firecrawl.dev')) throw new Error('offline fallback');
      return response;
    }));
    expect(await webToolHandlers.web_search({ query: 'test' }, 1)).toHaveProperty('error');
  }
);
