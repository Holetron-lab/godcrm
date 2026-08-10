/**
 * Agent Run Dispatcher API Routes Tests — ADR-0030 Phase 5.
 *
 * HTTP-layer tests for `backend/routes/v3/agentRunDispatcher.js`. The
 * underlying pure module (`approval-gate.js`) is covered by
 * `scripts/smoke-adr0030-p5.mjs`; this file locks down the routes.
 *
 * Test isolation (ADR-0009): boot guard `backend/test/setup.js` (wired into
 * vitest.config.ts) refuses to run unless POSTGRES_DB!=godcrm_prod and
 * BUSINESS_CRM_IS_PROD!=1. Run via:
 *   BUSINESS_CRM_IS_PROD= POSTGRES_DB=godcrm_test POSTGRES_HOST=localhost \
 *     npx vitest run backend/routes/v3/__tests__/agent-run-dispatcher.test.js
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

import { authenticate } from '../../../middleware/auth.js';
import dispatcherRouter from '../agentRunDispatcher.js';
import { dbRun, dbGet } from '../../../database/connection.js';
import {
  generateApprovalCode,
  persistApprovalRequest,
  resolveApproval,
  APPROVAL_CONSTANTS,
} from '../../../services/agent-run-dispatcher/approval-gate.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-vitest';
const TICKETS_TABLE_ID = 1708;
const SMOKE_TAG_PREFIX = 'route_test_';

// ─── App setup ─────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v3', authenticate, dispatcherRouter);

// ─── Helpers ───────────────────────────────────────────────

function genBaseId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function makeJwt({ id, email = 'route-test@hltrn.cc', role = 'user' } = {}) {
  return jwt.sign({ id, email, role }, JWT_SECRET, { expiresIn: '1h' });
}

let userIdCounter = 9_000_001;
function nextUserId() {
  return userIdCounter++;
}

async function insertTicket({ smokeTag, assignedTo = null, runState = null, extra = {} } = {}) {
  const data = {
    title: `Route test ticket ${smokeTag}`,
    smoke_tag: smokeTag,
    ...extra,
  };
  if (assignedTo != null) data.assigned_to = String(assignedTo);
  if (runState != null) data.run_state = runState;

  const row = await dbGet(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING id`,
    [TICKETS_TABLE_ID, genBaseId(), JSON.stringify(data)]
  );
  return row.id;
}

async function getTicketData(ticketId) {
  const row = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = $1 AND id = $2`,
    [TICKETS_TABLE_ID, ticketId]
  );
  if (!row?.data) return null;
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
}

/**
 * Create a ticket already in `awaiting_approval` with a known plaintext code.
 * Returns { ticketId, code }.
 */
async function makeTicketWithApproval({ smokeTag, assignedTo = null, expiresAtOverride = null }) {
  const ticketId = await insertTicket({
    smokeTag,
    assignedTo,
    runState: 'preparing',
  });
  const { code, code_hash, expires_at, generated_at } = generateApprovalCode();
  const finalExpires = expiresAtOverride || expires_at;
  await persistApprovalRequest(ticketId, {
    code_hash,
    expires_at: finalExpires,
    generated_at,
  });
  return { ticketId, code };
}

async function cleanupAllSmokeRows() {
  await dbRun(
    `DELETE FROM table_rows WHERE data->>'smoke_tag' LIKE $1`,
    [`${SMOKE_TAG_PREFIX}%`]
  ).catch(() => {});
}

// ─── Test suite ────────────────────────────────────────────

describe('Agent Run Dispatcher API (v3) — ADR-0030 Phase 5', () => {
  beforeAll(async () => {
    // Pre-flight scrub of any leftovers from previous runs.
    await cleanupAllSmokeRows();
  });

  afterAll(async () => {
    await cleanupAllSmokeRows();
  });

  afterEach(async () => {
    await cleanupAllSmokeRows();
  });

  // ============================================================
  // POST /api/v3/admin/agent-run-dispatcher/tick
  // ============================================================
  describe('POST /admin/agent-run-dispatcher/tick', () => {
    test('non-admin → 403 forbidden', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'user' });
      const res = await request(app)
        .post('/api/v3/admin/agent-run-dispatcher/tick')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('admin → 200 with stats object', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      const res = await request(app)
        .post('/api/v3/admin/agent-run-dispatcher/tick')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      // Stats keys defined in runTick().
      expect(typeof res.body.data.picked).toBe('number');
      expect(typeof res.body.data.errors).toBe('number');
      expect(typeof res.body.data.duration_ms).toBe('number');
    });

    test('does not crash when no claimable tickets exist', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      const res = await request(app)
        .post('/api/v3/admin/agent-run-dispatcher/tick')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      // Even with zero claimable, errors should be 0.
      expect(res.body.data.errors).toBe(0);
    });
  });

  // ============================================================
  // GET /api/v3/admin/agent-run-dispatcher/health
  // ============================================================
  describe('GET /admin/agent-run-dispatcher/health', () => {
    test('non-admin → 403', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'user' });
      const res = await request(app)
        .get('/api/v3/admin/agent-run-dispatcher/health')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('admin → 200 with ok/running/phase/awaitingApprovalCount', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      const res = await request(app)
        .get('/api/v3/admin/agent-run-dispatcher/health')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      const h = res.body.data;
      expect(h).toHaveProperty('ok');
      expect(h).toHaveProperty('running');
      expect(h).toHaveProperty('phase');
      expect(h).toHaveProperty('awaitingApprovalCount');
    });

    test('healthAsync awaitingApprovalCount counts awaiting tickets', async () => {
      const tag = `${SMOKE_TAG_PREFIX}health_count_${Date.now()}`;
      // Insert two awaiting_approval tickets.
      await makeTicketWithApproval({ smokeTag: tag });
      await makeTicketWithApproval({ smokeTag: tag });

      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      const res = await request(app)
        .get('/api/v3/admin/agent-run-dispatcher/health')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data.awaitingApprovalCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================
  // GET /api/v3/admin/agent-run-dispatcher/pending
  // ============================================================
  describe('GET /admin/agent-run-dispatcher/pending', () => {
    test('non-admin → 403', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'user' });
      const res = await request(app)
        .get('/api/v3/admin/agent-run-dispatcher/pending')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('admin with no awaiting_approval tickets → empty pending + counts', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      const res = await request(app)
        .get('/api/v3/admin/agent-run-dispatcher/pending')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      const d = res.body.data;
      expect(Array.isArray(d.pending)).toBe(true);
      expect(typeof d.count).toBe('number');
      expect(d.max_attempts).toBe(APPROVAL_CONSTANTS.MAX_ATTEMPTS);
      expect(d.ttl_ms).toBe(APPROVAL_CONSTANTS.TTL_MS);
    });

    test('admin with awaiting tickets → projection excludes code_hash and code', async () => {
      const tag = `${SMOKE_TAG_PREFIX}pending_proj_${Date.now()}`;
      const userId = nextUserId();
      const { ticketId } = await makeTicketWithApproval({
        smokeTag: tag,
        assignedTo: userId,
      });

      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      const res = await request(app)
        .get('/api/v3/admin/agent-run-dispatcher/pending')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Find our ticket in the list.
      const mine = res.body.data.pending.find((p) => p.id === ticketId);
      expect(mine).toBeDefined();
      // Only safe projection fields.
      expect(mine).toHaveProperty('id');
      expect(mine).toHaveProperty('title');
      expect(mine).toHaveProperty('expires_at');
      expect(mine).toHaveProperty('attempts');
      expect(mine).toHaveProperty('assigned_to');
      // Code material MUST NOT leak.
      expect(mine).not.toHaveProperty('code');
      expect(mine).not.toHaveProperty('code_hash');
      // Pull the actual stored hash and ensure no field carries it.
      const data = await getTicketData(ticketId);
      const storedHash = data.run_approval.code_hash;
      const serialized = JSON.stringify(mine);
      expect(serialized.includes(storedHash)).toBe(false);
    });
  });

  // ============================================================
  // POST /api/v3/admin/agent-run-dispatcher/approve/:ticketId
  // ============================================================
  describe('POST /admin/agent-run-dispatcher/approve/:ticketId', () => {
    test('non-numeric ticketId → 400 BAD_TICKET_ID', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      const res = await request(app)
        .post('/api/v3/admin/agent-run-dispatcher/approve/abc')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '123456' })
        .expect(400);
      expect(res.body.error.code).toBe('BAD_TICKET_ID');
    });

    test('bad code (not 6 digits) → 400 BAD_CODE', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      // Use a positive ticketId; the code-shape check happens before lookup.
      const res = await request(app)
        .post('/api/v3/admin/agent-run-dispatcher/approve/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '12345' })
        .expect(400);
      expect(res.body.error.code).toBe('BAD_CODE');

      const resMissing = await request(app)
        .post('/api/v3/admin/agent-run-dispatcher/approve/1')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
      expect(resMissing.body.error.code).toBe('BAD_CODE');

      const resAlpha = await request(app)
        .post('/api/v3/admin/agent-run-dispatcher/approve/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'abcdef' })
        .expect(400);
      expect(resAlpha.body.error.code).toBe('BAD_CODE');
    });

    test('ticket not found → 404 TICKET_NOT_FOUND', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      // Use a ticket id that almost certainly does not exist.
      const res = await request(app)
        .post('/api/v3/admin/agent-run-dispatcher/approve/2147483640')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '123456' })
        .expect(404);
      expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
    });

    test('user neither admin nor assignee → 403', async () => {
      const tag = `${SMOKE_TAG_PREFIX}approve_forbid_${Date.now()}`;
      const ownerId = nextUserId();
      const { ticketId, code } = await makeTicketWithApproval({
        smokeTag: tag,
        assignedTo: ownerId,
      });
      const otherUserId = nextUserId();
      const token = makeJwt({ id: otherUserId, role: 'user' });
      const res = await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/approve/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('assignee submits wrong code → 401 APPROVAL_CODE_MISMATCH with attempts_remaining decremented', async () => {
      const tag = `${SMOKE_TAG_PREFIX}approve_wrong_${Date.now()}`;
      const ownerId = nextUserId();
      const { ticketId } = await makeTicketWithApproval({
        smokeTag: tag,
        assignedTo: ownerId,
      });
      const token = makeJwt({ id: ownerId, role: 'user' });
      const res = await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/approve/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '000000' })
        .expect(401);
      expect(res.body.error.code).toBe('APPROVAL_CODE_MISMATCH');
      expect(res.body.error.details.attempts_remaining).toBe(APPROVAL_CONSTANTS.MAX_ATTEMPTS - 1);
    });

    test('5 wrong codes → final returns 401 APPROVAL_DENIED + ticket run_state=failed', async () => {
      const tag = `${SMOKE_TAG_PREFIX}approve_lockout_${Date.now()}`;
      const ownerId = nextUserId();
      const { ticketId } = await makeTicketWithApproval({
        smokeTag: tag,
        assignedTo: ownerId,
      });
      const token = makeJwt({ id: ownerId, role: 'user' });

      let lastRes;
      for (let i = 0; i < APPROVAL_CONSTANTS.MAX_ATTEMPTS; i++) {
        lastRes = await request(app)
          .post(`/api/v3/admin/agent-run-dispatcher/approve/${ticketId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ code: '000000' });
      }
      expect(lastRes.status).toBe(401);
      expect(lastRes.body.error.code).toBe('APPROVAL_DENIED');
      expect(lastRes.body.error.details.state).toBe('denied');

      const data = await getTicketData(ticketId);
      expect(data.run_state).toBe('failed');
      expect(data.run_terminal_reason).toBe('approval_denied');
    });

    test('correct code → 200 approved + ticket run_state=preparing', async () => {
      const tag = `${SMOKE_TAG_PREFIX}approve_ok_${Date.now()}`;
      const ownerId = nextUserId();
      const { ticketId, code } = await makeTicketWithApproval({
        smokeTag: tag,
        assignedTo: ownerId,
      });
      const token = makeJwt({ id: nextUserId(), role: 'admin' });

      const res = await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/approve/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code })
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.state).toBe('approved');
      expect(res.body.data.ticketId).toBe(ticketId);

      const data = await getTicketData(ticketId);
      expect(data.run_state).toBe('preparing');
      expect(data.run_approval.state).toBe('approved');
    });

    test('approve twice → second call 410 APPROVAL_ALREADY_RESOLVED', async () => {
      const tag = `${SMOKE_TAG_PREFIX}approve_twice_${Date.now()}`;
      const { ticketId, code } = await makeTicketWithApproval({ smokeTag: tag });
      const token = makeJwt({ id: nextUserId(), role: 'admin' });

      await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/approve/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code })
        .expect(200);

      const res2 = await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/approve/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code })
        .expect(410);
      expect(res2.body.error.code).toBe('APPROVAL_ALREADY_RESOLVED');
      expect(res2.body.error.details.state).toBe('approved');
    });

    test('expired (expires_at in the past) → 410 APPROVAL_EXPIRED + run_approval.state=expired', async () => {
      const tag = `${SMOKE_TAG_PREFIX}approve_expired_${Date.now()}`;
      const pastIso = new Date(Date.now() - 60_000).toISOString();
      const { ticketId, code } = await makeTicketWithApproval({
        smokeTag: tag,
        expiresAtOverride: pastIso,
      });
      const token = makeJwt({ id: nextUserId(), role: 'admin' });

      const res = await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/approve/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code })
        .expect(410);
      expect(res.body.error.code).toBe('APPROVAL_EXPIRED');

      const data = await getTicketData(ticketId);
      expect(data.run_approval.state).toBe('expired');
    });

    test('no run_approval at all → 410 NO_PENDING_APPROVAL', async () => {
      const tag = `${SMOKE_TAG_PREFIX}approve_nopending_${Date.now()}`;
      const ticketId = await insertTicket({ smokeTag: tag });
      const token = makeJwt({ id: nextUserId(), role: 'admin' });

      const res = await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/approve/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '123456' })
        .expect(410);
      expect(res.body.error.code).toBe('NO_PENDING_APPROVAL');
    });
  });

  // ============================================================
  // POST /api/v3/admin/agent-run-dispatcher/deny/:ticketId
  // ============================================================
  describe('POST /admin/agent-run-dispatcher/deny/:ticketId', () => {
    test('non-admin/non-assignee → 403', async () => {
      const tag = `${SMOKE_TAG_PREFIX}deny_forbid_${Date.now()}`;
      const ownerId = nextUserId();
      const { ticketId } = await makeTicketWithApproval({
        smokeTag: tag,
        assignedTo: ownerId,
      });
      const token = makeJwt({ id: nextUserId(), role: 'user' });
      const res = await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/deny/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    test('ticket not found → 404', async () => {
      const token = makeJwt({ id: nextUserId(), role: 'admin' });
      const res = await request(app)
        .post('/api/v3/admin/agent-run-dispatcher/deny/2147483641')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(404);
      expect(res.body.error.code).toBe('TICKET_NOT_FOUND');
    });

    test('admin denies → 200 denied + ticket run_state=failed', async () => {
      const tag = `${SMOKE_TAG_PREFIX}deny_ok_${Date.now()}`;
      const { ticketId } = await makeTicketWithApproval({ smokeTag: tag });
      const token = makeJwt({ id: nextUserId(), role: 'admin' });

      const res = await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/deny/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.state).toBe('denied');

      const data = await getTicketData(ticketId);
      expect(data.run_state).toBe('failed');
      expect(data.run_terminal_reason).toBe('approval_denied');
      expect(data.run_approval.state).toBe('denied');
    });

    test('deny when nothing pending → 410 NO_PENDING_APPROVAL', async () => {
      const tag = `${SMOKE_TAG_PREFIX}deny_nopending_${Date.now()}`;
      const ticketId = await insertTicket({ smokeTag: tag });
      const token = makeJwt({ id: nextUserId(), role: 'admin' });

      const res = await request(app)
        .post(`/api/v3/admin/agent-run-dispatcher/deny/${ticketId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(410);
      expect(res.body.error.code).toBe('NO_PENDING_APPROVAL');
    });
  });
});
