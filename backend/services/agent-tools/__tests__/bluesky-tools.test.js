// @vitest-environment node
/**
 * Unit guard for the Bluesky amplifier-graph handler (Austin recon stack).
 *
 * Pins:
 *  - auth flow: createSession on the PDS → bearer → searchPosts on the AppView
 *  - normalization: pain text + amplifier metrics + author graph node + permalink
 *  - 401 → re-auth-once-and-retry (accessJwt expiry path)
 *  - missing creds → clean "not configured" error (no 400 dump)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getSecret = vi.fn();
vi.mock('../../secrets/getSecret.js', () => ({
  getSecret: (...a) => getSecret(...a),
}));

const { blueskyToolHandlers, __resetBlueskySessionForTests } = await import('../bluesky-tools.js');
const { bluesky_search } = blueskyToolHandlers;

const SESSION_OK = {
  ok: true,
  status: 200,
  json: async () => ({ accessJwt: 'jwt-abc', did: 'did:plc:me', handle: 'me.bsky.social' }),
};

function searchResponse(posts, { status = 200, cursor } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ posts, ...(cursor ? { cursor } : {}) }),
    text: async () => JSON.stringify({ posts }),
  };
}

const SAMPLE_POST = {
  uri: 'at://did:plc:author/app.bsky.feed.post/3kabc',
  author: { handle: 'amplifier.bsky.social', displayName: 'Amp', did: 'did:plc:author' },
  record: { text: '  bioinformatics pipelines are pain  ', createdAt: '2026-06-10T12:00:00Z', langs: ['en'] },
  likeCount: 42,
  repostCount: 7,
  replyCount: 3,
  quoteCount: 1,
  indexedAt: '2026-06-10T12:01:00Z',
};

beforeEach(() => {
  getSecret.mockReset();
  __resetBlueskySessionForTests();
  // default: creds present
  getSecret.mockImplementation(async (key) =>
    key === 'bluesky_handle' ? 'me.bsky.social' : 'app-pass-1234'
  );
});

describe('bluesky_search', () => {
  it('authenticates via the PDS then searches the AppView, normalizing amplifier signal', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(SESSION_OK) // createSession
      .mockResolvedValueOnce(searchResponse([SAMPLE_POST], { cursor: 'next' })); // searchPosts
    vi.stubGlobal('fetch', fetchMock);

    const out = await bluesky_search({ query: 'bioinformatics pain' });

    // first call = createSession on the PDS, POST with the app-password
    const [sessionUrl, sessionInit] = fetchMock.mock.calls[0];
    expect(sessionUrl).toMatch(/bsky\.social\/xrpc\/com\.atproto\.server\.createSession/);
    expect(sessionInit.method).toBe('POST');
    expect(JSON.parse(sessionInit.body)).toEqual({ identifier: 'me.bsky.social', password: 'app-pass-1234' });

    // second call = searchPosts on the AppView, bearer from the session
    const [searchUrl, searchInit] = fetchMock.mock.calls[1];
    expect(searchUrl).toMatch(/api\.bsky\.app\/xrpc\/app\.bsky\.feed\.searchPosts/);
    expect(searchUrl).toMatch(/sort=top/);
    expect(searchInit.headers.Authorization).toBe('Bearer jwt-abc');

    expect(out.success).toBe(true);
    expect(out.provider).toBe('bluesky');
    expect(out.cursor).toBe('next');
    const r = out.results[0];
    expect(r.text).toBe('bioinformatics pipelines are pain'); // trimmed
    expect(r.author.handle).toBe('amplifier.bsky.social');
    expect(r.amplifier).toEqual({ likes: 42, reposts: 7, replies: 3, quotes: 1 });
    expect(r.url).toBe('https://bsky.app/profile/amplifier.bsky.social/post/3kabc');
    expect(r.langs).toEqual(['en']);
  });

  it('caps limit at 100 and forwards sort=latest', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(SESSION_OK)
      .mockResolvedValueOnce(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await bluesky_search({ query: 'x', limit: 9999, sort: 'latest' });
    const searchUrl = fetchMock.mock.calls[1][0];
    expect(searchUrl).toMatch(/limit=100/);
    expect(searchUrl).toMatch(/sort=latest/);
  });

  it('re-authenticates once on a 401 and retries the search', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(SESSION_OK) // createSession #1
      .mockResolvedValueOnce(searchResponse([], { status: 401 })) // search → expired
      .mockResolvedValueOnce(SESSION_OK) // createSession #2 (forced)
      .mockResolvedValueOnce(searchResponse([SAMPLE_POST])); // search retry ok
    vi.stubGlobal('fetch', fetchMock);

    const out = await bluesky_search({ query: 'pain' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(out.success).toBe(true);
    expect(out.results_count).toBe(1);
  });

  it('returns a clean "not configured" error when creds are absent', async () => {
    getSecret.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await bluesky_search({ query: 'pain' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.error).toMatch(/not configured/i);
    expect(out.hint).toMatch(/seed-bluesky-secrets/);
  });

  it('rejects an empty query before any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await bluesky_search({ query: '   ' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.error).toMatch(/non-empty/);
  });
});
