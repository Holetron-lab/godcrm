// ADR-164 Phase 2 — Passport lifecycle (issue / revoke).
//
// Proves the naturalization contract on the canonical service:
//   1. issuePassport sets the global handle on an agent residence, reusing
//      resolveAgentUser() for find-or-create (no second resolve path).
//   2. issuePassport is idempotent: re-issuing the same active handle writes
//      nothing (no duplicate passport, no error) — the 45→45 invariant.
//   3. issuePassport refuses a handle already held by another user
//      (global-unique index guarded with a clean error, not a raw PG throw).
//   4. revokePassport is soft: it NULLs the handle (dropping the agent from the
//      pointer-first path) and stamps an audit block — the row is kept.
//   5. revokePassport is idempotent and reports a missing passport cleanly.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { issuePassport, revokePassport } from '../agent-users.js';

const mockDbAll = vi.fn();
const mockDbGet = vi.fn();
const mockDbRun = vi.fn();

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
  apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  mockDbAll.mockReset();
  mockDbGet.mockReset();
  mockDbRun.mockReset();
  mockDbRun.mockResolvedValue({ rows: [] });
});

// SQL routers shared by the residence-resolution prefix of issuePassport →
// resolveAgentUser(rowId) → resolveByRowId → findOrCreateAgentUserForRow.
function residenceRow(rowId, agentData) {
  return { row_id: rowId, data: JSON.stringify(agentData), table_id: 1784 };
}

describe('ADR-164 issuePassport', () => {
  it('sets the handle on an existing passport that has none (naturalization)', async () => {
    const passport = {
      id: 900, name: 'CryptoRalph', handle: null, user_type: 'agent',
      managed_by_agent_table_id: 1784, managed_by_agent_row_id: 166740, agent_config: null,
    };
    mockDbGet.mockImplementation((sql) => {
      if (/FROM table_rows tr\s+JOIN universal_tables/i.test(sql)) {
        return Promise.resolve(residenceRow(166740, { name: 'CryptoRalph', status: 'active', slug: 'cryptoralph' }));
      }
      if (/SELECT \* FROM users WHERE managed_by_agent_row_id = \$1 AND user_type = 'agent'/i.test(sql)) {
        return Promise.resolve(passport);
      }
      if (/SELECT id, email FROM users WHERE lower\(handle\)/i.test(sql)) return Promise.resolve(null); // no clash
      if (/SELECT handle, agent_config FROM users WHERE id = \$1/i.test(sql)) {
        return Promise.resolve({ handle: null, agent_config: null });
      }
      return Promise.resolve(null);
    });

    const res = await issuePassport({ handle: 'cryptoralph', row_id: 166740, actor: 1 });

    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.handle).toBe('cryptoralph');
    expect(res.user_id).toBe(900);
    // handle written on the residence passport
    const update = mockDbRun.mock.calls.find(([sql]) => /UPDATE users SET handle = \$1/i.test(sql));
    expect(update).toBeTruthy();
    expect(update[1][0]).toBe('cryptoralph');
    expect(update[1][2]).toBe(900);
    const audit = JSON.parse(update[1][1]);
    expect(audit.passport.status).toBe('active');
    expect(audit.passport.issued_by).toBe(1);
  });

  it('is idempotent — re-issuing the same active handle writes nothing', async () => {
    const passport = {
      id: 24, name: 'Architect', handle: 'architect', user_type: 'agent',
      managed_by_agent_table_id: 1784, managed_by_agent_row_id: 987, agent_config: null,
    };
    mockDbGet.mockImplementation((sql) => {
      if (/FROM table_rows tr\s+JOIN universal_tables/i.test(sql)) {
        return Promise.resolve(residenceRow(987, { name: 'Architect', status: 'active', slug: 'architect' }));
      }
      if (/SELECT \* FROM users WHERE managed_by_agent_row_id = \$1 AND user_type = 'agent'/i.test(sql)) {
        return Promise.resolve(passport);
      }
      if (/SELECT id, email FROM users WHERE lower\(handle\)/i.test(sql)) return Promise.resolve(null);
      if (/SELECT handle, agent_config FROM users WHERE id = \$1/i.test(sql)) {
        return Promise.resolve({ handle: 'architect', agent_config: { passport: { status: 'active' } } });
      }
      return Promise.resolve(null);
    });

    const res = await issuePassport({ handle: 'architect', row_id: 987, actor: 1 });

    expect(res.ok).toBe(true);
    expect(res.changed).toBe(false);
    expect(res.idempotent).toBe(true);
    // no write of any kind
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('refuses a handle already held by another user', async () => {
    const passport = {
      id: 900, handle: null, user_type: 'agent',
      managed_by_agent_table_id: 1784, managed_by_agent_row_id: 166740, agent_config: null,
    };
    mockDbGet.mockImplementation((sql) => {
      if (/FROM table_rows tr\s+JOIN universal_tables/i.test(sql)) {
        return Promise.resolve(residenceRow(166740, { name: 'CryptoRalph', status: 'active' }));
      }
      if (/SELECT \* FROM users WHERE managed_by_agent_row_id = \$1 AND user_type = 'agent'/i.test(sql)) {
        return Promise.resolve(passport);
      }
      if (/SELECT id, email FROM users WHERE lower\(handle\)/i.test(sql)) {
        return Promise.resolve({ id: 18, email: 'orchestrator-x@agents.godcrm.local' }); // clash
      }
      return Promise.resolve(null);
    });

    const res = await issuePassport({ handle: 'orchestrator', row_id: 166740, actor: 1 });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('handle_taken');
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('reports residence_not_found when no locator is given', async () => {
    const res = await issuePassport({ handle: 'nobody' });
    // no residence via row_id/user_id, and handle resolves to no passport
    expect(res.ok).toBe(false);
    expect(res.error).toBe('residence_not_found');
  });
});

describe('ADR-164 revokePassport', () => {
  it('is soft: NULLs the handle and stamps a revoked audit, keeping the row', async () => {
    mockDbGet.mockImplementation((sql) => {
      if (/SELECT \* FROM users WHERE lower\(handle\) = lower\(\$1\) AND user_type = 'agent'/i.test(sql)) {
        return Promise.resolve({ id: 900, handle: 'cryptoralph', user_type: 'agent', agent_config: null });
      }
      return Promise.resolve(null);
    });

    const res = await revokePassport({ handle: 'cryptoralph', actor: 7 });

    expect(res.ok).toBe(true);
    expect(res.revoked).toBe(true);
    expect(res.prior_handle).toBe('cryptoralph');
    const update = mockDbRun.mock.calls.find(([sql]) => /UPDATE users SET handle = NULL/i.test(sql));
    expect(update).toBeTruthy();
    expect(update[1][1]).toBe(900);
    const audit = JSON.parse(update[1][0]);
    expect(audit.passport.status).toBe('revoked');
    expect(audit.passport.prior_handle).toBe('cryptoralph');
    expect(audit.passport.revoked_by).toBe(7);
  });

  it('is idempotent when the passport already has no handle', async () => {
    mockDbGet.mockImplementation((sql) => {
      if (/SELECT \* FROM users WHERE id = \$1 AND user_type = 'agent'/i.test(sql)) {
        return Promise.resolve({ id: 900, handle: null, user_type: 'agent', agent_config: null });
      }
      return Promise.resolve(null);
    });

    const res = await revokePassport({ user_id: 900, actor: 7 });

    expect(res.ok).toBe(true);
    expect(res.changed).toBe(false);
    expect(res.idempotent).toBe(true);
    expect(mockDbRun).not.toHaveBeenCalled();
  });

  it('reports passport_not_found for an unknown handle', async () => {
    mockDbGet.mockResolvedValue(null);
    const res = await revokePassport({ handle: 'ghost', actor: 7 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('passport_not_found');
    expect(mockDbRun).not.toHaveBeenCalled();
  });
});
