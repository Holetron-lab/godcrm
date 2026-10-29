// @vitest-environment node
/**
 * ADR-165 WP-4 (D5) — naturalization routes, gated by passport authority.
 *
 * `POST` / `DELETE /api/v3/users/:id/passport` run `resolvePassportAuthority`
 * (global admin role ∧ admin in the agent's residence space — conversation
 * 3692) BEFORE the service, so every refusal below asserts the SERVICE was
 * never called, not merely that the response was an error. The authorized
 * path threads the real request into the audit row (`audit_req`) so the act
 * is signed by a session rather than by a channel.
 *
 * `GET /api/v3/users/passport-authority` exposes the same decision to the UI
 * so both gates (agent settings, roster) render from the server's answer.
 *
 * NB the mount is `/api/v3/users` (server.js), not `/api/v3/agent-users` as
 * the WP-4 amendment text says — the router file is named agent-users.js but
 * has always been mounted at /users.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockIssue = vi.fn();
const mockRevoke = vi.fn();
const mockAuthority = vi.fn();

const ADMIN_ID = 1;
const OTHER_USER_ID = 42;

const ALLOWED = {
  allowed: true, reason: 'ok',
  actor: { user_id: ADMIN_ID, role: 'admin', global_admin: true },
  space: { id: 7809, admin: true, via: 'owner' },
  agent_row_id: 174642,
};
const DENIED = {
  allowed: false, reason: 'space_admin_required',
  actor: { user_id: OTHER_USER_ID, role: 'admin', global_admin: true },
  space: { id: 7809, admin: false, via: null },
  agent_row_id: 174642,
};

vi.mock('../../../services/agent-users.js', () => ({
  issuePassport: (...a) => mockIssue(...a),
  revokePassport: (...a) => mockRevoke(...a),
}));

vi.mock('../../../services/passportAuthority.js', () => ({
  resolvePassportAuthority: (...a) => mockAuthority(...a),
}));

vi.mock('../../../database/connection.js', () => ({
  dbGet: vi.fn(),
  dbAll: vi.fn(),
  dbRun: vi.fn(),
  safeJsonParse: (raw, fallback) => {
    if (raw && typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
}));

// Authenticate from a test header so one app can act as any user.
vi.mock('../../../middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    const id = req.get('x-test-user');
    if (id) req.user = { id: Number(id), email: 'test@example.com' };
    next();
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { default: router } = await import('../agent-users.js');

const app = express();
app.use(express.json());
app.use('/api/v3/users', router);

beforeEach(() => {
  mockIssue.mockReset();
  mockRevoke.mockReset();
  mockAuthority.mockReset();
  mockAuthority.mockImplementation(async ({ actorUserId }) => {
    if (!actorUserId) return { ...DENIED, reason: 'not_authenticated', actor: { user_id: null, role: null, global_admin: false } };
    return actorUserId === ADMIN_ID ? ALLOWED : DENIED;
  });
});

describe('POST /api/v3/users/:id/passport — issue', () => {
  it('refuses an authenticated actor without authority: 403, reason in body, service never called', async () => {
    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(OTHER_USER_ID))
      .send({ handle: 'cryptoralph' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSPORT_FORBIDDEN');
    expect(res.body.error.details.reason).toBe('space_admin_required');
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller with 403 and never calls the service', async () => {
    const res = await request(app).post('/api/v3/users/900/passport').send({});

    expect(res.status).toBe(403);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('checks authority against the TARGET user, never a client-supplied space', async () => {
    mockIssue.mockResolvedValue({ ok: true, changed: true, user_id: 900, handle: 'cryptoralph' });

    await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(ADMIN_ID))
      .send({ handle: 'cryptoralph', space_id: 11 });

    expect(mockAuthority).toHaveBeenCalledTimes(1);
    expect(mockAuthority.mock.calls[0][0]).toEqual({ actorUserId: ADMIN_ID, userId: 900 });
  });

  it('naturalizes for an authorized admin and threads actor + audit_req into the service', async () => {
    mockIssue.mockResolvedValue({
      ok: true, changed: true, user_id: 900, agent_row_id: 174642, handle: 'cryptoralph',
    });

    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(ADMIN_ID))
      .send({ handle: 'cryptoralph' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.handle).toBe('cryptoralph');

    expect(mockIssue).toHaveBeenCalledTimes(1);
    const arg = mockIssue.mock.calls[0][0];
    expect(arg.user_id).toBe(900);
    expect(arg.handle).toBe('cryptoralph');
    // The human signs the act — not the channel (WP-4 D3/D4).
    expect(arg.actor).toBe(ADMIN_ID);
    expect(arg.audit_req).toBeTruthy();
    expect(arg.audit_req.user.id).toBe(ADMIN_ID);
  });

  it('maps an unresolvable residence from the authority check onto 404 without calling the service', async () => {
    mockAuthority.mockResolvedValue({ ...DENIED, reason: 'residence_not_found', space: { id: null, admin: false, via: null }, agent_row_id: null });

    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(ADMIN_ID))
      .send({});

    expect(res.status).toBe(404);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('fails closed with 500 when the authority check throws rather than elevating', async () => {
    mockAuthority.mockRejectedValue(new Error('db down'));

    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(ADMIN_ID))
      .send({});

    expect(res.status).toBe(500);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('maps a handle already held by another user onto 409', async () => {
    mockIssue.mockResolvedValue({
      ok: false, error: 'handle_taken', message: "Handle 'architect' is already held by user 42 (a@b.c).",
    });

    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(ADMIN_ID))
      .send({ handle: 'architect' });

    expect(res.status).toBe(409);
  });

  it('maps a missing residence from the service onto 404', async () => {
    mockIssue.mockResolvedValue({ ok: false, error: 'residence_not_found', message: 'no residence' });

    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(ADMIN_ID))
      .send({});

    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric id before touching authority or the service', async () => {
    const res = await request(app)
      .post('/api/v3/users/not-a-number/passport')
      .set('x-test-user', String(ADMIN_ID))
      .send({});

    expect(res.status).toBe(400);
    expect(mockAuthority).not.toHaveBeenCalled();
    expect(mockIssue).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v3/users/:id/passport — revoke', () => {
  it('refuses an actor without authority with 403 and never calls the service', async () => {
    const res = await request(app)
      .delete('/api/v3/users/900/passport')
      .set('x-test-user', String(OTHER_USER_ID));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSPORT_FORBIDDEN');
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('soft-revokes for an authorized admin and threads actor + audit_req into the service', async () => {
    mockRevoke.mockResolvedValue({
      ok: true, changed: true, revoked: true, user_id: 900, prior_handle: 'cryptoralph',
    });

    const res = await request(app)
      .delete('/api/v3/users/900/passport')
      .set('x-test-user', String(ADMIN_ID));

    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBe(true);

    const arg = mockRevoke.mock.calls[0][0];
    expect(arg.user_id).toBe(900);
    expect(arg.actor).toBe(ADMIN_ID);
    expect(arg.audit_req.user.id).toBe(ADMIN_ID);
  });

  it('maps an unknown passport onto 404', async () => {
    mockRevoke.mockResolvedValue({ ok: false, error: 'passport_not_found', message: 'nope' });

    const res = await request(app)
      .delete('/api/v3/users/900/passport')
      .set('x-test-user', String(ADMIN_ID));

    expect(res.status).toBe(404);
  });
});

describe('GET /api/v3/users/passport-authority — UI contract', () => {
  it('returns the authority decision for an agent row (space derived server-side)', async () => {
    const res = await request(app)
      .get('/api/v3/users/passport-authority?row_id=174642')
      .set('x-test-user', String(ADMIN_ID));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(ALLOWED);
    expect(mockAuthority.mock.calls[0][0]).toEqual({ actorUserId: ADMIN_ID, rowId: 174642, userId: undefined, spaceId: undefined });
  });

  it('answers a denial with 200 — the decision is the payload, not an error', async () => {
    const res = await request(app)
      .get('/api/v3/users/passport-authority?space_id=7809')
      .set('x-test-user', String(OTHER_USER_ID));

    expect(res.status).toBe(200);
    expect(res.body.data.allowed).toBe(false);
    expect(res.body.data.reason).toBe('space_admin_required');
    expect(mockAuthority.mock.calls[0][0]).toEqual({ actorUserId: OTHER_USER_ID, rowId: undefined, userId: undefined, spaceId: 7809 });
  });

  it('rejects a query without any target with 400', async () => {
    const res = await request(app)
      .get('/api/v3/users/passport-authority')
      .set('x-test-user', String(ADMIN_ID));

    expect(res.status).toBe(400);
    expect(mockAuthority).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric target with 400', async () => {
    const res = await request(app)
      .get('/api/v3/users/passport-authority?row_id=abc')
      .set('x-test-user', String(ADMIN_ID));

    expect(res.status).toBe(400);
    expect(mockAuthority).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v3/users/passport-authority?row_id=174642');

    expect(res.status).toBe(403);
    expect(mockAuthority).not.toHaveBeenCalled();
  });
});
