// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbGet: vi.fn(), dbAll: vi.fn(), dbRun: vi.fn(), withTransaction: vi.fn(),
}));

vi.mock('../../../../database/connection.js', () => ({
  dbGet: mocks.dbGet,
  dbAll: mocks.dbAll,
  dbRun: mocks.dbRun,
  withTransactionAsync: mocks.withTransaction,
}));

const {
  consumeRamziInvite,
  issueRamziInvite,
  listRamziInvites,
} = await import('../participants.js');

const hash = (code) => createHash('sha256').update(code).digest('hex');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Ramzi guest invites', () => {
  it('shows a new code once and stores only its hash with a 24-hour expiry', async () => {
    mocks.dbRun.mockResolvedValue({ changes: 1, lastInsertRowid: 41 });
    const before = Date.now();
    const issued = await issueRamziInvite('Миша', 17);

    expect(issued.code).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(Date.parse(issued.expiresAt)).toBeGreaterThanOrEqual(before + 23.9 * 60 * 60 * 1000);
    const [sql, params] = mocks.dbRun.mock.calls[0];
    expect(sql).toContain('INSERT INTO telegram_ramzi_invites');
    expect(params).toEqual([hash(issued.code), 'Миша', 17, issued.expiresAt]);
    expect(params).not.toContain(issued.code);

    mocks.dbAll.mockResolvedValue([{ id: 41, label: 'Миша', used_by: null }]);
    await expect(listRamziInvites()).resolves.toEqual([{ id: 41, label: 'Миша', used_by: null }]);
  });

  it('consumes a valid invite atomically and rejects reused, expired, revoked and wrong codes', async () => {
    const trx = { get: vi.fn(), run: vi.fn() };
    mocks.withTransaction.mockImplementation((callback) => callback(trx));
    trx.run.mockResolvedValue({ changes: 1, lastInsertRowid: 0 });

    trx.get
      .mockResolvedValueOnce({
        id: 7, code_hash: hash('valid-code'), label: 'Миша', expires_at: new Date(Date.now() + 60_000).toISOString(),
        used_by: null, used_at: null, revoked_at: null,
      })
      .mockResolvedValueOnce(null);
    await expect(consumeRamziInvite('valid-code', '555', 17)).resolves.toMatchObject({
      telegram_user_id: '555', label: 'Миша', role: 'guest', status: 'active',
    });
    expect(trx.get.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(trx.run.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
      expect.stringContaining('INSERT INTO telegram_ramzi_participants'),
      expect.stringContaining('UPDATE telegram_ramzi_invites'),
    ]));

    for (const invite of [
      null,
      { id: 7, code_hash: hash('valid-code'), expires_at: new Date(Date.now() - 1000).toISOString() },
      { id: 7, code_hash: hash('valid-code'), expires_at: new Date(Date.now() + 60_000).toISOString(), used_by: '556' },
      { id: 7, code_hash: hash('valid-code'), expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: new Date().toISOString() },
      { id: 7, code_hash: hash('another-code'), expires_at: new Date(Date.now() + 60_000).toISOString() },
    ]) {
      trx.get.mockResolvedValue(invite);
      trx.run.mockClear();
      await expect(consumeRamziInvite('valid-code', '555', 17)).resolves.toBeNull();
      expect(trx.run).not.toHaveBeenCalled();
    }
  });
});
