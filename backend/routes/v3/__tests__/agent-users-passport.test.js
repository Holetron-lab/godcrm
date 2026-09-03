// @vitest-environment node
/**
 * ADR-165 WP-4 (D5) — owner-gated naturalization route.
 *
 * AC-6: `POST` / `DELETE /api/v3/users/:id/passport` — 403 for an authenticated
 * non-owner, 200 for the owner, and the owner path threads the real request
 * into the audit row (`audit_req`) so the act is signed by a session rather
 * than by a channel.
 *
 * These routes exist because D1 refuses `issue_passport` / `revoke_passport`
 * for every principal on the tool path: without them there is no issuance path
 * at all. So the refusal cases below assert the SERVICE was never called — not
 * merely that the response was an error.
 *
 * NB the mount is `/api/v3/users` (server.js:348), not `/api/v3/agent-users`
 * as the WP-4 amendment text says — the router file is named agent-users.js
 * but has always been mounted at /users.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockIssue = vi.fn();
const mockRevoke = vi.fn();
const mockDbGet = vi.fn();

const OWNER_ID = 1;
const OTHER_USER_ID = 42;

vi.mock('../../../services/agent-users.js', () => ({
  issuePassport: (...a) => mockIssue(...a),
  revokePassport: (...a) => mockRevoke(...a),
}));

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...a) => mockDbGet(...a),
  dbAll: vi.fn(),
  dbRun: vi.fn(),
  safeJsonParse: (raw, fallback) => {
    if (raw && typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
}));

// Authenticate from a test header so one app can act as owner or non-owner.
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
  mockDbGet.mockReset();
  // Space 11 exists and is owned by user 1 unless a test says otherwise.
  mockDbGet.mockImplementation((sql) =>
    /FROM spaces WHERE id/i.test(sql)
      ? Promise.resolve({ id: 11, owner_id: OWNER_ID })
      : Promise.resolve(null)
  );
});

describe('POST /api/v3/users/:id/passport — issue', () => {
  it('refuses an authenticated non-owner with 403 and never calls the service', async () => {
    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(OTHER_USER_ID))
      .send({ handle: 'cryptoralph' });

    expect(res.status).toBe(403);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller with 403 and never calls the service', async () => {
    const res = await request(app).post('/api/v3/users/900/passport').send({});

    expect(res.status).toBe(403);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it('naturalizes for the owner and threads actor + audit_req into the service', async () => {
    mockIssue.mockResolvedValue({
      ok: true, changed: true, user_id: 900, agent_row_id: 166740, handle: 'cryptoralph',
    });

    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(OWNER_ID))
      .send({ handle: 'cryptoralph' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.handle).toBe('cryptoralph');

    expect(mockIssue).toHaveBeenCalledTimes(1);
    const arg = mockIssue.mock.calls[0][0];
    expect(arg.user_id).toBe(900);
    expect(arg.handle).toBe('cryptoralph');
    // The owner signs the act — not the channel (WP-4 D3/D4).
    expect(arg.actor).toBe(OWNER_ID);
    expect(arg.audit_req).toBeTruthy();
    expect(arg.audit_req.user.id).toBe(OWNER_ID);
  });

  it('fails closed with 500 when the owner space is missing rather than elevating', async () => {
    mockDbGet.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(OWNER_ID))
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
      .set('x-test-user', String(OWNER_ID))
      .send({ handle: 'architect' });

    expect(res.status).toBe(409);
  });

  it('maps a missing residence onto 404', async () => {
    mockIssue.mockResolvedValue({ ok: false, error: 'residence_not_found', message: 'no residence' });

    const res = await request(app)
      .post('/api/v3/users/900/passport')
      .set('x-test-user', String(OWNER_ID))
      .send({});

    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric id before touching the service', async () => {
    const res = await request(app)
      .post('/api/v3/users/not-a-number/passport')
      .set('x-test-user', String(OWNER_ID))
      .send({});

    expect(res.status).toBe(400);
    expect(mockIssue).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v3/users/:id/passport — revoke', () => {
  it('refuses an authenticated non-owner with 403 and never calls the service', async () => {
    const res = await request(app)
      .delete('/api/v3/users/900/passport')
      .set('x-test-user', String(OTHER_USER_ID));

    expect(res.status).toBe(403);
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('soft-revokes for the owner and threads actor + audit_req into the service', async () => {
    mockRevoke.mockResolvedValue({
      ok: true, changed: true, revoked: true, user_id: 900, prior_handle: 'cryptoralph',
    });

    const res = await request(app)
      .delete('/api/v3/users/900/passport')
      .set('x-test-user', String(OWNER_ID));

    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBe(true);

    const arg = mockRevoke.mock.calls[0][0];
    expect(arg.user_id).toBe(900);
    expect(arg.actor).toBe(OWNER_ID);
    expect(arg.audit_req.user.id).toBe(OWNER_ID);
  });

  it('maps an unknown passport onto 404', async () => {
    mockRevoke.mockResolvedValue({ ok: false, error: 'passport_not_found', message: 'nope' });

    const res = await request(app)
      .delete('/api/v3/users/900/passport')
      .set('x-test-user', String(OWNER_ID));

    expect(res.status).toBe(404);
  });
});
