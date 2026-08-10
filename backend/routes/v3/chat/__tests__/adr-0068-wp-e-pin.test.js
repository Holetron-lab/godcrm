// ADR-0068 WP-E BE — pin/unpin endpoint guards.
//
// Covers all 5 acceptance cases from T-159793:
//   1. POST idempotency — twice → same pinned_at, single UPDATE.
//   2. DELETE idempotency — twice → 200 + pinned_at: null, single UPDATE.
//   3. Soft cap — 51st distinct POST in one conv → 409 pin_cap_reached.
//   4. Permission: non-participant in group conv → 403.
//   5. Permission: non-owner in direct conv → 403.
//
// Strategy mirrors adr-0068-wp-b.test.js: mock chatShared.js to control
// dbGet/dbRun, register pinController on a bare express router, and hit
// it via supertest. Each test asserts both the HTTP shape AND the exact
// SQL mutations issued (no UPDATE when idempotent, RETURNING used).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';

const dbGetMock = vi.fn();
const dbRunMock = vi.fn();
const dbAllMock = vi.fn();

function fakeRequireAuth(req, _res, next) {
  const id = Number(req.headers['x-test-user-id']);
  req.user = { userId: id, id, role: req.headers['x-test-user-role'] || 'user' };
  next();
}

const success = (res, data) => res.status(200).json({ success: true, data });
const created = (res, data) => res.status(201).json({ success: true, data });
const error = (res, code, msg, status = 500) =>
  res.status(status).json({ success: false, error: code, message: msg });
const badRequest = (res, msg) => res.status(400).json({ success: false, error: msg });
const notFound = (res, msg) => res.status(404).json({ success: false, error: msg });
const forbidden = (res, msg) => res.status(403).json({ success: false, error: msg });

vi.mock('../chatShared.js', () => ({
  dbRun: (...args) => dbRunMock(...args),
  dbGet: (...args) => dbGetMock(...args),
  dbAll: (...args) => dbAllMock(...args),
  isPostgres: () => true,
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  success, created, error, badRequest, notFound, forbidden,
  requireAuth: fakeRequireAuth,
}));

const { default: registerPinRoutes } = await import('../pinController.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  registerPinRoutes(router);
  app.use('/api/v3/chat', router);
  return app;
}

beforeEach(() => {
  dbGetMock.mockReset();
  dbRunMock.mockReset();
  dbAllMock.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers: route dbGet calls by SQL keywords.
// pinController issues these reads in order:
//   1. SELECT … FROM messages WHERE id = $1
//   2. SELECT … FROM conversations WHERE id = $1
//   3. (group only) SELECT … FROM conversation_participants
//   4. (POST + not already pinned) SELECT COUNT FROM messages WHERE pinned_at NOT NULL
//   5. (POST + not already pinned) UPDATE messages … RETURNING id, pinned_at
// ---------------------------------------------------------------------------

function routeReads({
  message, conversation, participant, pinnedCount, updatedReturning,
}) {
  return (sql, _params) => {
    if (/FROM messages WHERE id =/i.test(sql) && !/UPDATE/i.test(sql)) return message;
    if (/FROM conversations WHERE id =/i.test(sql)) return conversation;
    if (/FROM conversation_participants/i.test(sql)) return participant;
    if (/COUNT\(\*\).*pinned_at IS NOT NULL/i.test(sql)) return { n: pinnedCount };
    if (/UPDATE messages SET pinned_at = NOW/i.test(sql)) return updatedReturning;
    return null;
  };
}

// =============================================================================
// 1. POST idempotency
// =============================================================================

describe('ADR-0068 WP-E — POST /messages/:id/pin idempotency', () => {
  it('returns 200 with current pinned_at and DOES NOT issue UPDATE when already pinned', async () => {
    const app = buildApp();
    const existingPinAt = '2026-05-19T20:00:00.000Z';

    dbGetMock.mockImplementation(routeReads({
      message: { id: 42, conversation_id: 7, pinned_at: existingPinAt },
      conversation: { id: 7, type: 'group', created_by: 1 },
      participant: { user_id: 99 },
      pinnedCount: 0,
      updatedReturning: null,
    }));

    const res = await request(app)
      .post('/api/v3/chat/messages/42/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(42);
    expect(res.body.data.pinned_at).toBe(existingPinAt);

    const updateCalls = dbGetMock.mock.calls.filter(c => /UPDATE messages/i.test(c[0]));
    expect(updateCalls).toHaveLength(0);
    expect(dbRunMock).not.toHaveBeenCalled();
  });

  it('issues UPDATE … RETURNING on a previously-unpinned message', async () => {
    const app = buildApp();
    const newPinAt = '2026-05-19T20:30:00.000Z';

    dbGetMock.mockImplementation(routeReads({
      message: { id: 42, conversation_id: 7, pinned_at: null },
      conversation: { id: 7, type: 'group', created_by: 1 },
      participant: { user_id: 99 },
      pinnedCount: 3,
      updatedReturning: { id: 42, pinned_at: newPinAt },
    }));

    const res = await request(app)
      .post('/api/v3/chat/messages/42/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.pinned_at).toBe(newPinAt);

    const updateCalls = dbGetMock.mock.calls.filter(c => /UPDATE messages SET pinned_at = NOW/i.test(c[0]));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][0]).toMatch(/RETURNING id, pinned_at/);
  });
});

// =============================================================================
// 2. DELETE idempotency
// =============================================================================

describe('ADR-0068 WP-E — DELETE /messages/:id/pin idempotency', () => {
  it('returns 200 with pinned_at: null and DOES NOT issue UPDATE when already unpinned', async () => {
    const app = buildApp();

    dbGetMock.mockImplementation(routeReads({
      message: { id: 42, conversation_id: 7, pinned_at: null },
      conversation: { id: 7, type: 'group', created_by: 1 },
      participant: { user_id: 99 },
    }));

    const res = await request(app)
      .delete('/api/v3/chat/messages/42/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.pinned_at).toBeNull();
    expect(dbRunMock).not.toHaveBeenCalled();
  });

  it('issues UPDATE SET pinned_at = NULL when message was pinned', async () => {
    const app = buildApp();
    dbGetMock.mockImplementation(routeReads({
      message: { id: 42, conversation_id: 7, pinned_at: '2026-05-19T20:00:00.000Z' },
      conversation: { id: 7, type: 'group', created_by: 1 },
      participant: { user_id: 99 },
    }));

    const res = await request(app)
      .delete('/api/v3/chat/messages/42/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.pinned_at).toBeNull();
    expect(dbRunMock).toHaveBeenCalledTimes(1);
    expect(dbRunMock.mock.calls[0][0]).toMatch(/UPDATE messages SET pinned_at = NULL/i);
  });
});

// =============================================================================
// 3. Soft cap — 51st distinct POST returns 409
// =============================================================================

describe('ADR-0068 WP-E — soft cap 50/conv', () => {
  it('returns 409 pin_cap_reached when 50 messages are already pinned', async () => {
    const app = buildApp();

    dbGetMock.mockImplementation(routeReads({
      message: { id: 51, conversation_id: 7, pinned_at: null },
      conversation: { id: 7, type: 'group', created_by: 1 },
      participant: { user_id: 99 },
      pinnedCount: 50,
      updatedReturning: null,
    }));

    const res = await request(app)
      .post('/api/v3/chat/messages/51/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('pin_cap_reached');
    expect(res.body.cap).toBe(50);

    const updateCalls = dbGetMock.mock.calls.filter(c => /UPDATE messages SET pinned_at = NOW/i.test(c[0]));
    expect(updateCalls).toHaveLength(0);
  });

  it('does NOT trip cap when re-pinning an already-pinned 51st (idempotent)', async () => {
    const app = buildApp();
    const existingPinAt = '2026-05-19T20:00:00.000Z';

    dbGetMock.mockImplementation(routeReads({
      message: { id: 51, conversation_id: 7, pinned_at: existingPinAt },
      conversation: { id: 7, type: 'group', created_by: 1 },
      participant: { user_id: 99 },
      pinnedCount: 50,
    }));

    const res = await request(app)
      .post('/api/v3/chat/messages/51/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.pinned_at).toBe(existingPinAt);
  });
});

// =============================================================================
// 4. Permission — group non-participant gets 403
// =============================================================================

describe('ADR-0068 WP-E — group conv permission gate', () => {
  it('returns 403 for non-participant in group chat', async () => {
    const app = buildApp();

    dbGetMock.mockImplementation(routeReads({
      message: { id: 42, conversation_id: 7, pinned_at: null },
      conversation: { id: 7, type: 'group', created_by: 1 },
      participant: null,
    }));

    const res = await request(app)
      .post('/api/v3/chat/messages/42/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('allows pin for participant (positive control)', async () => {
    const app = buildApp();
    dbGetMock.mockImplementation(routeReads({
      message: { id: 42, conversation_id: 7, pinned_at: null },
      conversation: { id: 7, type: 'group', created_by: 1 },
      participant: { user_id: 99 },
      pinnedCount: 0,
      updatedReturning: { id: 42, pinned_at: '2026-05-19T20:30:00.000Z' },
    }));

    const res = await request(app)
      .post('/api/v3/chat/messages/42/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(200);
  });
});

// =============================================================================
// 5. Permission — direct conv non-owner gets 403
// =============================================================================

describe('ADR-0068 WP-E — direct conv permission gate', () => {
  it('returns 403 for non-owner in direct chat', async () => {
    const app = buildApp();

    dbGetMock.mockImplementation(routeReads({
      message: { id: 42, conversation_id: 7, pinned_at: null },
      conversation: { id: 7, type: 'direct', created_by: 1 },
      participant: { user_id: 99 },
    }));

    const res = await request(app)
      .post('/api/v3/chat/messages/42/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('allows owner to pin in direct chat (positive control)', async () => {
    const app = buildApp();
    dbGetMock.mockImplementation(routeReads({
      message: { id: 42, conversation_id: 7, pinned_at: null },
      conversation: { id: 7, type: 'direct', created_by: 99 },
      pinnedCount: 0,
      updatedReturning: { id: 42, pinned_at: '2026-05-19T20:30:00.000Z' },
    }));

    const res = await request(app)
      .post('/api/v3/chat/messages/42/pin')
      .set('x-test-user-id', '99')
      .send();

    expect(res.status).toBe(200);
  });
});
