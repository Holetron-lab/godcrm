/**
 * Watchdog orphan-reaper must NOT reap a conversation that is still being
 * processed by a LIVE sync agent in this process.
 *
 * Repro of the «… перестал отвечать» bug: a sync agent (POST /chat, /run) holds
 * conversations.is_processing=true with no agent_jobs row. During one long blocking
 * call updated_at goes stale (>2 min), so the orphan query matches it. Before the
 * fix the watchdog cleared the lock and posted "перестал отвечать" at the very
 * moment the agent was still working. The fix: skip reaping conversations present
 * in the live sync-activity registry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (hoisted) ────────────────────────────────────────────
const {
  mockDbAll, mockIsPostgres, mockSaveStepMessage,
  mockSetConversationProcessing, mockGetStalledJobs, mockFailJob,
} = vi.hoisted(() => ({
  mockDbAll: vi.fn(() => Promise.resolve([])),
  mockIsPostgres: vi.fn(() => true),
  mockSaveStepMessage: vi.fn(() => Promise.resolve()),
  mockSetConversationProcessing: vi.fn(() => Promise.resolve()),
  mockGetStalledJobs: vi.fn(() => Promise.resolve([])),
  mockFailJob: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../database/connection.js', () => ({
  dbAll: mockDbAll,
  isPostgres: mockIsPostgres,
}));
vi.mock('../../utils/logger.js', () => ({
  apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../AgentLoopService.js', () => ({ saveStepMessage: mockSaveStepMessage }));
vi.mock('./query.js', () => ({ getStalledJobs: mockGetStalledJobs }));
vi.mock('./shared.js', () => ({ failJob: mockFailJob }));

// Only setConversationProcessing is mocked; isSyncActive uses the REAL registry.
vi.mock('../chat/agent-execution-shared.js', async () => {
  const real = await vi.importActual('../chat/agent-execution-shared/sync-activity.js');
  return {
    setConversationProcessing: mockSetConversationProcessing,
    isSyncActive: real.isSyncActive,
  };
});

// ─── Import after mocks ─────────────────────────────────────────
import { _watchdogTick } from '../agent-job/watchdog.js';
import { markSyncActive, markSyncInactive } from '../chat/agent-execution-shared/sync-activity.js';

const ORPHAN_CONV = { id: 9001, processing_agent_name: 'SysAdmin' };
const REAP_MSG = /перестал отвечать/;

describe('watchdog orphan-reaper × live sync agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markSyncInactive(ORPHAN_CONV.id);
    mockGetStalledJobs.mockResolvedValue([]);          // no stalled jobs
    mockDbAll.mockResolvedValue([ORPHAN_CONV]);        // orphan query returns our conv
  });

  it('does NOT reap a conversation held by a live sync agent', async () => {
    markSyncActive(ORPHAN_CONV.id); // agent mid-long-call in this process

    await _watchdogTick();

    expect(mockSetConversationProcessing).not.toHaveBeenCalled();
    // No "перестал отвечать" message posted to the chat.
    const reapMsg = mockSaveStepMessage.mock.calls.find(
      ([, msg]) => REAP_MSG.test(msg?.content || '')
    );
    expect(reapMsg).toBeUndefined();
  });

  it('DOES reap a genuinely orphaned conversation (no live sync agent)', async () => {
    // not registered → dead lock

    await _watchdogTick();

    expect(mockSetConversationProcessing).toHaveBeenCalledWith(ORPHAN_CONV.id, false);
    const reapMsg = mockSaveStepMessage.mock.calls.find(
      ([, msg]) => REAP_MSG.test(msg?.content || '')
    );
    expect(reapMsg).toBeDefined();
  });
});
