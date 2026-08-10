// ADR-0002 §8 Phase 3 — completionGate unit tests.
//
// Covers the three required scenarios:
//   - all Must verified → gate ok
//   - partial verified  → gate fails 409 with blockers list
//   - no Must criteria  → gate ok (no-op for tickets without Must rows)
// Plus: ambiguous tickets — recompute on a ticket that shares a spec with
// other tickets must not pull in criteria that point to a different ticket_id.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbAllMock = vi.fn();
const dbGetMock = vi.fn();
const dbRunMock = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbAll: (...args) => dbAllMock(...args),
  dbGet: (...args) => dbGetMock(...args),
  dbRun: (...args) => dbRunMock(...args),
  isPostgres: () => true,
  safeJsonParse: (v, d = null) => {
    if (v == null) return d;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return d; }
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  aggregateMustCriteria,
  checkCompletionGate,
  computeCriteriaProgress,
  recomputeAndPersistProgress,
  onCriterionChange,
  formatGateError,
} = await import('../completionGate.js');

beforeEach(() => {
  dbAllMock.mockReset();
  dbGetMock.mockReset();
  dbRunMock.mockReset();
});

// ===== aggregateMustCriteria =====

describe('aggregateMustCriteria', () => {
  it('returns zeros for ticket with no criteria', async () => {
    dbAllMock.mockResolvedValueOnce([]);
    const r = await aggregateMustCriteria(42);
    expect(r).toEqual({ must_total: 0, must_verified: 0, blockers: [] });
  });

  it('counts all-verified Must rows', async () => {
    dbAllMock.mockResolvedValueOnce([
      { id: 1, data: { ticket_id: 42, priority: 'must', status: 'verified', code: 'A1', title: 'one' } },
      { id: 2, data: { ticket_id: 42, priority: 'must', status: 'verified', code: 'A2', title: 'two' } },
    ]);
    const r = await aggregateMustCriteria(42);
    expect(r).toEqual({ must_total: 2, must_verified: 2, blockers: [] });
  });

  it('lists unverified Must rows as blockers', async () => {
    dbAllMock.mockResolvedValueOnce([
      { id: 10, data: { ticket_id: 42, priority: 'must', status: 'verified', code: 'A1', title: 'one' } },
      { id: 11, data: { ticket_id: 42, priority: 'must', status: 'pending',  code: 'A2', title: 'two' } },
      { id: 12, data: { ticket_id: 42, priority: 'must', status: 'failed',   code: 'A3', title: 'three' } },
    ]);
    const r = await aggregateMustCriteria(42);
    expect(r.must_total).toBe(3);
    expect(r.must_verified).toBe(1);
    expect(r.blockers).toEqual([
      { id: 11, code: 'A2', title: 'two', status: 'pending' },
      { id: 12, code: 'A3', title: 'three', status: 'failed' },
    ]);
  });

  it('handles serialized JSON data column', async () => {
    dbAllMock.mockResolvedValueOnce([
      { id: 5, data: JSON.stringify({ ticket_id: 7, priority: 'must', status: 'verified' }) },
    ]);
    const r = await aggregateMustCriteria(7);
    expect(r.must_total).toBe(1);
    expect(r.must_verified).toBe(1);
  });
});

// ===== checkCompletionGate =====

describe('checkCompletionGate (G4)', () => {
  it('passes when all Must verified', async () => {
    dbAllMock.mockResolvedValueOnce([
      { id: 1, data: { ticket_id: 1, priority: 'must', status: 'verified' } },
      { id: 2, data: { ticket_id: 1, priority: 'must', status: 'verified' } },
    ]);
    const r = await checkCompletionGate(1);
    expect(r.ok).toBe(true);
    expect(r.must_total).toBe(2);
    expect(r.must_verified).toBe(2);
    expect(r.blockers).toEqual([]);
  });

  it('blocks with blockers when partial', async () => {
    dbAllMock.mockResolvedValueOnce([
      { id: 1, data: { ticket_id: 1, priority: 'must', status: 'verified' } },
      { id: 2, data: { ticket_id: 1, priority: 'must', status: 'pending', code: 'X', title: 'pending' } },
    ]);
    const r = await checkCompletionGate(1);
    expect(r.ok).toBe(false);
    expect(r.must_total).toBe(2);
    expect(r.must_verified).toBe(1);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]).toMatchObject({ id: 2, code: 'X', title: 'pending' });
  });

  it('passes when no Must criteria exist (no-op)', async () => {
    dbAllMock.mockResolvedValueOnce([]); // empty
    const r = await checkCompletionGate(99);
    expect(r.ok).toBe(true);
    expect(r.must_total).toBe(0);
    expect(r.blockers).toEqual([]);
  });
});

// ===== formatGateError =====

describe('formatGateError', () => {
  it('shapes the 409 body with code + counts + failed list', () => {
    const r = formatGateError({
      ok: false,
      must_total: 3,
      must_verified: 1,
      blockers: [{ id: 7, code: 'A2', title: 'two', status: 'pending' }],
    });
    expect(r).toEqual({
      code: 'MUST_CRITERIA_INCOMPLETE',
      must_total: 3,
      must_verified: 1,
      failed: [{ id: 7, code: 'A2', title: 'two', status: 'pending' }],
    });
  });
});

// ===== computeCriteriaProgress =====

describe('computeCriteriaProgress (G6)', () => {
  it('returns string "M/N" when must_total > 0', async () => {
    dbAllMock.mockResolvedValueOnce([
      { id: 1, data: { ticket_id: 1, priority: 'must', status: 'verified' } },
      { id: 2, data: { ticket_id: 1, priority: 'must', status: 'pending' } },
      { id: 3, data: { ticket_id: 1, priority: 'must', status: 'verified' } },
    ]);
    const r = await computeCriteriaProgress(1);
    expect(r.progress).toBe('2/3');
    expect(r.must_total).toBe(3);
    expect(r.must_verified).toBe(2);
  });

  it('returns empty string when no Must criteria', async () => {
    dbAllMock.mockResolvedValueOnce([]);
    const r = await computeCriteriaProgress(99);
    expect(r.progress).toBe('');
    expect(r.must_total).toBe(0);
  });
});

// ===== recomputeAndPersistProgress =====

describe('recomputeAndPersistProgress', () => {
  it('writes new fields when progress differs from stored value', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 100, data: { criteria_progress: '0/0', state: 24276 } });
    dbAllMock.mockResolvedValueOnce([
      { id: 1, data: { ticket_id: 100, priority: 'must', status: 'verified' } },
      { id: 2, data: { ticket_id: 100, priority: 'must', status: 'pending' } },
    ]);
    const r = await recomputeAndPersistProgress(100);
    expect(r.changed).toBe(true);
    expect(r.progress).toBe('1/2');
    expect(dbRunMock).toHaveBeenCalledTimes(1);
    const updateArg = dbRunMock.mock.calls[0][1];
    const writtenJson = JSON.parse(updateArg[0]);
    expect(writtenJson.criteria_progress).toBe('1/2');
    expect(writtenJson.must_total).toBe(2);
    expect(writtenJson.must_verified).toBe(1);
  });

  it('skips UPDATE when value already matches', async () => {
    dbGetMock.mockResolvedValueOnce({
      id: 100,
      data: { criteria_progress: '2/2', must_total: 2, must_verified: 2 },
    });
    dbAllMock.mockResolvedValueOnce([
      { id: 1, data: { ticket_id: 100, priority: 'must', status: 'verified' } },
      { id: 2, data: { ticket_id: 100, priority: 'must', status: 'verified' } },
    ]);
    const r = await recomputeAndPersistProgress(100);
    expect(r.changed).toBe(false);
    expect(dbRunMock).not.toHaveBeenCalled();
  });

  it('returns null when ticket row not found', async () => {
    dbGetMock.mockResolvedValueOnce(null);
    const r = await recomputeAndPersistProgress(999);
    expect(r).toBeNull();
    expect(dbRunMock).not.toHaveBeenCalled();
  });
});

// ===== onCriterionChange — ambiguous criterion isolation =====

describe('onCriterionChange — does not leak between tickets', () => {
  it('recomputes only the old + new ticket_id when criterion is rebound', async () => {
    // Ticket 50 has criterion 1; ticket 60 will receive criterion 1 after move.
    // Other criteria pointing to ticket 50/60 must not affect each other.

    // Sequence: oldData ticket=50, newData ticket=60.
    // First recompute (ticket 50): query returns one remaining Must row.
    // Second recompute (ticket 60): query returns the moved row.

    dbGetMock.mockResolvedValueOnce({ id: 50, data: { criteria_progress: '1/1' } });
    dbAllMock.mockResolvedValueOnce([
      // Just one Must left on ticket 50 after the move (verified).
      { id: 99, data: { ticket_id: 50, priority: 'must', status: 'verified' } },
    ]);

    dbGetMock.mockResolvedValueOnce({ id: 60, data: { criteria_progress: '0/0' } });
    dbAllMock.mockResolvedValueOnce([
      { id: 1, data: { ticket_id: 60, priority: 'must', status: 'pending' } },
    ]);

    await onCriterionChange(
      { ticket_id: 50, priority: 'must', status: 'verified' },
      { ticket_id: 60, priority: 'must', status: 'pending' }
    );

    // Both tickets received an UPDATE.
    expect(dbRunMock).toHaveBeenCalledTimes(2);
    const firstWrite = JSON.parse(dbRunMock.mock.calls[0][1][0]);
    const secondWrite = JSON.parse(dbRunMock.mock.calls[1][1][0]);
    expect(firstWrite.criteria_progress).toBe('1/1');
    expect(secondWrite.criteria_progress).toBe('0/1');
  });

  it('recomputes both old and new tickets on rebind even if status unchanged', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 7, data: {} });
    dbAllMock.mockResolvedValueOnce([]);
    dbGetMock.mockResolvedValueOnce({ id: 8, data: {} });
    dbAllMock.mockResolvedValueOnce([
      { id: 1, data: { ticket_id: 8, priority: 'must', status: 'verified' } },
    ]);

    await onCriterionChange(
      { ticket_id: 7, priority: 'must', status: 'verified' },
      { ticket_id: 8, priority: 'must', status: 'verified' }
    );

    expect(dbRunMock).toHaveBeenCalledTimes(2);
  });

  it('handles INSERT (oldData=null) — recomputes only new ticket', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 30, data: {} });
    dbAllMock.mockResolvedValueOnce([
      { id: 1, data: { ticket_id: 30, priority: 'must', status: 'pending' } },
    ]);
    await onCriterionChange(null, { ticket_id: 30, priority: 'must', status: 'pending' });
    expect(dbRunMock).toHaveBeenCalledTimes(1);
  });

  it('handles DELETE (newData=null) — recomputes only old ticket', async () => {
    dbGetMock.mockResolvedValueOnce({ id: 40, data: { criteria_progress: '1/1' } });
    dbAllMock.mockResolvedValueOnce([]); // criterion is gone
    await onCriterionChange({ ticket_id: 40, priority: 'must', status: 'verified' }, null);
    expect(dbRunMock).toHaveBeenCalledTimes(1);
    const written = JSON.parse(dbRunMock.mock.calls[0][1][0]);
    expect(written.criteria_progress).toBe('');
    expect(written.must_total).toBe(0);
  });
});
