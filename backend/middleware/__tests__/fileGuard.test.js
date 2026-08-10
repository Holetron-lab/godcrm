// ADR-0016 Phase 1+2 + Phase 5 — fileGuard middleware unit tests.
//
// Covers the visibility decisions:
//   - public                       -> serve without auth
//   - internal                     -> require valid JWT (user present on req)
//   - private + member             -> serve
//   - private + outsider           -> 403
//   - orphan (no col, P5):
//        files.visibility=internal -> require JWT, no space check
//        files.visibility=public   -> serve without auth
//        files.visibility=private  -> JWT + space check
//   - avatar prefix (P5)           -> internal (no DB lookup needed)
//   - unknown path                 -> 404
//
// We mock the database layer and the `authenticate` middleware so the
// middleware's branching logic is exercised in isolation.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection.js', () => ({
  dbGet: vi.fn(),
  safeJsonParse: (v, d = null) => {
    if (v === null || v === undefined) return d;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return d; }
  }
}));

vi.mock('../auth.js', () => ({
  authenticate: vi.fn((req, res, next) => next())
}));

vi.mock('../../services/space/access.js', () => ({
  checkUserSpaceAccess: vi.fn()
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

import { dbGet } from '../../database/connection.js';
import { authenticate } from '../auth.js';
import { checkUserSpaceAccess } from '../../services/space/access.js';
import { createFileGuard } from '../fileGuard.js';

function makeRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    body: null,
    headers: {}
  };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((b) => { res.body = b; res.headersSent = true; return res; });
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v; });
  return res;
}

describe('fileGuard (ADR-0016)', () => {
  let guard;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = createFileGuard('/uploads');
  });

  it('returns 404 when there is no `files` row for the path', async () => {
    dbGet.mockResolvedValueOnce(null); // files lookup
    const req = { path: '/spaces/1/missing.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(dbGet).toHaveBeenCalledWith(
      'SELECT id, column_id, space_id, url, visibility FROM files WHERE url = ?',
      ['/uploads/spaces/1/missing.png']
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe('FILE_NOT_FOUND');
    expect(next).not.toHaveBeenCalled();
  });

  it('serves PUBLIC files without auth', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 1, column_id: 7, space_id: 12, url: '/uploads/foo.png' })  // file
      .mockResolvedValueOnce({ id: 7, config: JSON.stringify({ visibility: 'public' }) });   // column

    const req = { path: '/foo.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(authenticate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('requires JWT for INTERNAL visibility', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 2, column_id: 8, space_id: 12, url: '/uploads/bar.png' })
      .mockResolvedValueOnce({ id: 8, config: { visibility: 'internal' } });

    // authenticate populates req.user → next()
    authenticate.mockImplementationOnce((req, res, next) => {
      req.user = { id: 99, role: 'editor' };
      next();
    });

    const req = { path: '/bar.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(authenticate).toHaveBeenCalledOnce();
    expect(checkUserSpaceAccess).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 for INTERNAL when authenticate fails (no req.user)', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 3, column_id: 9, space_id: 12, url: '/uploads/baz.png' })
      .mockResolvedValueOnce({ id: 9, config: { visibility: 'internal' } });

    // authenticate writes 401 directly (matches the real implementation)
    authenticate.mockImplementationOnce((req, res /*, next*/) => {
      res.status(401).json({ error: 'No authentication provided' });
    });

    const req = { path: '/baz.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('PRIVATE: allows space members through', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 4, column_id: 10, space_id: 12, url: '/uploads/p.png' })
      .mockResolvedValueOnce({ id: 10, config: { visibility: 'private' } })
      .mockResolvedValueOnce({                                                     // space lookup
        id: 12, type: 'team', owner_id: 1, visibility: 'private', access_control: null
      });
    authenticate.mockImplementationOnce((req, res, next) => {
      req.user = { id: 99, role: 'editor' };
      next();
    });
    checkUserSpaceAccess.mockResolvedValueOnce(true);

    const req = { path: '/p.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(checkUserSpaceAccess).toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('PRIVATE: rejects non-members with 403', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 5, column_id: 11, space_id: 13, url: '/uploads/secret.png' })
      .mockResolvedValueOnce({ id: 11, config: { visibility: 'private' } })
      .mockResolvedValueOnce({
        id: 13, type: 'team', owner_id: 2, visibility: 'private', access_control: null
      });
    authenticate.mockImplementationOnce((req, res, next) => {
      req.user = { id: 99, role: 'editor' };
      next();
    });
    checkUserSpaceAccess.mockResolvedValueOnce(false);

    const req = { path: '/secret.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('orphan file (no column_id) with files.visibility=private — outsider rejected', async () => {
    dbGet
      .mockResolvedValueOnce({
        id: 6, column_id: null, space_id: 14, url: '/uploads/orphan.png', visibility: 'private'
      })
      .mockResolvedValueOnce({
        id: 14, type: 'team', owner_id: 3, visibility: 'private', access_control: null
      });
    authenticate.mockImplementationOnce((req, res, next) => {
      req.user = { id: 99, role: 'editor' };
      next();
    });
    checkUserSpaceAccess.mockResolvedValueOnce(false);

    const req = { path: '/orphan.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('orphan file with no space_id at all is rejected with 403', async () => {
    dbGet.mockResolvedValueOnce({
      id: 7, column_id: null, space_id: null, url: '/uploads/system.png', visibility: 'private'
    });
    authenticate.mockImplementationOnce((req, res, next) => {
      req.user = { id: 99, role: 'editor' };
      next();
    });

    const req = { path: '/system.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  // ─── ADR-0016 Phase 5 — orphan visibility resolution ────────────────────

  it('orphan file with files.visibility=internal: JWT only, no space check', async () => {
    dbGet.mockResolvedValueOnce({
      id: 100, column_id: null, space_id: 14, url: '/uploads/spaces/14/chat.png', visibility: 'internal'
    });
    authenticate.mockImplementationOnce((req, res, next) => {
      req.user = { id: 99, role: 'editor' };
      next();
    });

    const req = { path: '/spaces/14/chat.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(authenticate).toHaveBeenCalledOnce();
    expect(checkUserSpaceAccess).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('orphan file with files.visibility=public: served without auth', async () => {
    dbGet.mockResolvedValueOnce({
      id: 101, column_id: null, space_id: null, url: '/uploads/desktop-releases/v1.glb', visibility: 'public'
    });

    const req = { path: '/desktop-releases/v1.glb' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(authenticate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('orphan file with bogus files.visibility falls back to private', async () => {
    dbGet
      .mockResolvedValueOnce({
        id: 102, column_id: null, space_id: 14, url: '/uploads/x.png', visibility: 'wide-open'
      })
      .mockResolvedValueOnce({
        id: 14, type: 'team', owner_id: 3, visibility: 'private', access_control: null
      });
    authenticate.mockImplementationOnce((req, res, next) => {
      req.user = { id: 99, role: 'editor' };
      next();
    });
    checkUserSpaceAccess.mockResolvedValueOnce(false);

    const req = { path: '/x.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('avatar prefix /uploads/avatars/* → internal (no DB lookup, JWT required)', async () => {
    // No DB lookup expected — prefix rule resolves visibility synchronously.
    authenticate.mockImplementationOnce((req, res, next) => {
      req.user = { id: 99, role: 'editor' };
      next();
    });

    const req = { path: '/avatars/42_1234.jpg' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(dbGet).not.toHaveBeenCalled();
    expect(authenticate).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });

  it('avatar prefix → 401 when no JWT', async () => {
    authenticate.mockImplementationOnce((req, res /*, next*/) => {
      res.status(401).json({ error: 'No authentication provided' });
    });

    const req = { path: '/avatars/42_1234.jpg' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    expect(dbGet).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('unknown visibility value falls back to private', async () => {
    dbGet
      .mockResolvedValueOnce({ id: 8, column_id: 20, space_id: 15, url: '/uploads/x.png' })
      .mockResolvedValueOnce({ id: 20, config: { visibility: 'wide-open' } })
      .mockResolvedValueOnce({
        id: 15, type: 'team', owner_id: 4, visibility: 'private', access_control: null
      });
    authenticate.mockImplementationOnce((req, res, next) => {
      req.user = { id: 99, role: 'editor' };
      next();
    });
    checkUserSpaceAccess.mockResolvedValueOnce(false);

    const req = { path: '/x.png' };
    const res = makeRes();
    const next = vi.fn();

    await guard(req, res, next);

    // Bogus visibility -> private path -> outsider rejected
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws if mountPrefix is malformed', () => {
    expect(() => createFileGuard('uploads')).toThrow();
    expect(() => createFileGuard('')).toThrow();
  });
});
