// Bugs 1552/228709 — agent_status placeholder is one per AGENT, not one per
// conversation. Creating or resetting agent A's placeholder must not delete
// agent B's plan / agent_status rows in the same conversation.
//
// Strategy: mock the db layer and assert the DELETE statements are scoped by
// agent_id. Legacy rows with agent_id IS NULL (auto-respond path) are still
// swept, so the pre-fix behaviour for null-agent runs is unchanged.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbRunMock = vi.fn();
const dbGetMock = vi.fn();

vi.mock('../../../database/connection.js', () => ({
  dbRun: (...args) => dbRunMock(...args),
  dbGet: (...args) => dbGetMock(...args),
}));
vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createAgentStatusPlaceholder, resetAgentStatusForReuse } = await import('../status.js');

const deletes = () => dbRunMock.mock.calls.filter(([sql]) => /^\s*DELETE FROM messages/i.test(sql));

describe('status.js — per-agent placeholder scoping (228709)', () => {
  beforeEach(() => {
    dbRunMock.mockReset();
    dbGetMock.mockReset();
    dbRunMock.mockResolvedValue({ lastInsertRowid: 901, changes: 1 });
  });

  it('createAgentStatusPlaceholder deletes only this agent\'s (or legacy null) plan/status rows', async () => {
    await createAgentStatusPlaceholder(3660, { agentName: 'Developer Ralph', agentRowId: 33485, senderId: 77 });

    const del = deletes();
    expect(del).toHaveLength(1);
    const [sql, params] = del[0];
    expect(sql).toMatch(/content_type IN \('plan', 'agent_status'\)/);
    expect(sql).toMatch(/agent_id = \$2 OR agent_id IS NULL/);
    expect(params).toEqual([3660, 33485]);
  });

  it('createAgentStatusPlaceholder without agentRowId still sweeps legacy null-agent rows only', async () => {
    await createAgentStatusPlaceholder(3660, { agentName: 'Auto' });

    const [, params] = deletes()[0];
    expect(params).toEqual([3660, null]);
  });

  it('resetAgentStatusForReuse keeps other agents\' plan and status rows', async () => {
    dbGetMock.mockResolvedValue({ conversation_id: 3660, agent_id: 33485 });

    await resetAgentStatusForReuse(555);

    const del = deletes();
    expect(del).toHaveLength(2);
    const planDel = del.find(([sql]) => /content_type = 'plan'/.test(sql));
    const statusDel = del.find(([sql]) => /content_type = 'agent_status'/.test(sql));
    expect(planDel[0]).toMatch(/agent_id = \$2 OR agent_id IS NULL/);
    expect(planDel[1]).toEqual([3660, 33485]);
    expect(statusDel[0]).toMatch(/id != \$2/);
    expect(statusDel[0]).toMatch(/agent_id = \$3 OR agent_id IS NULL/);
    expect(statusDel[1]).toEqual([3660, 555, 33485]);
  });
});

// Empty finished/error agent_status rows of OTHER agents used to survive every
// new run since 228709 and resurfaced as empty bubbles at the bottom of the feed
// (the status poll appends rows missing from the cache). Both sweeps now also
// remove any agent's terminal rows while leaving active ones alone.
describe('status.js — sweep other agents\' finished/error status rows', () => {
  const TERMINAL = /content_type = 'agent_status' AND metadata->>'agent_status' IN \('finished', 'error'\)/;

  beforeEach(() => {
    dbRunMock.mockReset();
    dbGetMock.mockReset();
    dbRunMock.mockResolvedValue({ lastInsertRowid: 901, changes: 1 });
  });

  it('createAgentStatusPlaceholder sweeps terminal rows regardless of agent_id', async () => {
    await createAgentStatusPlaceholder(3660, { agentName: 'Frontend QA', agentRowId: 41, senderId: 77 });

    const [sql, params] = deletes()[0];
    expect(sql).toMatch(TERMINAL);
    // Other agents' ACTIVE rows are still untouched: the terminal predicate is
    // the only agent-agnostic branch of the OR.
    expect(sql).toMatch(/agent_id = \$2 OR agent_id IS NULL OR \(content_type = 'agent_status'/);
    expect(params).toEqual([3660, 41]);
  });

  it('resetAgentStatusForReuse sweeps terminal rows of other agents but never the reused row', async () => {
    dbGetMock.mockResolvedValue({ conversation_id: 3660, agent_id: 41 });

    await resetAgentStatusForReuse(555);

    const statusDel = deletes().find(([sql]) => /content_type = 'agent_status' AND id != \$2/.test(sql));
    expect(statusDel[0]).toMatch(TERMINAL);
    expect(statusDel[1]).toEqual([3660, 555, 41]);
    // The plan sweep stays per-agent — plans of a running neighbour must survive.
    const planDel = deletes().find(([sql]) => /content_type = 'plan'/.test(sql));
    expect(planDel[0]).not.toMatch(TERMINAL);
  });
});
