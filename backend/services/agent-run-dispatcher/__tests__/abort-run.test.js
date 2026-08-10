/**
 * T-148528 (WP-B) — Tests for dispatcher.abortRun / abortRunByConversation.
 *
 * Strategy: spawn a real `sleep 30` child with `detached: true` so it has
 * its own process group, inject the PID into the dispatcher's internal
 * `_activeAttempts` map, and call `abortRun`. The child MUST be killed
 * within the 5s SIGKILL grace window. DB writes are mocked.
 */

import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../database/connection.js', () => ({
  dbGet: vi.fn(),
  dbAll: vi.fn(),
  dbRun: vi.fn(async () => ({ changes: 1 })),
  isPostgres: vi.fn(() => true),
}));

vi.mock('../../../utils/logger.js', () => {
  const stub = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    apiLogger: {
      ...stub,
      child: vi.fn(() => ({ ...stub })),
    },
  };
});

// Skip the heavy buildRunPrompt graph — abortRun never invokes it but the
// dispatcher's top-level import chain pulls it in transitively.
vi.mock('../build-run-prompt.mjs', () => ({
  buildRunPrompt: vi.fn(),
}));

// Skip workspace manager so the file-system side never fires.
vi.mock('../workspace-manager.js', () => ({
  createWorkspace: vi.fn(),
  destroyWorkspace: vi.fn(),
}));

// Heavy stream handler isn't needed for the abort path.
vi.mock('../run-stream-handler.mjs', () => ({
  runStreamHandler: vi.fn(),
  eventTranslator: vi.fn(),
  warnLegacyOnce: vi.fn(),
}));

import {
  abortRun,
  abortRunByConversation,
  _getActiveAttemptsForTest,
} from '../index.js';
import { dbGet, dbRun } from '../../../database/connection.js';

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (err) { return !(err && err.code === 'ESRCH'); }
}

async function waitForDeath(pid, timeoutMs = 6000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise(r => setTimeout(r, stepMs));
  }
  return false;
}

describe('T-148528: abortRun / abortRunByConversation', () => {
  /** @type {import('node:child_process').ChildProcess|null} */
  let child = null;

  beforeEach(() => {
    dbRun.mockClear();
    dbGet.mockReset();
    _getActiveAttemptsForTest().clear();
  });

  afterEach(() => {
    if (child && !child.killed) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    child = null;
  });

  it('SIGTERMs the tracked PID, persists run_state=canceled, returns aborted:true', async () => {
    child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    // Allow detached: true → kernel assigns a new PGID. setpgid is async on
    // some platforms; give it a tick.
    await new Promise(r => setTimeout(r, 50));
    expect(isAlive(child.pid)).toBe(true);

    const rowId = 999001;
    _getActiveAttemptsForTest().set(rowId, {
      agent_id: 1, claimedAt: Date.now(), workspacePath: '/tmp/x', pid: child.pid,
    });

    const result = await abortRun(rowId, { reason: 'user_stop' });

    expect(result.aborted).toBe(true);
    expect(result.reason).toBe('user_stop');
    expect(result.pid).toBe(child.pid);

    // Active-attempts entry must be cleared synchronously.
    expect(_getActiveAttemptsForTest().has(rowId)).toBe(false);

    // run_state should have been persisted to canceled. We look for the
    // characteristic UPDATE on table_rows with the JSONB merge.
    const cancelCall = dbRun.mock.calls.find(call =>
      typeof call[0] === 'string'
      && call[0].includes('UPDATE table_rows')
      && call[0].includes('run_state')
    );
    expect(cancelCall).toBeDefined();
    // Reason must be propagated into the placeholder params.
    expect(cancelCall[1]).toContain('user_stop');

    // Child must actually die within the SIGKILL grace.
    const died = await waitForDeath(child.pid);
    expect(died).toBe(true);
  });

  it('is a no-op when rowId has no active attempt (still persists terminal state)', async () => {
    const rowId = 999002;
    expect(_getActiveAttemptsForTest().has(rowId)).toBe(false);

    const result = await abortRun(rowId, { reason: 'user_stop' });

    expect(result.aborted).toBe(true);
    expect(result.pid).toBeNull();

    // We STILL flip the ticket so future ticks don't re-pick a stale row.
    const cancelCall = dbRun.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('run_state')
    );
    expect(cancelCall).toBeDefined();
  });

  it('rejects invalid rowId without touching DB', async () => {
    const result = await abortRun(null);
    expect(result).toEqual({ aborted: false, reason: 'invalid_row_id' });
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('abortRunByConversation: walks bound_row_id and aborts the matching run', async () => {
    child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 50));
    expect(isAlive(child.pid)).toBe(true);

    const rowId = 999003;
    const conversationId = 5555;
    _getActiveAttemptsForTest().set(rowId, {
      agent_id: 1, claimedAt: Date.now(), workspacePath: '/tmp/x', pid: child.pid,
    });
    dbGet.mockResolvedValueOnce({ bound_row_id: rowId, bound_table_id: 1708 });

    const result = await abortRunByConversation(conversationId);

    expect(result.aborted).toBe(true);
    expect(result.ticket_id).toBe(rowId);
    expect(result.reason).toBe('user_stop');

    const died = await waitForDeath(child.pid);
    expect(died).toBe(true);
  });

  it('abortRunByConversation: returns aborted=false when conversation has no bound ticket', async () => {
    dbGet.mockResolvedValueOnce({ bound_row_id: null, bound_table_id: null });

    const result = await abortRunByConversation(7777);

    expect(result.aborted).toBe(false);
    expect(result.reason).toBe('no_active_run');
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('abortRunByConversation: returns aborted=false when bound ticket has no active attempt', async () => {
    dbGet.mockResolvedValueOnce({ bound_row_id: 12345, bound_table_id: 1708 });

    const result = await abortRunByConversation(7777);

    expect(result.aborted).toBe(false);
    expect(result.reason).toBe('no_active_run');
    expect(result.ticket_id).toBe(12345);
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('abortRunByConversation: rejects invalid conversation id', async () => {
    const result = await abortRunByConversation(null);
    expect(result).toEqual({ aborted: false, reason: 'invalid_conversation_id' });
  });
});
