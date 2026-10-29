// Human chat presence — GET/POST /conversations/:id/presence.
//
// Contract (frontend handoff, /tmp/frontend-20204-review.md, owner: 1-minute window):
//   - both methods: requireAuth + participant gate (404 like GET /conversations/:id),
//     agent principals (users.user_type = 'agent') are refused with 403;
//   - POST {data:{client_id, active, idle_ms}} upserts one lease per tab;
//     last_activity_at = serverNow - idle_ms; active:false removes only that tab;
//   - leases expire at 60 000 ms; GET aggregates tabs per user and never renews;
//   - storage is in-memory (single fork PM2 instance), bounded, no DB writes.
//
// Strategy mirrors adr-0068-wp-e-pin.test.js: mock chatShared.js, register the
// controller on a bare router, drive it with supertest and fake timers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

const dbGetMock = vi.fn();
const dbRunMock = vi.fn();

function fakeRequireAuth(req, _res, next) {
  const id = Number(req.headers['x-test-user-id']);
  req.user = { userId: id, id };
  next();
}
const success = (res, data) => res.status(200).json({ success: true, data });
const error = (res, code, msg, status = 500) => res.status(status).json({ success: false, error: code, message: msg });
const badRequest = (res, msg) => res.status(400).json({ success: false, error: msg });
const notFound = (res, msg) => res.status(404).json({ success: false, error: msg });
const forbidden = (res, msg) => res.status(403).json({ success: false, error: msg });

vi.mock('../chatShared.js', () => ({
  dbGet: (...args) => dbGetMock(...args),
  dbRun: (...args) => dbRunMock(...args),
  isPostgres: () => true,
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  success, error, badRequest, notFound, forbidden,
  requireAuth: fakeRequireAuth,
}));

const { default: registerPresenceRoutes, PRESENCE_TTL_MS, _resetPresenceStore } = await import('../presenceController.js');

// Membership fixture: conversation 7 has humans 1, 2 and agent 50.
const MEMBERS = { 7: { 1: 'human', 2: 'human', 50: 'agent' } };
function routeMembership(sql, params) {
  if (/FROM conversation_participants/i.test(sql)) {
    const [conversationId, userId] = params;
    const type = MEMBERS[conversationId]?.[userId];
    return type === undefined ? null : { user_type: type };
  }
  return null;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  registerPresenceRoutes(router);
  app.use('/api/v3/chat', router);
  return app;
}

const URL = '/api/v3/chat/conversations/7/presence';
let app;
beforeEach(() => {
  dbGetMock.mockReset();
  dbRunMock.mockReset();
  dbGetMock.mockImplementation(routeMembership);
  _resetPresenceStore();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-24T10:00:00.000Z'));
  app = buildApp();
});
afterEach(() => vi.useRealTimers());

const post = (userId, body) => request(app).post(URL).set('x-test-user-id', String(userId)).send(body);
const get = (userId) => request(app).get(URL).set('x-test-user-id', String(userId));
const lease = (client_id, idle_ms = 0, active = true) => ({ data: { client_id, active, idle_ms } });

describe('presence — access control', () => {
  it('non-participant gets 404 on both methods and nothing is stored', async () => {
    expect((await post(99, lease('tab-a'))).status).toBe(404);
    expect((await get(99)).status).toBe(404);
    expect((await get(1)).body.data.users).toEqual([]);
  });

  it('agent principal gets 403 on both methods', async () => {
    expect((await post(50, lease('tab-a'))).status).toBe(403);
    expect((await get(50)).status).toBe(403);
  });

  it('invalid conversation id is 400', async () => {
    const res = await request(app).get('/api/v3/chat/conversations/abc/presence').set('x-test-user-id', '1');
    expect(res.status).toBe(400);
  });

  it('never writes to the database', async () => {
    await post(1, lease('tab-a'));
    await get(2);
    expect(dbRunMock).not.toHaveBeenCalled();
  });
});

describe('presence — POST validation', () => {
  it.each([
    ['missing data', {}],
    ['missing client_id', { data: { active: true, idle_ms: 0 } }],
    ['client_id too long', { data: { client_id: 'x'.repeat(65), active: true, idle_ms: 0 } }],
    ['active not boolean', { data: { client_id: 'a', active: 'yes', idle_ms: 0 } }],
    ['idle_ms negative', { data: { client_id: 'a', active: true, idle_ms: -1 } }],
    ['idle_ms not a number', { data: { client_id: 'a', active: true, idle_ms: '5' } }],
    ['idle_ms fractional', { data: { client_id: 'a', active: true, idle_ms: 1.5 } }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post(1, body);
    expect(res.status).toBe(400);
    expect((await get(2)).body.data.users).toEqual([]);
  });
});

describe('presence — identity and timing', () => {
  it('identity comes from the session, not the body', async () => {
    await post(1, { data: { client_id: 'tab-a', active: true, idle_ms: 0, user_id: 2 } });
    const res = await get(2);
    expect(res.body.data.users.map(u => u.user_id)).toEqual([1]);
  });

  it('last_activity_at is server time minus idle_ms; server_time is returned', async () => {
    await post(1, lease('tab-a', 5000));
    const res = await get(2);
    expect(res.status).toBe(200);
    expect(res.body.data.server_time).toBe('2026-09-24T10:00:00.000Z');
    expect(res.body.data.users).toEqual([{ user_id: 1, last_activity_at: '2026-09-24T09:59:55.000Z' }]);
  });

  it('expires at PRESENCE_TTL_MS (60 s), and GET does not renew', async () => {
    expect(PRESENCE_TTL_MS).toBe(60_000);
    await post(1, lease('tab-a'));
    vi.setSystemTime(new Date('2026-09-24T10:00:59.999Z'));
    expect((await get(2)).body.data.users).toHaveLength(1);
    vi.setSystemTime(new Date('2026-09-24T10:01:00.000Z'));
    expect((await get(2)).body.data.users).toEqual([]);
  });

  it('idle_ms at or beyond the TTL never makes the user online', async () => {
    await post(1, lease('tab-a', 60_000));
    expect((await get(2)).body.data.users).toEqual([]);
  });
});

describe('presence — multiple tabs', () => {
  it('aggregates tabs per user by most recent activity', async () => {
    await post(1, lease('tab-a', 30_000));
    await post(1, lease('tab-b', 1_000));
    const res = await get(2);
    expect(res.body.data.users).toEqual([{ user_id: 1, last_activity_at: '2026-09-24T09:59:59.000Z' }]);
  });

  it('active:false removes only that tab', async () => {
    await post(1, lease('tab-a'));
    await post(1, lease('tab-b'));
    await post(1, lease('tab-a', 0, false));
    expect((await get(2)).body.data.users).toHaveLength(1);
    await post(1, lease('tab-b', 0, false));
    expect((await get(2)).body.data.users).toEqual([]);
  });

  it('a stale update cannot resurrect a tab past the TTL, but a fresh one can', async () => {
    await post(1, lease('tab-a'));
    vi.setSystemTime(new Date('2026-09-24T10:02:00.000Z'));
    expect((await get(2)).body.data.users).toEqual([]);
    await post(1, lease('tab-a', 1_000));
    expect((await get(2)).body.data.users).toEqual([{ user_id: 1, last_activity_at: '2026-09-24T10:01:59.000Z' }]);
  });

  it('lists users sorted by id and scoped to the conversation', async () => {
    await post(2, lease('tab-x'));
    await post(1, lease('tab-a'));
    expect((await get(1)).body.data.users.map(u => u.user_id)).toEqual([1, 2]);
  });
});

describe('presence — bounded store', () => {
  it('keeps at most the newest tabs per user', async () => {
    const { PRESENCE_MAX_TABS_PER_USER } = await import('../presenceController.js');
    for (let i = 0; i <= PRESENCE_MAX_TABS_PER_USER; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 24, 10, 0, i)));
      await post(1, lease(`tab-${i}`));
    }
    // Dropping the oldest tab must not change the aggregate; the user stays online.
    expect((await get(2)).body.data.users).toHaveLength(1);
    // Leaving the newest tabs empties the user only once the surviving ones are gone.
    for (let i = 1; i <= PRESENCE_MAX_TABS_PER_USER; i++) await post(1, lease(`tab-${i}`, 0, false));
    expect((await get(2)).body.data.users).toEqual([]);
  });
});
