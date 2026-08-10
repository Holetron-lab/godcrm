// backend/services/audit/__tests__/verifyAuditChain.test.js
//
// ADR-0066-A §C — DB wrapper around the pure verifier. The tamper logic
// itself is covered by auditChain.test.js (verifyChainRows); here we test
// cutover handling, the from_id partial-verify seed, head emission, and
// the good/tampered integration path. DB is mocked (ADR-0009).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbGet = vi.fn();
const dbAll = vi.fn();
vi.mock('../../../database/connection.js', () => ({ dbGet, dbAll }));

const { verifyAuditChain, getCutoverId } = await import('../verifyAuditChain.js');
const { computeEntryHash } = await import('../auditChain.js');

const GENESIS = {
  id: 1,
  user_id: 7,
  acting_as: null,
  action: 'row.create',
  entity_type: 'table_row',
  entity_id: '12345',
  details: '{"table_id":1708}',
  request_id: 'req-a',
  space_id: 11,
  ip_addr: '203.0.113.7',
  created_at: new Date('2026-08-02T10:29:44.000Z'),
};
const ROW2 = {
  id: 2,
  user_id: 7,
  acting_as: null,
  action: 'row.update',
  entity_type: 'table_row',
  entity_id: '12345',
  details: null,
  request_id: 'req-b',
  space_id: 11,
  ip_addr: '203.0.113.7',
  created_at: new Date('2026-08-02T10:30:00.000Z'),
};

const G = computeEntryHash(null, GENESIS);
const R2 = computeEntryHash(G, ROW2);

function validRows() {
  return [
    { ...GENESIS, prev_hash: null, entry_hash: G },
    { ...ROW2, prev_hash: G, entry_hash: R2 },
  ];
}

// dbGet resolver: distinguishes the cutover lookup from the seed lookup.
function mockDb({ cutover = 0, seed = null, rows = validRows() } = {}) {
  dbGet.mockImplementation(async (sql) => {
    if (/audit_chain_meta/.test(sql)) return cutover == null ? null : { value: cutover };
    if (/id < \?/.test(sql)) return seed; // predecessor seed
    return null;
  });
  dbAll.mockResolvedValue(rows);
}

beforeEach(() => {
  dbGet.mockReset();
  dbAll.mockReset();
});

describe('getCutoverId', () => {
  it('reads the meta row', async () => {
    mockDb({ cutover: 42 });
    expect(await getCutoverId()).toBe(42);
  });
  it('defaults to 0 when the meta row is absent', async () => {
    mockDb({ cutover: null });
    expect(await getCutoverId()).toBe(0);
  });
});

describe('verifyAuditChain', () => {
  it('returns ok:true with checked count, cutover, and head on a clean chain', async () => {
    mockDb({ cutover: 0 });
    const res = await verifyAuditChain();
    expect(res).toEqual({
      ok: true,
      checked: 2,
      break_at_id: null,
      cutover_id: 0,
      head: { max_id: 2, entry_hash: R2.toString('hex') },
    });
    // Full verify walks strictly above cutover.
    expect(dbAll).toHaveBeenCalledWith(expect.stringMatching(/id >= \?/), [1]);
  });

  it('returns ok:false with break_at_id when a row is tampered', async () => {
    const rows = validRows();
    rows[1] = { ...rows[1], action: 'row.delete' }; // stored hash no longer matches
    mockDb({ cutover: 0, rows });
    const res = await verifyAuditChain();
    expect(res.ok).toBe(false);
    expect(res.break_at_id).toBe(2);
    expect(res.checked).toBe(1);
  });

  it('excludes pre-cutover rows (walks id > cutover only)', async () => {
    mockDb({ cutover: 5, rows: [] });
    const res = await verifyAuditChain();
    expect(dbAll).toHaveBeenCalledWith(expect.stringMatching(/id >= \?/), [6]);
    expect(res).toMatchObject({ ok: true, checked: 0, cutover_id: 5, head: null });
  });

  it('seeds a partial verify from the predecessor hash (from_id)', async () => {
    // Verify only row 2, seeded from genesis hash as anchor.
    mockDb({ cutover: 0, seed: { entry_hash: G }, rows: [validRows()[1]] });
    const res = await verifyAuditChain(2);
    expect(dbAll).toHaveBeenCalledWith(expect.stringMatching(/id >= \?/), [2]);
    expect(res).toMatchObject({ ok: true, checked: 1, break_at_id: null });
  });

  it('flags a partial verify whose first row does not link to the seed', async () => {
    const wrongSeed = Buffer.from('99'.repeat(32), 'hex');
    mockDb({ cutover: 0, seed: { entry_hash: wrongSeed }, rows: [validRows()[1]] });
    const res = await verifyAuditChain(2);
    expect(res.ok).toBe(false);
    expect(res.break_at_id).toBe(2);
  });
});
