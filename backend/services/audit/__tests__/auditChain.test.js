// backend/services/audit/__tests__/auditChain.test.js
//
// ADR-0066-A — golden-vector + determinism tests for the FROZEN chain
// core (Risk R5). If these fail after a code change, the canonical
// serialization or digest changed: every previously-written entry_hash
// is now invalid. Either revert, or bump CHAIN_VERSION and regenerate
// the vectors deliberately with a documented re-hash/cutover plan.
//
// Pure CPU — no DB, no mocks needed.

import { describe, it, expect } from 'vitest';
import {
  CHAIN_VERSION,
  canonicalizeAuditRow,
  computeEntryHash,
  hashEquals,
  verifyChainRows,
} from '../auditChain.js';

// Frozen fixtures — DO NOT edit values without regenerating the vectors.
const GENESIS = {
  id: 1,
  user_id: 7,
  acting_as: null,
  action: 'row.create',
  entity_type: 'table_row',
  entity_id: '12345',
  details: '{"table_id":1708}',
  request_id: 'req-uuid-abc',
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
  request_id: 'req-uuid-def',
  space_id: 11,
  ip_addr: '203.0.113.7',
  created_at: new Date('2026-08-02T10:30:00.000Z'),
};

// Golden vectors — regenerate ONLY on an intentional CHAIN_VERSION bump.
const GENESIS_HASH =
  'e51394cde7e1e74796d64151f259334ec68b0097fda2044408f615a137e134df';
const ROW2_HASH =
  '25dc915c7d26eb2073884f5257cddbb7ca31b571bef16934303d8e42ddde5416';

describe('auditChain — golden vectors (R5, frozen)', () => {
  it('CHAIN_VERSION is 1', () => {
    expect(CHAIN_VERSION).toBe(1);
  });

  it('genesis (prev=null) hashes to the frozen vector', () => {
    expect(computeEntryHash(null, GENESIS).toString('hex')).toBe(GENESIS_HASH);
  });

  it('second row chained onto genesis hashes to the frozen vector', () => {
    const prev = Buffer.from(GENESIS_HASH, 'hex');
    expect(computeEntryHash(prev, ROW2).toString('hex')).toBe(ROW2_HASH);
  });

  it('canonical form is byte-stable and orders created_at as epoch ms', () => {
    expect(canonicalizeAuditRow(GENESIS)).toBe(
      '{"id":1,"user_id":7,"acting_as":null,"action":"row.create",' +
        '"entity_type":"table_row","entity_id":"12345",' +
        '"details":"{\\"table_id\\":1708}","request_id":"req-uuid-abc",' +
        '"space_id":11,"ip_addr":"203.0.113.7","created_at":1785666584000}'
    );
  });
});

describe('auditChain — canonical determinism & normalization', () => {
  it('is insensitive to source key ordering', () => {
    const reordered = {};
    for (const k of Object.keys(GENESIS).reverse()) reordered[k] = GENESIS[k];
    expect(canonicalizeAuditRow(reordered)).toBe(canonicalizeAuditRow(GENESIS));
  });

  it('treats created_at as Date, ISO string, and epoch identically', () => {
    const asDate = { ...GENESIS };
    const asIso = { ...GENESIS, created_at: '2026-08-02T10:29:44.000Z' };
    const asEpoch = { ...GENESIS, created_at: 1785666584000 };
    const h = (r) => computeEntryHash(null, r).toString('hex');
    expect(h(asIso)).toBe(GENESIS_HASH);
    expect(h(asEpoch)).toBe(GENESIS_HASH);
    expect(h(asDate)).toBe(GENESIS_HASH);
  });

  it('drops sub-millisecond precision consistently', () => {
    const micros = { ...GENESIS, created_at: '2026-08-02T10:29:44.000123Z' };
    expect(computeEntryHash(null, micros).toString('hex')).toBe(GENESIS_HASH);
  });

  it('any field edit changes the digest', () => {
    const edited = { ...GENESIS, action: 'row.delete' };
    expect(computeEntryHash(null, edited).toString('hex')).not.toBe(GENESIS_HASH);
  });
});

describe('hashEquals', () => {
  it('null == null, buffer==same buffer, mismatch on difference', () => {
    const a = Buffer.from('aa', 'hex');
    expect(hashEquals(null, null)).toBe(true);
    expect(hashEquals(a, Buffer.from('aa', 'hex'))).toBe(true);
    expect(hashEquals(a, null)).toBe(false);
    expect(hashEquals(a, Buffer.from('bb', 'hex'))).toBe(false);
  });
});

describe('verifyChainRows — tamper detection', () => {
  // Build a valid 2-row chain from the fixtures.
  function buildValidChain() {
    const g = computeEntryHash(null, GENESIS);
    const r2 = computeEntryHash(g, ROW2);
    return [
      { ...GENESIS, prev_hash: null, entry_hash: g },
      { ...ROW2, prev_hash: g, entry_hash: r2 },
    ];
  }

  it('accepts an untampered chain (full verify from genesis)', () => {
    const res = verifyChainRows(buildValidChain());
    expect(res).toEqual({ ok: true, checked: 2, break_at_id: null });
  });

  it('rejects a genesis row whose prev_hash is not NULL', () => {
    const rows = buildValidChain();
    rows[0].prev_hash = Buffer.from('00'.repeat(32), 'hex');
    const res = verifyChainRows(rows);
    expect(res.ok).toBe(false);
    expect(res.break_at_id).toBe(1);
  });

  it('detects a content edit to a row (self-consistency break)', () => {
    const rows = buildValidChain();
    rows[1] = { ...rows[1], action: 'row.delete' }; // stored hash no longer matches
    const res = verifyChainRows(rows);
    expect(res.ok).toBe(false);
    expect(res.break_at_id).toBe(2);
    expect(res.checked).toBe(1); // genesis verified before the break
  });

  it('detects a broken link (prev_hash rewired)', () => {
    const rows = buildValidChain();
    // Re-hash row2 with a bogus prev so self-consistency passes but linkage fails.
    const bogus = Buffer.from('11'.repeat(32), 'hex');
    rows[1].prev_hash = bogus;
    rows[1].entry_hash = computeEntryHash(bogus, ROW2);
    const res = verifyChainRows(rows);
    expect(res.ok).toBe(false);
    expect(res.break_at_id).toBe(2);
  });

  it('validates linkage of the first row against a supplied anchor (partial verify)', () => {
    const g = computeEntryHash(null, GENESIS);
    const r2 = computeEntryHash(g, ROW2);
    const suffix = [{ ...ROW2, prev_hash: g, entry_hash: r2 }];
    expect(verifyChainRows(suffix, { anchorHash: g })).toEqual({
      ok: true,
      checked: 1,
      break_at_id: null,
    });
    // Wrong anchor → linkage break on the first row.
    const wrong = verifyChainRows(suffix, {
      anchorHash: Buffer.from('22'.repeat(32), 'hex'),
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.break_at_id).toBe(2);
  });
});
