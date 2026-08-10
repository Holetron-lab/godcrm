/**
 * T-146479: Auto-recovery sentinel consumption
 *
 * Verifies that recoverStuckJobs() Phase 0 consumes the graceful-shutdown
 * sentinel marker on every row it touches, so the next restart's Phase 0
 * SELECT does NOT re-pick the same rows (which previously caused chats
 * to be re-dispatched / re-spammed on every restart — see ticket 146479,
 * convos 183/111/188/400/402 accumulated 30-50 zombie rows each).
 *
 * The fix: after handling a sentinel job, UPDATE its error_message and
 * result_metadata so the OR-joined Phase 0 WHERE clause no longer matches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (hoisted) ────────────────────────────────────────────

const {
  mockDbGet, mockDbRun, mockDbAll, mockIsPostgres,
  mockSaveStepMessage, mockSetConversationProcessing,
  mockResolveAgentUser, mockCreateAndDispatchJob,
} = vi.hoisted(() => ({
  mockDbGet: vi.fn(),
  mockDbRun: vi.fn(() => Promise.resolve()),
  mockDbAll: vi.fn(() => Promise.resolve([])),
  mockIsPostgres: vi.fn(() => true),
  mockSaveStepMessage: vi.fn(() => Promise.resolve()),
  mockSetConversationProcessing: vi.fn(() => Promise.resolve()),
  mockResolveAgentUser: vi.fn(() => Promise.resolve({ user: { id: 1 } })),
  mockCreateAndDispatchJob: vi.fn(() => Promise.resolve({ id: 999 })),
}));

vi.mock('../../database/connection.js', () => ({
  dbGet: mockDbGet,
  dbRun: mockDbRun,
  dbAll: mockDbAll,
  isPostgres: mockIsPostgres,
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../AgentLoopService.js', () => ({
  saveStepMessage: mockSaveStepMessage,
}));

vi.mock('../chat/agent-execution-shared.js', () => ({
  setConversationProcessing: mockSetConversationProcessing,
}));

vi.mock('../agent-users.js', () => ({
  resolveAgentUser: mockResolveAgentUser,
}));

vi.mock('../agent-job/create.js', () => ({
  createAndDispatchJob: mockCreateAndDispatchJob,
}));

// ─── Import after mocks ─────────────────────────────────────────

import { recoverStuckJobs } from '../agent-job/lifecycle.js';

// ─── Helpers ────────────────────────────────────────────────────

const SENTINEL_MSG = 'Graceful shutdown — will auto-recover on restart';

function makeSentinelJob(overrides = {}) {
  return {
    id: 100,
    job_id: 'uuid-100',
    conversation_id: 5000,
    agent_name: 'Orchestrator',
    agent_row_id: 1,
    agent_user_id: 2,
    context: JSON.stringify({ message_content: 'original user msg' }),
    trigger_message_id: 9000,
    trigger_user_id: 1,
    started_at: '2026-05-01T00:00:00Z',
    worker_pid: null, // dead
    ...overrides,
  };
}

/**
 * Stub dbAll: Phase 0 returns the given graceful jobs, all other phases empty.
 */
function stubPhases(gracefulJobs) {
  let call = 0;
  mockDbAll.mockImplementation(() => {
    call++;
    if (call === 1) return Promise.resolve(gracefulJobs); // Phase 0 graceful
    return Promise.resolve([]); // Phase 1, 2, 2.5, 3
  });
}

/**
 * Find the dbRun call that matches the sentinel-consume UPDATE shape.
 */
function findConsumeCall(jobId) {
  return mockDbRun.mock.calls.find(([sql, params]) => {
    if (typeof sql !== 'string') return false;
    if (!sql.includes('UPDATE agent_jobs SET error_message')) return false;
    if (!sql.includes('result_metadata')) return false;
    return Array.isArray(params) && params[2] === jobId;
  });
}

// ─── Tests ───────────────────────────────────────────────────────

describe('T-146479: Phase 0 sentinel consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPostgres.mockReturnValue(true);
    // No bound-ticket conversations by default → resetBoundTicketToBacklog returns reset:false
    mockDbGet.mockResolvedValue(null);
  });

  it('consumes the sentinel after a successful redispatch', async () => {
    const job = makeSentinelJob({ id: 101, conversation_id: 5001 });
    stubPhases([job]);
    // No bound ticket; convo lookup for restart-count guard returns a clean row
    mockDbGet
      .mockResolvedValueOnce(null) // resetBoundTicketToBacklog → conv lookup
      .mockResolvedValueOnce({ id: 5001, settings: '{}' }); // _tryRedispatchJob → conv lookup

    const result = await recoverStuckJobs();

    expect(result.gracefulRecovered).toBe(1);
    expect(result.sentinelsConsumed).toBe(1);

    const consumeCall = findConsumeCall(101);
    expect(consumeCall).toBeDefined();
    const [sql, params] = consumeCall;
    expect(sql).toMatch(/UPDATE agent_jobs SET error_message = \$1, result_metadata = \$2 WHERE id = \$3/);
    expect(params[0]).toBe('Auto-recovery consumed (redispatched)');
    const meta = JSON.parse(params[1]);
    expect(meta.shutdown_recovery).toBe(false);
    expect(meta.sentinel_consume_reason).toBe('redispatched');
    expect(typeof meta.sentinel_consumed_at).toBe('string');
  });

  it('consumes the sentinel after a failed redispatch (no message_content in context)', async () => {
    const job = makeSentinelJob({
      id: 102,
      conversation_id: 5002,
      context: JSON.stringify({}), // no message_content → redispatch fails
    });
    stubPhases([job]);

    const result = await recoverStuckJobs();

    expect(result.sentinelsConsumed).toBe(1);
    expect(result.gracefulRecovered).toBe(0);

    const consumeCall = findConsumeCall(102);
    expect(consumeCall).toBeDefined();
    expect(consumeCall[1][0]).toBe('Auto-recovery consumed (redispatch-failed)');
    // User got the "please send your message again" fallback
    expect(mockSaveStepMessage).toHaveBeenCalledWith(5002, expect.objectContaining({
      content: expect.stringContaining('Please send your message again'),
    }));
  });

  it('consumes the sentinel for jobs skipped past the redispatch cap', async () => {
    // 4 jobs, MAX_RECOVERY_REDISPATCH = 2 → first 2 redispatched, last 2 hit cap
    const jobs = [
      makeSentinelJob({ id: 201, conversation_id: 6001 }),
      makeSentinelJob({ id: 202, conversation_id: 6002 }),
      makeSentinelJob({ id: 203, conversation_id: 6003 }),
      makeSentinelJob({ id: 204, conversation_id: 6004 }),
    ];
    stubPhases(jobs);
    // Each redispatch attempt does: resetBoundTicketToBacklog conv-lookup (null)
    // + (if attempted) _tryRedispatchJob conv-lookup (settings '{}')
    mockDbGet.mockImplementation(() => Promise.resolve(null));
    // Override for the 2 redispatch attempts: return conv settings
    let convCall = 0;
    mockDbGet.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT id, settings FROM conversations')) {
        convCall++;
        return Promise.resolve({ id: 6000 + convCall, settings: '{}' });
      }
      return Promise.resolve(null); // resetBoundTicketToBacklog conv lookup
    });

    const result = await recoverStuckJobs();

    expect(result.sentinelsConsumed).toBe(4);
    expect(result.gracefulRecovered).toBe(2); // cap

    // First two jobs → "redispatched"
    expect(findConsumeCall(201)[1][0]).toBe('Auto-recovery consumed (redispatched)');
    expect(findConsumeCall(202)[1][0]).toBe('Auto-recovery consumed (redispatched)');
    // Last two → "recovery-cap-reached" (skipped — no redispatch attempt, no user message)
    expect(findConsumeCall(203)[1][0]).toBe('Auto-recovery consumed (recovery-cap-reached)');
    expect(findConsumeCall(204)[1][0]).toBe('Auto-recovery consumed (recovery-cap-reached)');
  });

  it('does NOT consume the sentinel when the worker PID is still alive', async () => {
    // Use real process PID — guaranteed alive
    const job = makeSentinelJob({ id: 301, conversation_id: 7001, worker_pid: process.pid });
    stubPhases([job]);

    const result = await recoverStuckJobs();

    expect(result.stillAliveCount).toBe(1);
    expect(result.sentinelsConsumed).toBe(0);

    // Status was flipped back to 'processing' (which is what breaks Phase 0
    // matching for next restart, not the sentinel consumption)
    const statusFlip = mockDbRun.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes("SET status = $1, started_at = NOW()") && sql.includes('attempts = attempts + 1')
    );
    expect(statusFlip).toBeDefined();
    // No consume UPDATE for this job
    expect(findConsumeCall(301)).toBeUndefined();
  });
});
