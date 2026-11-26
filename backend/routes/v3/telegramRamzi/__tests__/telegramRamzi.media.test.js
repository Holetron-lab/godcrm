// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSearxngUrl: vi.fn(),
  getSearxngFallbackUrl: vi.fn(),
}));

vi.mock('../../../../services/agent-tools/web-tools.js', () => ({
  getSearxngUrl: mocks.getSearxngUrl,
  getSearxngFallbackUrl: mocks.getSearxngFallbackUrl,
}));

const { extractRecipeDish, searchRecipeImage, searchRecipeVideos } = await import('../media.js');

function response({ status = 200, body = {}, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: { cancel: vi.fn(async () => {}) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.getSearxngUrl.mockResolvedValue('http://searxng-primary:8890');
  mocks.getSearxngFallbackUrl.mockResolvedValue('http://searxng-fallback:8891');
});

describe('Ramzi recipe media search', () => {
  it('extracts a dish only from the explicit recipe heading', () => {
    expect(extractRecipeDish('🍽 Блюдо: Курица терияки с рисом\n\nИнгредиенты')).toBe('Курица терияки с рисом');
    expect(extractRecipeDish('Уточните, пожалуйста, на сколько порций?')).toBeNull();
    expect(extractRecipeDish('Название: Курица терияки')).toBeNull();
  });

  it('skips invalid, oversized and non-image candidates and checks at most five', async () => {
    const results = [
      { img_src: 'file:///tmp/recipe.jpg' },
      { img_src: 'https://img.test/html.jpg' },
      { img_src: 'https://img.test/large.jpg' },
      { img_src: 'https://img.test/good.webp' },
      { img_src: 'https://img.test/unused.jpg' },
      { img_src: 'https://img.test/sixth.jpg' },
    ];
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url.startsWith('http://searxng-primary')) {
        const query = new URL(url).searchParams;
        expect(query.get('q')).toBe('!ddi !pin Курица терияки рецепт');
        expect(query.get('format')).toBe('json');
        expect(query.get('categories')).toBe('images');
        return response({ body: { results } });
      }
      expect(options.method).toBe('HEAD');
      if (url.endsWith('html.jpg')) return response({ headers: { 'content-type': 'text/html' } });
      if (url.endsWith('large.jpg')) {
        return response({ headers: { 'content-type': 'image/jpeg', 'content-length': String(5 * 1024 * 1024 + 1) } });
      }
      return response({ headers: { 'content-type': 'image/webp', 'content-length': '1024' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchRecipeImage('Курица терияки')).resolves.toBe('https://img.test/good.webp');
    expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('https://img.test/'))).toHaveLength(3);
  });

  it('falls back to a ranged GET after HEAD 405 and returns null when search fails', async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url.startsWith('http://searxng-primary')) throw new Error('primary unavailable');
      if (url.startsWith('http://searxng-fallback')) {
        return response({ body: { results: [{ img_src: 'https://img.test/range.png' }] } });
      }
      if (options.method === 'HEAD') return response({ status: 405 });
      expect(options.method).toBe('GET');
      expect(options.headers.Range).toBe('bytes=0-0');
      return response({
        status: 206,
        headers: { 'content-type': 'image/png', 'content-length': '1', 'content-range': 'bytes 0-0/2048' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchRecipeImage('Суп')).resolves.toBe('https://img.test/range.png');

    mocks.getSearxngFallbackUrl.mockResolvedValue('');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(searchRecipeImage('Суп')).resolves.toBeNull();
  });

  it('ranks three video links by dish-name match and returns an empty list on failure', async () => {
    const fetchMock = vi.fn(async (url) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('q')).toBe('!yt как приготовить Курица терияки');
      expect(parsed.searchParams.get('categories')).toBe('videos');
      return response({ body: { results: [
        { title: 'Лучшие рецепты ужина', url: 'https://youtube.com/watch?v=other' },
        { title: 'Курица терияки за 20 минут', url: 'https://youtube.com/watch?v=best' },
        { title: 'Терияки: базовый соус', url: 'https://youtube.com/watch?v=third' },
        { title: 'Курица терияки с рисом', url: 'https://youtube.com/watch?v=fourth' },
      ] } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchRecipeVideos('Курица терияки')).resolves.toEqual([
      { title: 'Курица терияки за 20 минут', url: 'https://youtube.com/watch?v=best' },
      { title: 'Терияки: базовый соус', url: 'https://youtube.com/watch?v=third' },
      { title: 'Лучшие рецепты ужина', url: 'https://youtube.com/watch?v=other' },
    ]);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(searchRecipeVideos('Курица терияки')).resolves.toEqual([]);
  });
});
