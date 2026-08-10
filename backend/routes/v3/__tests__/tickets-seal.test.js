/**
 * ADR-0002 §8 Phase 4 — Ticket seal (TOTP-act) tests.
 *
 * Endpoints:
 *   POST /api/v3/tickets/:id/seal   body: { totp_code, notes? }
 *   POST /api/v3/tickets/:id/unseal body: { totp_code, reason }
 *
 * Scenarios covered (per A4.x acceptance):
 *   1. Success: gate green + valid TOTP → 200 + sealed_at written
 *   2. Bad TOTP → 401 TICKET_SEAL_TOTP_INVALID, no audit row touches Tickets
 *   3. Gate fail → 409 MUST_CRITERIA_INCOMPLETE
 *   4. Double-seal (already sealed) → 409 TICKET_ALREADY_SEALED
 *   5. Unseal without reason → 400
 *   6. Unseal with valid TOTP + reason → 200 + sealed_* cleared
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// ===== MOCKS =====
// Mock all DB/IO surfaces. Keeps the test hermetic — no DB / no speakeasy.

const mockDbGet = vi.fn();
const mockDbRun = vi.fn();
const mockDbAll = vi.fn();
const mockTrxRun = vi.fn();
const mockTrxGet = vi.fn();
const mockWithTransactionAsync = vi.fn(async (cb) =>
  cb({ run: mockTrxRun, get: mockTrxGet }),
);

vi.mock('../../../database/connection.js', () => ({
  dbGet: (...args) => mockDbGet(...args),
  dbRun: (...args) => mockDbRun(...args),
  dbAll: (...args) => mockDbAll(...args),
  isPostgres: () => true,
  safeJsonParse: (v, d) => {
    if (v == null) return d;
    if (typeof v === 'object') return v;
    try {
      return JSON.parse(v);
    } catch {
      return d;
    }
  },
  withTransactionAsync: (cb) => mockWithTransactionAsync(cb),
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../utils/baseId.js', () => ({
  generateBaseId: () => 'test-base-id-001',
}));

const mockSpeakeasyVerify = vi.fn();
vi.mock('speakeasy', () => ({
  default: {
    totp: { verify: (...args) => mockSpeakeasyVerify(...args) },
  },
  totp: { verify: (...args) => mockSpeakeasyVerify(...args) },
}));

const mockCheckCompletionGate = vi.fn();
vi.mock('../../../services/bdd/completionGate.js', () => ({
  checkCompletionGate: (...args) => mockCheckCompletionGate(...args),
  formatGateError: (gate) => ({
    code: 'MUST_CRITERIA_INCOMPLETE',
    must_total: gate.must_total,
    must_verified: gate.must_verified,
    failed: gate.blockers,
  }),
}));

// Bypass the per-IP rate limiter — its window persists across tests if not stubbed.
vi.mock('../bdd/shared.js', () => ({
  totpLimiter: (req, res, next) => next(),
}));

// Import AFTER mocks
import registerSealRoutes from '../tickets/seal.js';

const TICKETS_TABLE_ID = 1708;
const SEAL_TABLE_ID = 9850;

// ===== TEST APP =====

function createApp(userOverride = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 42, role: 'admin', user_type: 'human', ...userOverride };
    next();
  });
  const router = express.Router();
  registerSealRoutes(router);
  app.use('/api/v3', router);
  return app;
}

/**
 * Configure mockDbGet to mimic the seal flow:
 *   - lookup ticket_seal_verification table-id by name
 *   - load Tickets row
 *   - load users row for TOTP verify
 */
function primeDbGet({ ticket, user }) {
  mockDbGet.mockImplementation(async (sql, params) => {
    if (typeof sql !== 'string') return null;
    if (sql.includes('FROM universal_tables')) {
      return { id: SEAL_TABLE_ID };
    }
    if (sql.includes('FROM table_rows') && Array.isArray(params) && params[1] === TICKETS_TABLE_ID) {
      return ticket ? { id: ticket.id, data: ticket.data } : null;
    }
    if (sql.includes('FROM users')) {
      return user;
    }
    return null;
  });
  // Inside-txn re-read of Tickets row
  mockTrxGet.mockImplementation(async () => (ticket ? { id: ticket.id, data: ticket.data } : null));
  mockTrxRun.mockResolvedValue({ changes: 1 });
}

// ===== TESTS =====

describe('ADR-0002 §8 Phase 4: POST /tickets/:id/seal', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('A4.3 success — green gate + valid TOTP → 200 + sealed_at', async () => {
    primeDbGet({
      ticket: { id: 999, data: { state: 24276, criteria_progress: '3/3' } },
      user: { totp_secret: 'JBSWY3DPEHPK3PXP', totp_enabled: 1, user_type: 'human' },
    });
    mockCheckCompletionGate.mockResolvedValue({
      ok: true,
      must_total: 3,
      must_verified: 3,
      blockers: [],
    });
    mockSpeakeasyVerify.mockReturnValue(true);

    const res = await request(app)
      .post('/api/v3/tickets/999/seal')
      .send({ totp_code: '123456', notes: 'sprint complete' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ticket_id).toBe(999);
    expect(res.body.data.sealed_by).toBe(42);
    expect(typeof res.body.data.sealed_at).toBe('string');

    // Audit row INSERT inside txn + Tickets UPDATE inside txn (2 calls).
    expect(mockTrxRun).toHaveBeenCalledTimes(2);
    const insertCall = mockTrxRun.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO table_rows');
    expect(insertCall[1][0]).toBe(SEAL_TABLE_ID);
    const auditPayload = JSON.parse(insertCall[1][2]);
    expect(auditPayload.action).toBe('sealed');
    expect(auditPayload.ticket_id).toBe(999);
    expect(auditPayload.user_id).toBe(42);
    expect(auditPayload.totp_proof).toMatch(/^[0-9a-f]{64}$/);
  });

  it('A4.x bad TOTP → 401 TICKET_SEAL_TOTP_INVALID, no audit row inserted', async () => {
    primeDbGet({
      ticket: { id: 999, data: { state: 24276 } },
      user: { totp_secret: 'JBSWY3DPEHPK3PXP', totp_enabled: 1, user_type: 'human' },
    });
    mockCheckCompletionGate.mockResolvedValue({
      ok: true,
      must_total: 0,
      must_verified: 0,
      blockers: [],
    });
    mockSpeakeasyVerify.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v3/tickets/999/seal')
      .send({ totp_code: '000000' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TICKET_SEAL_TOTP_INVALID');
    expect(mockTrxRun).not.toHaveBeenCalled();
    expect(mockWithTransactionAsync).not.toHaveBeenCalled();
  });

  it('A4.3 gate fail → 409 MUST_CRITERIA_INCOMPLETE', async () => {
    primeDbGet({
      ticket: { id: 999, data: { state: 24276 } },
      user: { totp_secret: 'JBSWY3DPEHPK3PXP', totp_enabled: 1, user_type: 'human' },
    });
    mockCheckCompletionGate.mockResolvedValue({
      ok: false,
      must_total: 3,
      must_verified: 1,
      blockers: [
        { id: 7001, code: 'A1', title: 'Login', status: 'pending' },
        { id: 7002, code: 'A2', title: 'Logout', status: 'pending' },
      ],
    });

    const res = await request(app)
      .post('/api/v3/tickets/999/seal')
      .send({ totp_code: '123456' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MUST_CRITERIA_INCOMPLETE');
    expect(res.body.error.details.must_total).toBe(3);
    expect(res.body.error.details.must_verified).toBe(1);
    expect(res.body.error.details.failed).toHaveLength(2);
    // TOTP must NOT be checked when gate is red — fail-fast.
    expect(mockSpeakeasyVerify).not.toHaveBeenCalled();
  });

  it('A4.x double-seal → 409 TICKET_ALREADY_SEALED', async () => {
    primeDbGet({
      ticket: {
        id: 999,
        data: {
          state: 24276,
          sealed_at: '2026-05-01T10:00:00.000Z',
          sealed_by: '42',
        },
      },
      user: { totp_secret: 'JBSWY3DPEHPK3PXP', totp_enabled: 1, user_type: 'human' },
    });

    const res = await request(app)
      .post('/api/v3/tickets/999/seal')
      .send({ totp_code: '123456' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TICKET_ALREADY_SEALED');
    expect(mockCheckCompletionGate).not.toHaveBeenCalled();
  });

  it('A4.x ticket not found → 404', async () => {
    primeDbGet({ ticket: null, user: null });
    const res = await request(app)
      .post('/api/v3/tickets/999/seal')
      .send({ totp_code: '123456' });
    expect(res.status).toBe(404);
  });
});

describe('ADR-0002 §8 Phase 4: POST /tickets/:id/unseal', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('A4.4 success — sealed ticket + TOTP + reason → 200 + sealed_* cleared', async () => {
    primeDbGet({
      ticket: {
        id: 999,
        data: {
          state: 24278, // done
          sealed_at: '2026-05-01T10:00:00.000Z',
          sealed_by: '42',
          seal_proof: 'abc',
        },
      },
      user: { totp_secret: 'JBSWY3DPEHPK3PXP', totp_enabled: 1, user_type: 'human' },
    });
    mockSpeakeasyVerify.mockReturnValue(true);

    const res = await request(app)
      .post('/api/v3/tickets/999/unseal')
      .send({ totp_code: '123456', reason: 'rework requested by QA' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockTrxRun).toHaveBeenCalledTimes(2);
    const auditPayload = JSON.parse(mockTrxRun.mock.calls[0][1][2]);
    expect(auditPayload.action).toBe('broken');
    expect(auditPayload.reason).toBe('rework requested by QA');
  });

  it('A4.4 unseal without reason → 400', async () => {
    primeDbGet({
      ticket: {
        id: 999,
        data: { sealed_at: '2026-05-01T10:00:00.000Z', sealed_by: '42' },
      },
      user: { totp_secret: 'X', totp_enabled: 1, user_type: 'human' },
    });
    const res = await request(app)
      .post('/api/v3/tickets/999/unseal')
      .send({ totp_code: '123456' });
    expect(res.status).toBe(400);
  });

  it('unseal a non-sealed ticket → 409 TICKET_NOT_SEALED', async () => {
    primeDbGet({
      ticket: { id: 999, data: { state: 24276 } },
      user: { totp_secret: 'X', totp_enabled: 1, user_type: 'human' },
    });
    const res = await request(app)
      .post('/api/v3/tickets/999/unseal')
      .send({ totp_code: '123456', reason: 'no-op test' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TICKET_NOT_SEALED');
  });

  it('A4.4 unseal with bad TOTP → 401, sealed_* untouched', async () => {
    primeDbGet({
      ticket: {
        id: 999,
        data: { sealed_at: '2026-05-01T10:00:00.000Z', sealed_by: '42' },
      },
      user: { totp_secret: 'X', totp_enabled: 1, user_type: 'human' },
    });
    mockSpeakeasyVerify.mockReturnValue(false);

    const res = await request(app)
      .post('/api/v3/tickets/999/unseal')
      .send({ totp_code: 'wrong', reason: 'rework' });
    expect(res.status).toBe(401);
    expect(mockWithTransactionAsync).not.toHaveBeenCalled();
  });
});
