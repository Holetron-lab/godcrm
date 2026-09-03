// ADR-0181 AC#5 — fault injection: any internal error in the reservation
// stage must fail OPEN (gateWrite → null → caller keeps the policy allow).
// vi.mock is file-scoped, so this lives apart from the DB-backed suite.
import { describe, test, expect, vi } from 'vitest';

vi.mock('../../../database/connection.js', () => ({
  // Every DB call throws — simulates DB down / timeout / malformed state.
  dbGet: vi.fn(async () => { throw new Error('injected DB failure'); }),
  dbRun: vi.fn(async () => { throw new Error('injected DB failure'); }),
}));

const { gateWrite, acquireWriteReservation, releaseWriteReservation } = await import('../reservations.js');

describe('write-reservation fail-open', () => {
  test('gateWrite swallows DB error → null (allow)', async () => {
    const out = await gateWrite({
      toolName: 'Edit',
      toolInput: { file_path: '/root/production/business-crm/backend/x.js' },
      holderSession: 'loopA',
    });
    expect(out).toBeNull();
  });

  // ADR-0181-A AC#6 — the git-index branch shares the same fail-open boundary:
  // a DB error while reserving the sentinel must never block a live commit.
  test('gateWrite git-index branch swallows DB error → null (allow, never blocks a commit)', async () => {
    const out = await gateWrite({
      toolName: 'Bash',
      toolInput: { command: 'git add -A && git commit -m x' },
      holderSession: 'loopA',
    });
    expect(out).toBeNull();
  });

  test('releaseWriteReservation swallows DB error → false, never throws', async () => {
    await expect(
      releaseWriteReservation({ filePath: '/root/production/business-crm/backend/x.js', holderSession: 'loopA' })
    ).resolves.toBe(false);
  });

  test('acquireWriteReservation propagates (caller gateWrite is the fail-open boundary)', async () => {
    // acquire itself is allowed to throw — gateWrite is the guard that converts
    // it to a fail-open allow. This documents that boundary explicitly.
    await expect(
      acquireWriteReservation({ filePath: 'backend/x.js', holderSession: 'loopA' })
    ).rejects.toThrow('injected DB failure');
  });
});
