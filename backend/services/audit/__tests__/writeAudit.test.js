// backend/services/audit/__tests__/writeAudit.test.js
//
// ADR-0066 P0 + ADR-0066-A §B — unit tests for the canonical audit
// writer with the hash-chain append.
//
// Test isolation (ADR-0009): the DB layer is mocked — no real Postgres.
// The chain append runs inside withTransactionAsync(trx→{query,get,run});
// we mock the transaction so the advisory lock / prev-read / INSERT /
// hash UPDATE sequence is asserted without a DB. auditChain.js itself is
// NOT mocked — the real digest runs, so entry_hash is a genuine buffer.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the DB transaction layer BEFORE importing the SUT. ──
const trxQuery = vi.fn();
const trxGet = vi.fn();
const trxRun = vi.fn();
const withTransactionAsync = vi.fn(async (cb) =>
  cb({ query: trxQuery, get: trxGet, run: trxRun })
);
vi.mock('../../../database/connection.js', () => ({ withTransactionAsync }));

// Silence + capture logger output.
const warnMock = vi.fn();
const errorMock = vi.fn();
vi.mock('../../../utils/logger.js', () => {
  const child = () => ({ warn: warnMock, error: errorMock, info: vi.fn() });
  return {
    logger: { child, warn: warnMock, error: errorMock, info: vi.fn() },
    requestLogger: vi.fn(),
    apiLogger: vi.fn(),
    authLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
});

// Chain-append failure alerts lazily import TelegramService — stub it.
const sendAdminAlert = vi.fn().mockResolvedValue(undefined);
vi.mock('../../TelegramService.js', () => ({ sendAdminAlert }));

const { writeAudit, capDetails } = await import('../writeAudit.js');

const FIXED_CREATED_AT = new Date('2026-08-02T10:29:44.000Z');

function findInsertCall() {
  return trxQuery.mock.calls.find(([sql]) => /INSERT INTO audit_log/.test(sql));
}

describe('capDetails — payload truncation matrix (ADR-0066 §Resolved Defaults #1)', () => {
  it('passes a small object through unchanged', () => {
    const input = { table_id: 1708, row_id: 156991, action: 'create' };
    expect(capDetails(input)).toEqual(input);
  });

  it('truncates a single oversized field (>2 KiB) into {truncated, original_size, sample}', () => {
    const huge = 'x'.repeat(3 * 1024);
    const out = capDetails({ note: huge, ok: 'tiny' });
    expect(out.ok).toBe('tiny');
    expect(out.note).toMatchObject({ truncated: true, original_size: 3 * 1024 });
    expect(Buffer.byteLength(out.note.sample, 'utf8')).toBe(1024);
  });

  it('drops values and keeps only keys when truncated payload still exceeds 8 KiB', () => {
    const big = 'y'.repeat(3 * 1024);
    const input = {};
    for (let i = 0; i < 10; i++) input[`f${i}`] = big;
    const out = capDetails(input);
    expect(out.truncated).toBe(true);
    expect(out.keys).toHaveLength(10);
    expect(out.keys[0]).toBe('f0');
  });

  it('handles null/undefined/primitive details safely', () => {
    expect(capDetails(null)).toBeNull();
    expect(capDetails(undefined)).toBeNull();
    expect(capDetails('hi')).toEqual({ value: 'hi' });
    expect(capDetails(42)).toEqual({ value: 42 });
  });
});

describe('writeAudit — chain-append transaction shape (ADR-0066-A §B)', () => {
  beforeEach(() => {
    trxQuery.mockReset();
    trxGet.mockReset();
    trxRun.mockReset();
    withTransactionAsync.mockClear();
    withTransactionAsync.mockImplementation(async (cb) =>
      cb({ query: trxQuery, get: trxGet, run: trxRun })
    );
    warnMock.mockClear();
    errorMock.mockClear();
    sendAdminAlert.mockClear();

    // Default: advisory lock + INSERT RETURNING id, created_at.
    trxQuery.mockImplementation(async (sql) => {
      if (/INSERT INTO audit_log/.test(sql)) {
        return { rows: [{ id: 100, created_at: FIXED_CREATED_AT }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    trxGet.mockResolvedValue(null); // genesis: no predecessor hash
    trxRun.mockResolvedValue({ changes: 1 });
  });

  function makeReq(overrides = {}) {
    return {
      user: { id: 7 },
      actingAs: null,
      requestId: 'req-uuid-abc',
      spaceId: 11,
      ip: '203.0.113.7',
      get: (h) => (h === 'user-agent' ? 'vitest/1.0' : null),
      ...overrides,
    };
  }

  it('acquires the advisory lock, reads prev, inserts 11 columns, updates hashes', async () => {
    await writeAudit(makeReq(), {
      action: 'row.create',
      entity_type: 'table_row',
      entity_id: 12345,
      details: { table_id: 1708 },
    });

    expect(withTransactionAsync).toHaveBeenCalledTimes(1);

    // Advisory lock serializes the append.
    expect(
      trxQuery.mock.calls.some(([sql]) => /pg_advisory_xact_lock/.test(sql))
    ).toBe(true);
    // Predecessor hash read.
    expect(trxGet).toHaveBeenCalledWith(
      expect.stringMatching(/entry_hash IS NOT NULL/)
    );

    // INSERT shape — 11 columns, RETURNING id, created_at.
    const [insSql, insParams] = findInsertCall();
    expect(insSql).toMatch(/RETURNING id, created_at/);
    expect(insSql).toMatch(/::inet/);
    expect(insParams).toEqual([
      7,
      'row.create',
      'table_row',
      '12345',
      JSON.stringify({ table_id: 1708 }),
      '203.0.113.7',
      'vitest/1.0',
      null,
      'req-uuid-abc',
      11,
      '203.0.113.7',
    ]);

    // UPDATE writes prev_hash (null at genesis) + a real 32-byte entry_hash.
    const [updSql, updParams] = trxRun.mock.calls.find(([sql]) =>
      /UPDATE audit_log SET prev_hash/.test(sql)
    );
    expect(updSql).toMatch(/WHERE id = \?/);
    expect(updParams[0]).toBeNull(); // prev_hash genesis
    expect(Buffer.isBuffer(updParams[1])).toBe(true);
    expect(updParams[1]).toHaveLength(32); // sha256
    expect(updParams[2]).toBe(100); // id from RETURNING
  });

  it('chains onto an existing head (prev_hash forwarded from prev read)', async () => {
    const prevHash = Buffer.from('ab'.repeat(32), 'hex');
    trxGet.mockResolvedValue({ entry_hash: prevHash });

    await writeAudit(makeReq(), { action: 'row.update' });

    const [, updParams] = trxRun.mock.calls.find(([sql]) =>
      /UPDATE audit_log SET prev_hash/.test(sql)
    );
    expect(updParams[0]).toBe(prevHash); // prev_hash carried through
    expect(updParams[1]).toHaveLength(32);
  });

  it('tolerates a null req (system-initiated writes)', async () => {
    await writeAudit(null, { action: 'system.boot' });
    const [, params] = findInsertCall();
    expect(params[0]).toBeNull(); // user_id
    expect(params[1]).toBe('system.boot');
    expect(params[5]).toBeNull(); // ip_address
    expect(params[6]).toBeNull(); // user_agent
    expect(params[7]).toBeNull(); // acting_as
    expect(params[8]).toBeNull(); // request_id
    expect(params[9]).toBeNull(); // space_id
    expect(params[10]).toBeNull(); // ip_addr
  });

  it('skips silently when entry has no action (no transaction opened)', async () => {
    await writeAudit(makeReq(), { entity_type: 'oops' });
    expect(withTransactionAsync).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      expect.anything(),
      'writeAudit called with no action — skipping'
    );
  });

  it('strips IPv6-mapped IPv4 prefix on ip_addr / ip_address', async () => {
    await writeAudit(makeReq({ ip: '::ffff:198.51.100.42' }), {
      action: 'row.create',
    });
    const [, params] = findInsertCall();
    expect(params[5]).toBe('198.51.100.42');
    expect(params[10]).toBe('198.51.100.42');
  });
});

describe('writeAudit — R1 retry-then-alert on append failure', () => {
  beforeEach(() => {
    withTransactionAsync.mockReset();
    warnMock.mockClear();
    errorMock.mockClear();
    sendAdminAlert.mockClear();
  });

  it('retries once, then escalates loudly without throwing to the caller', async () => {
    withTransactionAsync.mockRejectedValue(new Error('connection lost'));

    await expect(
      writeAudit({ user: { id: 7 }, get: () => null }, { action: 'row.update' })
    ).resolves.toBeUndefined();

    // Initial attempt + one retry.
    expect(withTransactionAsync).toHaveBeenCalledTimes(2);
    // Loud, distinct escalation (not the generic warn-and-swallow).
    expect(errorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'connection lost' }),
        action: 'row.update',
      }),
      'AUDIT_CHAIN_APPEND_FAILED — audit entry NOT recorded after retry'
    );
  });
});
