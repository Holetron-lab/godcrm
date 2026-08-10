// ADR-0059 AMEND-3 §4.9 — `/conversations/:id/call/token` capacity pre-flights.
//
// The endpoint must:
//   1. Reject with 429 + `error: 'concurrent_room_cap'` when `ListRooms` shows
//      `>= CALLS_MAX_CONCURRENT` rooms AND the requested room isn't already in
//      that list (i.e. a re-join of an existing room is always allowed).
//   2. Swallow `AlreadyExists` on `CreateRoom` — the room already enforces a
//      participant cap, so the handler should proceed to issue the JWT.
//
// Strategy: mock chatShared.js (so the real DB / JWT plumbing isn't pulled in)
// and the dynamically-imported `axios` module, mount the router built by
// `registerCallRoutes` on a tiny express app, and hit it via supertest.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';

const dbGetMock = vi.fn();
const dbAllMock = vi.fn();
const axiosPostMock = vi.fn();

function fakeRequireAuth(req, _res, next) {
  const id = Number(req.headers['x-test-user-id']);
  req.user = { userId: id, id, name: 'tester' };
  next();
}

// Response shape compatible with what the route emits.
const success = (res, data) => res.status(200).json({ success: true, data });
const error = (res, code, msg, status = 500, details = null) =>
  res.status(status).json({ success: false, error: { code, message: msg, ...(details ? { details } : {}) } });
const badRequest = (res, msg) => res.status(400).json({ success: false, error: msg });
const forbidden = (res, msg) => res.status(403).json({ success: false, error: msg });

const jwtFake = {
  sign: () => 'fake-jwt-token',
};

vi.mock('../chatShared.js', () => ({
  dbRun: vi.fn(),
  dbGet: (...args) => dbGetMock(...args),
  dbAll: (...args) => dbAllMock(...args),
  isPostgres: () => true,
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  jwt: jwtFake,
  success,
  error,
  badRequest,
  forbidden,
  requireAuth: fakeRequireAuth,
}));

vi.mock('../../../../services/secrets/getSecret.js', () => ({
  getSecret: vi.fn(async (vaultKey) => {
    if (vaultKey === 'livekit_api_key') return 'test-key';
    if (vaultKey === 'livekit_api_secret') return 'test-secret';
    return null;
  }),
}));

// Mock axios for both static and dynamic (`await import('axios')`) call sites.
vi.mock('axios', () => ({
  default: { post: (...args) => axiosPostMock(...args) },
}));

const { default: registerCallRoutes } = await import('../callController.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = Router();
  registerCallRoutes(router);
  app.use('/api/v3/chat', router);
  return app;
}

describe('POST /conversations/:id/call/token — ADR-0059 §4.9 capacity gates', () => {
  beforeEach(() => {
    dbGetMock.mockReset();
    dbAllMock.mockReset();
    axiosPostMock.mockReset();
    // Reset env so each test sets its own cap explicitly.
    delete process.env.CALLS_MAX_CONCURRENT;
    delete process.env.CALLS_MAX_PARTICIPANTS_PER_ROOM;
    process.env.LIVEKIT_URL = 'wss://crm.hltrn.cc/livekit';
  });

  it('returns 429 concurrent_room_cap when cap=2 and 2 different rooms are already live', async () => {
    process.env.CALLS_MAX_CONCURRENT = '2';
    // participant check passes
    dbGetMock.mockResolvedValueOnce({ user_id: 7, conversation_id: 99 });
    // ListRooms returns 2 rooms, neither is conv-99
    axiosPostMock.mockImplementation((url) => {
      if (url.endsWith('/twirp/livekit.RoomService/ListRooms')) {
        return Promise.resolve({ data: { rooms: [{ name: 'conv-1' }, { name: 'conv-2' }] } });
      }
      throw new Error(`unexpected twirp call: ${url}`);
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/99/call/token')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('concurrent_room_cap');
    expect(res.body.cap).toBe(2);
    // CreateRoom should NOT have been called — we short-circuit at the cap.
    const createRoomCalls = axiosPostMock.mock.calls.filter(c => c[0].endsWith('/CreateRoom'));
    expect(createRoomCalls).toHaveLength(0);
  });

  it('allows re-join when requested room is already in the active list, even at cap', async () => {
    process.env.CALLS_MAX_CONCURRENT = '2';
    dbGetMock.mockResolvedValueOnce({ user_id: 7, conversation_id: 99 });
    dbAllMock.mockResolvedValueOnce([]);
    // ListRooms has 2 rooms AND one of them is conv-99 (re-join scenario)
    axiosPostMock.mockImplementation((url) => {
      if (url.endsWith('/twirp/livekit.RoomService/ListRooms')) {
        return Promise.resolve({ data: { rooms: [{ name: 'conv-99' }, { name: 'conv-1' }] } });
      }
      if (url.endsWith('/twirp/livekit.RoomService/CreateRoom')) {
        return Promise.resolve({ data: { sid: 'RM_x', name: 'conv-99' } });
      }
      throw new Error(`unexpected twirp call: ${url}`);
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/99/call/token')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.room).toBe('conv-99');
  });

  it('swallows AlreadyExists on CreateRoom and still issues the token', async () => {
    process.env.CALLS_MAX_CONCURRENT = '10';
    process.env.CALLS_MAX_PARTICIPANTS_PER_ROOM = '20';
    dbGetMock.mockResolvedValueOnce({ user_id: 7, conversation_id: 99 });
    dbAllMock.mockResolvedValueOnce([]);
    axiosPostMock.mockImplementation((url) => {
      if (url.endsWith('/twirp/livekit.RoomService/ListRooms')) {
        return Promise.resolve({ data: { rooms: [] } });
      }
      if (url.endsWith('/twirp/livekit.RoomService/CreateRoom')) {
        // Twirp surfaces grpc AlreadyExists with HTTP 409 + body `{code:'already_exists', msg:'...'}`.
        const err = new Error('Request failed with status code 409');
        err.response = { status: 409, data: { code: 'already_exists', msg: 'room already exists' } };
        return Promise.reject(err);
      }
      throw new Error(`unexpected twirp call: ${url}`);
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/99/call/token')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('fake-jwt-token');
    expect(res.body.data.room).toBe('conv-99');
    // Confirm CreateRoom was actually attempted (not skipped).
    const createRoomCalls = axiosPostMock.mock.calls.filter(c => c[0].endsWith('/CreateRoom'));
    expect(createRoomCalls).toHaveLength(1);
    expect(createRoomCalls[0][1]).toMatchObject({ name: 'conv-99', max_participants: 20 });
  });

  it('happy path: under cap and CreateRoom succeeds — returns 200 with token', async () => {
    process.env.CALLS_MAX_CONCURRENT = '10';
    dbGetMock.mockResolvedValueOnce({ user_id: 7, conversation_id: 99 });
    dbAllMock.mockResolvedValueOnce([{ user_id: 8, name: 'other', email: 'o@x' }]);
    axiosPostMock.mockImplementation((url) => {
      if (url.endsWith('/twirp/livekit.RoomService/ListRooms')) {
        return Promise.resolve({ data: { rooms: [] } });
      }
      if (url.endsWith('/twirp/livekit.RoomService/CreateRoom')) {
        return Promise.resolve({ data: { sid: 'RM_x', name: 'conv-99' } });
      }
      throw new Error(`unexpected twirp call: ${url}`);
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v3/chat/conversations/99/call/token')
      .set('x-test-user-id', '7');

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('fake-jwt-token');
    expect(res.body.data.participants).toEqual([{ id: 8, name: 'other' }]);
  });
});
