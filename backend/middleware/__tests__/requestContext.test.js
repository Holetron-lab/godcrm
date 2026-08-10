// backend/middleware/__tests__/requestContext.test.js
//
// ADR-0066 P0 — Unit tests for the request-context middleware.
//
// Pure unit test: builds fake Express req/res/next, no DB, no network.

import { describe, it, expect, vi } from 'vitest';
import { requestContext } from '../requestContext.js';

function makeReq(overrides = {}) {
  return {
    originalUrl: '/api/v3/echo',
    headers: {},
    body: undefined,
    query: undefined,
    ...overrides,
  };
}

describe('requestContext middleware (ADR-0066 P0)', () => {
  it('populates a UUID requestId when no x-request-id header is supplied', async () => {
    const req = makeReq();
    const next = vi.fn();
    await requestContext(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    // UUID v4 shape: 8-4-4-4-12 hex
    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('respects an inbound x-request-id header (trace propagation)', async () => {
    const req = makeReq({
      headers: { 'x-request-id': 'trace-from-upstream-7' },
    });
    await requestContext(req, {}, () => {});
    expect(req.requestId).toBe('trace-from-upstream-7');
  });

  it('extracts spaceId from /spaces/<id> URL path', async () => {
    const req = makeReq({ originalUrl: '/api/v3/spaces/11/tables' });
    await requestContext(req, {}, () => {});
    expect(req.spaceId).toBe(11);
  });

  it('extracts spaceId from body.space_id when URL has no spaces segment', async () => {
    const req = makeReq({
      originalUrl: '/api/v3/tables/1708/rows',
      body: { space_id: 35 },
    });
    await requestContext(req, {}, () => {});
    expect(req.spaceId).toBe(35);
  });

  it('extracts spaceId from nested body.data.space_id', async () => {
    const req = makeReq({
      originalUrl: '/api/v3/tables/1708/rows',
      body: { data: { space_id: 42 } },
    });
    await requestContext(req, {}, () => {});
    expect(req.spaceId).toBe(42);
  });

  it('returns null spaceId when no signal anywhere', async () => {
    const req = makeReq();
    await requestContext(req, {}, () => {});
    expect(req.spaceId).toBeNull();
  });

  it('always sets actingAs to null (ADR-0065 placeholder, dead code)', async () => {
    const req = makeReq();
    await requestContext(req, {}, () => {});
    expect(req.actingAs).toBeNull();
  });

  it('always calls next() exactly once even when called twice', async () => {
    const next = vi.fn();
    await requestContext(makeReq(), {}, next);
    await requestContext(makeReq(), {}, next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
