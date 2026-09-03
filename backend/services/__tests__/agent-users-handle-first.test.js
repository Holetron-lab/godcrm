// ADR-164 Phase 1 — Pointer-first (handle-first) agent resolution.
//
// Proves the D3 resolver contract on the canonical service:
//   1. Global slug resolves passport-first:
//      handle -> users -> (managed_by_agent_table_id, managed_by_agent_row_id) -> config.
//      When the handle matches, the slug-by-name scan (dbAll) is NEVER run.
//   2. Fuzzy fallback is removed: a slug that only contains/prefixes an agent
//      name no longer resolves.
//   3. Slug-by-name survives as a deprecated fallback (exact match only) and
//      emits a WARN carrying event 'deprecated_slug_resolve'.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveAgentUser } from '../agent-users.js';

const mockDbAll = vi.fn();
const mockDbGet = vi.fn();
const mockDbRun = vi.fn();
const mockWarn = vi.fn();

vi.mock('../../database/connection.js', () => ({
  dbGet: (...a) => mockDbGet(...a),
  dbAll: (...a) => mockDbAll(...a),
  dbRun: (...a) => mockDbRun(...a),
  safeJsonParse: (raw, fallback) => {
    if (raw && typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return fallback; }
  },
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { debug: vi.fn(), info: vi.fn(), warn: (...a) => mockWarn(...a), error: vi.fn() },
}));

// ADR-165 WP-4 D4: agent-users.js now records passport acts in the hash-chained
// audit_log. Nothing here issues or revokes, but the import must not drag the
// real writer (and its logger/DB graph) into a pure unit suite.
vi.mock('../audit/writeAudit.js', () => ({ writeAudit: vi.fn() }));

beforeEach(() => {
  mockDbAll.mockReset();
  mockDbGet.mockReset();
  mockDbRun.mockReset();
  mockWarn.mockReset();
});

describe('ADR-164 handle-first resolution', () => {
  it('resolves by passport handle without ever scanning agent rows by name', async () => {
    const passport = {
      id: 24,
      name: 'Architect',
      handle: 'architect',
      user_type: 'agent',
      managed_by_agent_table_id: 1784,
      managed_by_agent_row_id: 987,
    };
    const residence = {
      row_id: 987,
      table_id: 1784,
      data: JSON.stringify({ name: 'Architect', status: 'active', model: 'opus' }),
    };

    mockDbGet.mockImplementation((sql) => {
      if (/lower\(handle\)/i.test(sql)) return Promise.resolve(passport);
      if (/FROM table_rows tr\s+WHERE tr\.id/i.test(sql)) return Promise.resolve(residence);
      return Promise.resolve(null);
    });

    const res = await resolveAgentUser('@architect');

    expect(res).not.toBeNull();
    expect(res.userId).toBe(24);
    expect(res.agentRowId).toBe(987);
    expect(res.user.handle).toBe('architect');
    expect(res.user._agentConfig.model).toBe('opus');
    // pointer-first: the slug-by-name scan must not run at all.
    expect(mockDbAll).not.toHaveBeenCalled();
    // pointer-first must never mint a new passport.
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('does NOT fuzzy-match a partial slug against an agent name', async () => {
    mockDbGet.mockResolvedValue(null);
    mockDbAll.mockResolvedValue([
      { row_id: 5, data: JSON.stringify({ name: 'Frontend Developer', status: 'active' }), table_id: 1784 },
    ]);

    const res = await resolveAgentUser('@frontend');

    expect(res).toBeNull();
    // fuzzy is gone: a partial slug must never mint a passport for the wrong agent.
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('falls back to exact slug-by-name and warns deprecated_slug_resolve', async () => {
    mockDbGet.mockImplementation((sql) => {
      if (/lower\(handle\)/i.test(sql)) return Promise.resolve(null);
      if (/managed_by_agent_row_id/i.test(sql)) return Promise.resolve({
        id: 900, name: 'Cryptoralph', user_type: 'agent', managed_by_agent_row_id: 42,
      });
      return Promise.resolve(null);
    });
    mockDbAll.mockResolvedValue([
      { row_id: 42, data: JSON.stringify({ name: 'Cryptoralph', status: 'active' }), table_id: 1784 },
    ]);

    const res = await resolveAgentUser('@cryptoralph');

    expect(res).not.toBeNull();
    expect(res.agentRowId).toBe(42);
    const warned = mockWarn.mock.calls.some(
      ([meta]) => meta && meta.event === 'deprecated_slug_resolve'
    );
    expect(warned).toBe(true);
  });
});
