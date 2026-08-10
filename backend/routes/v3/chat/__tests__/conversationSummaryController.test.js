// ADR-0031 §Z / WP-24 — GET /api/v3/chat/conversations/:id/summary
//
// Integration tests for the lightweight ChatLinkCard metadata endpoint.
//
// Cases (per WP-24 deliverable):
//   1. 200 OK with full payload for accessible conversation
//        — incl. participants cap (3), agent + bound_row resolution,
//          oversized avatar (> 2KB) stripped to null
//   2. 403 for non-member (caller is authenticated but not in participants)
//   3. 200 with { id, title, deleted: true } for soft-deleted conversation
//        — soft-delete signal: settings.deleted === true (no DDL change)
//   4. 404 when the conversation row is missing
//
// Strategy: same as messageController-move-owner-gate.test.js — mock
// `chatShared.js` so the heavy DB connection module isn't loaded, then mount
// the registered router on a tiny express app and hit it with supertest.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';

const dbGetMock = vi.fn();
const dbAllMock = vi.fn();

function fakeRequireAuth(req, _res, next) {
  const id = Number(req.headers['x-test-user-id']);
  req.user = { userId: id, id, role: 'user' };
  next();
}

const success = (res, data) => res.status(200).json({ success: true, data });
const error = (res, code, msg, status = 500) =>
  res.status(status).json({ success: false, error: code, message: msg });
const notFound = (res, msg) => res.status(404).json({ success: false, error: msg });
const forbidden = (res, msg) => res.status(403).json({ success: false, error: msg });

vi.mock('../chatShared.js', () => ({
  dbRun: vi.fn(),
  dbGet: (...args) => dbGetMock(...args),
  dbAll: (...args) => dbAllMock(...args),
  isPostgres: () => true,
  safeJsonParse: (v, fallback) => {
    if (v == null) return fallback;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return fallback; }
  },
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  success, created: success, error, badRequest: error, notFound, forbidden,
  requireAuth: fakeRequireAuth,
}));

const { default: registerConversationSummaryRoutes } = await import('../conversationSummaryController.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  registerConversationSummaryRoutes(router);
  app.use('/api/v3/chat', router);
  return app;
}

describe('GET /conversations/:id/summary — ADR-0031 §Z / WP-24', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbAllMock.mockReset();
  });

  it('200 OK: returns full payload with participants cap, agent, bound_row, oversized avatar stripped', async () => {
    // The conversation: bound to ticket row 141024 in tickets table 1708,
    // owned agent_id = 218, settings has no `deleted` flag.
    const oversizedAvatar = 'data:image/png;base64,' + 'A'.repeat(5000); // > 2KB

    dbGetMock
      // 1) conversations row
      .mockResolvedValueOnce({
        id: 3090, title: 'Discussing T-141024', type: 'group',
        settings: '{"foo":"bar"}', agent_id: 218,
        bound_table_id: 1708, bound_row_id: 141024, space_id: 11,
      })
      // 2) participant access check (caller user 7 is a participant)
      .mockResolvedValueOnce({ user_id: 7 })
      // 3) participants total count (full count = 5, preview cap = 3)
      .mockResolvedValueOnce({ total: 5 })
      // 4) agent row lookup
      .mockResolvedValueOnce({ id: 218, data: '{"name":"Architect","icon":"🏛️"}' })
      // 5) bound row lookup
      .mockResolvedValueOnce({
        id: 141024,
        row_title: 'Implement ChatLinkCard',
        table_icon: '🎫',
      });

    // dbAll: participants preview (capped at 3 by SQL LIMIT)
    dbAllMock.mockResolvedValueOnce([
      { id: 7, name: 'Owner', avatar: null }, // null avatar
      { id: 8, name: 'Bob', avatar: 'https://cdn/img.png' }, // small URL avatar (passes through)
      { id: 9, name: 'Carol', avatar: oversizedAvatar }, // oversized → must be stripped
    ]);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v3/chat/conversations/3090/summary')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 3090,
      title: 'Discussing T-141024',
      type: 'group',
      participants_total: 5,
      agent: { id: 218, name: 'Architect', icon: '🏛️' },
      bound_row: { table_id: 1708, row_id: 141024, title: 'Implement ChatLinkCard' },
      icon: '🎫',
      deleted: false,
    });
    expect(res.body.data.participants).toEqual([
      { id: 7, name: 'Owner', avatar: null },
      { id: 8, name: 'Bob', avatar: 'https://cdn/img.png' },
      { id: 9, name: 'Carol', avatar: null }, // oversized stripped
    ]);
    // SQL passed LIMIT 3
    const participantsCall = dbAllMock.mock.calls[0];
    expect(participantsCall[1]).toEqual([3090, 3]);
  });

  it('403: caller is not a participant of the conversation', async () => {
    dbGetMock
      // 1) conversation exists
      .mockResolvedValueOnce({
        id: 3090, title: 'Private', type: 'direct',
        settings: '{}', agent_id: null,
        bound_table_id: null, bound_row_id: null, space_id: null,
      })
      // 2) participant lookup → null (user 99 is not a participant)
      .mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v3/chat/conversations/3090/summary')
      .set('x-test-user-id', '99');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    // dbAll must not be reached (no participants/agent/bound_row queries)
    expect(dbAllMock).not.toHaveBeenCalled();
  });

  it('200 with { id, title, deleted: true } for soft-deleted conversation', async () => {
    // settings.deleted === true short-circuits; no participant check runs.
    dbGetMock.mockResolvedValueOnce({
      id: 3090, title: 'Old chat', type: 'group',
      settings: '{"deleted":true}', agent_id: 218,
      bound_table_id: 1708, bound_row_id: 141024, space_id: 11,
    });

    const app = buildApp();
    const res = await request(app)
      .get('/api/v3/chat/conversations/3090/summary')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      id: 3090, title: 'Old chat', deleted: true,
    });
    // Soft-delete short-circuits BEFORE the access check, BEFORE any
    // participants/agent/bound_row queries.
    expect(dbGetMock).toHaveBeenCalledTimes(1);
    expect(dbAllMock).not.toHaveBeenCalled();
  });

  it('404 when the conversation row does not exist', async () => {
    dbGetMock.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v3/chat/conversations/9999/summary')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('400 for invalid (non-numeric) conversation id', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v3/chat/conversations/abc/summary')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(400);
    expect(dbGetMock).not.toHaveBeenCalled();
  });

  it('agent and bound_row are null when conversation has no binding', async () => {
    dbGetMock
      // conversations row — no agent, no bound row
      .mockResolvedValueOnce({
        id: 4000, title: 'Plain DM', type: 'direct',
        settings: null, agent_id: null,
        bound_table_id: null, bound_row_id: null, space_id: null,
      })
      // participant check
      .mockResolvedValueOnce({ user_id: 7 })
      // participants total
      .mockResolvedValueOnce({ total: 2 });

    dbAllMock.mockResolvedValueOnce([
      { id: 7, name: 'Owner', avatar: null },
      { id: 8, name: 'Friend', avatar: '' }, // empty string → null
    ]);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v3/chat/conversations/4000/summary')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    expect(res.body.data.agent).toBeNull();
    expect(res.body.data.bound_row).toBeNull();
    expect(res.body.data.icon).toBeNull();
    expect(res.body.data.participants).toEqual([
      { id: 7, name: 'Owner', avatar: null },
      { id: 8, name: 'Friend', avatar: null },
    ]);
    expect(res.body.data.participants_total).toBe(2);
  });
});
