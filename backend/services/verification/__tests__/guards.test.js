// ADR-0011 · Phase B / ADR-0013 · row-update guards for verification columns.
//
// Covers the refactored enforceVerificationGuards which now resolves
// relation-typed guard columns to their target row's `slug` for C-6 lock
// comparison. Mocks dbAll/dbGet so no real DB hit.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbAllMock = vi.fn();
const dbGetMock = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbAll: (...args) => dbAllMock(...args),
  dbGet: (...args) => dbGetMock(...args),
  safeJsonParse: (v, d = null) => {
    if (!v) return d;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return d; }
  },
}));

const { enforceVerificationGuards } = await import('../guards.js');

const VER_COL = {
  id: 43013,
  column_name: 'plan_verification',
  type: 'verification',
  config: JSON.stringify({
    available_methods: ['totp'],
    required_methods: 1,
    locks_on_statuses: ['approved', 'ready'],
    unlocks_on_statuses: ['draft', 'published', 'archived'],
    guards: ['status_id'],
    policy: 'all',
  }),
};

const STATUS_REL_COL = {
  id: 39545,
  column_name: 'status_id',
  type: 'relation',
  config: JSON.stringify({ target_table_id: 7341, display_column: 'label' }),
};

const STATUS_TEXT_COL = {
  id: 16283,
  column_name: 'status',
  type: 'select',
  config: JSON.stringify({ options: [{ value: 'ready' }, { value: 'draft' }] }),
};

beforeEach(() => {
  dbAllMock.mockReset();
  dbGetMock.mockReset();
});

describe('enforceVerificationGuards — no-op cases', () => {
  it('no verification columns → ok with empty overrides', async () => {
    dbAllMock.mockResolvedValueOnce([{ ...STATUS_REL_COL }]); // no verification col present
    const r = await enforceVerificationGuards({
      tableId: 999, existingData: {}, incomingData: { foo: 'bar' },
    });
    expect(r).toEqual({ ok: true, cellOverrides: {} });
    expect(dbAllMock).toHaveBeenCalledTimes(1);
    expect(dbGetMock).not.toHaveBeenCalled();
  });

  it('non-guarded change while unverified → ok', async () => {
    dbAllMock.mockResolvedValueOnce([VER_COL, STATUS_REL_COL]);
    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: { plan_verification: null, status_id: 127270 },
      incomingData: { name: 'new title' },
    });
    expect(r).toEqual({ ok: true, cellOverrides: {} });
    expect(dbGetMock).not.toHaveBeenCalled();
  });
});

describe('enforceVerificationGuards — direct write rejection', () => {
  it('writing the verification cell directly → 403 VERIFICATION_IMMUTABLE', async () => {
    dbAllMock.mockResolvedValueOnce([VER_COL, STATUS_REL_COL]);
    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: {},
      incomingData: { plan_verification: { verified: true } },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.code).toBe('VERIFICATION_IMMUTABLE');
  });
});

describe('enforceVerificationGuards — C-6 lock with relation-typed guard', () => {
  it('incoming status_id resolves to a locked slug → 409 VERIFICATION_REQUIRED', async () => {
    dbAllMock.mockResolvedValueOnce([VER_COL, STATUS_REL_COL]);
    dbGetMock.mockResolvedValueOnce({ data: JSON.stringify({ slug: 'ready', label: 'Ready' }) });

    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: { plan_verification: null, status_id: 127270 },
      incomingData: { status_id: 127273 }, // 'ready' row
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.code).toBe('VERIFICATION_REQUIRED');
    expect(r.meta.resolved_slug).toBe('ready');
    expect(r.meta.offending_column).toBe('status_id');
  });

  it('incoming status_id resolves to a non-locked slug → ok', async () => {
    dbAllMock.mockResolvedValueOnce([VER_COL, STATUS_REL_COL]);
    dbGetMock.mockResolvedValueOnce({ data: JSON.stringify({ slug: 'draft' }) });

    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: { plan_verification: null, status_id: 127273 },
      incomingData: { status_id: 127270 },
    });
    expect(r.ok).toBe(true);
    expect(r.cellOverrides).toEqual({});
  });

  it('PG JSONB returns object (not string) — handled', async () => {
    dbAllMock.mockResolvedValueOnce([VER_COL, STATUS_REL_COL]);
    dbGetMock.mockResolvedValueOnce({ data: { slug: 'approved' } });

    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: { plan_verification: null },
      incomingData: { status_id: 127272 },
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('VERIFICATION_REQUIRED');
    expect(r.meta.resolved_slug).toBe('approved');
  });

  it('target row missing → no lock triggered, ok', async () => {
    dbAllMock.mockResolvedValueOnce([VER_COL, STATUS_REL_COL]);
    dbGetMock.mockResolvedValueOnce(null);

    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: { plan_verification: null },
      incomingData: { status_id: 99999 },
    });
    expect(r.ok).toBe(true);
  });

  it('verified cell + lock value → C-6 skipped, C-4 fires (regression)', async () => {
    dbAllMock.mockResolvedValueOnce([VER_COL, STATUS_REL_COL]);
    // No dbGet expected — verified short-circuits the C-6 branch.

    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: {
        plan_verification: { verified: true, verified_at: '2026-04-01T00:00:00Z' },
        status_id: 127270,
      },
      incomingData: { status_id: 127273 },
    });
    expect(r.ok).toBe(true);
    expect(r.cellOverrides.plan_verification.verified).toBe(false);
    expect(r.cellOverrides.plan_verification.audit_log[0].event).toBe('regressed');
    expect(r.cellOverrides.plan_verification.audit_log[0].reason).toBe('guard_violation:status_id');
    expect(dbGetMock).not.toHaveBeenCalled();
  });
});

describe('enforceVerificationGuards — C-6 lock with text/select guard (legacy compat)', () => {
  it('incoming text status equals locked value → 409', async () => {
    const VER_TEXT = {
      ...VER_COL,
      config: JSON.stringify({
        locks_on_statuses: ['ready'],
        guards: ['status'],
      }),
    };
    dbAllMock.mockResolvedValueOnce([VER_TEXT, STATUS_TEXT_COL]);

    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: { plan_verification: null, status: 'draft' },
      incomingData: { status: 'ready' },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.meta.resolved_slug).toBe('ready');
    expect(dbGetMock).not.toHaveBeenCalled(); // no relation lookup needed
  });
});

describe('enforceVerificationGuards — C-4 regression on guarded change', () => {
  it('verified=true + status_id changes → cellOverride clears stamp + audit', async () => {
    dbAllMock.mockResolvedValueOnce([VER_COL, STATUS_REL_COL]);

    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: {
        plan_verification: {
          verified: true, verified_at: '2026-04-01T00:00:00Z',
          audit_log: [{ at: '2026-04-01T00:00:00Z', event: 'verified' }],
        },
        status_id: 127272,
      },
      incomingData: { status_id: 127273 },
      userId: 42,
    });
    expect(r.ok).toBe(true);
    const ov = r.cellOverrides.plan_verification;
    expect(ov.verified).toBe(false);
    expect(ov.verified_at).toBeNull();
    expect(ov.audit_log).toHaveLength(2);
    const last = ov.audit_log[1];
    expect(last.event).toBe('regressed');
    expect(last.reason).toBe('guard_violation:status_id');
    expect(last.actor).toBe(42);
    expect(last.transition).toEqual({ column: 'status_id', from: 127272, to: 127273 });
  });

  it('verified=true + same status_id (no-op) → no override', async () => {
    dbAllMock.mockResolvedValueOnce([VER_COL, STATUS_REL_COL]);

    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: {
        plan_verification: { verified: true, verified_at: '2026-04-01T00:00:00Z' },
        status_id: 127273,
      },
      incomingData: { status_id: 127273 },
    });
    expect(r.ok).toBe(true);
    expect(r.cellOverrides).toEqual({});
  });
});

describe('enforceVerificationGuards — slug cache', () => {
  it('repeated lookups of the same target row hit cache (single dbGet)', async () => {
    // Two verification columns, both with the same guarded relation column.
    const VER_A = { ...VER_COL, id: 1, column_name: 'verA' };
    const VER_B = { ...VER_COL, id: 2, column_name: 'verB' };
    dbAllMock.mockResolvedValueOnce([VER_A, VER_B, STATUS_REL_COL]);
    dbGetMock.mockResolvedValueOnce({ data: { slug: 'ready' } });

    const r = await enforceVerificationGuards({
      tableId: 2197,
      existingData: { verA: null, verB: null },
      incomingData: { status_id: 127273 },
    });
    expect(r.ok).toBe(false); // first verification col triggers reject
    expect(dbGetMock).toHaveBeenCalledTimes(1);
  });
});
