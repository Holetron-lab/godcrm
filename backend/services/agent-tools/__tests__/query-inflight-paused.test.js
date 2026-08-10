// @vitest-environment node
/**
 * ADR-0063-A §P3 — query_inflight_paused MCP wrapper tests.
 *
 * Mocks dbAll() and asserts the wrapper builds the right scope filter,
 * shapes the response, and degrades gracefully when no rows match.
 * Source-of-truth for the SQL stays in SystemTableService.queryInflightRuns;
 * tests here cover the handler-level contract:
 *   - admin=true is honoured ONLY when context.spaceId === 1 (otherwise dropped)
 *   - non-admin callers stay scoped to their context.spaceId via metadata.space_id
 *   - agent_slug + conversation_id filters propagate to the SQL WHERE clause
 *   - limit capped at 200, default 50
 *   - empty result + DB error shapes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbAll = vi.fn();
const dbGet = vi.fn();
const dbRun = vi.fn();
const isPostgres = vi.fn(() => true);
const sqlNow = vi.fn(() => 'NOW()');

vi.mock('../../../database/connection.js', () => ({
  dbAll: (...args) => dbAll(...args),
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
  isPostgres: (...args) => isPostgres(...args),
  sqlNow: (...args) => sqlNow(...args),
}));

vi.mock('../../../utils/logger.js', () => ({
  aiLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  apiLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { ticketToolHandlers } = await import('../ticket-tools.js');

beforeEach(() => {
  dbAll.mockReset();
});

function paused(id, overrides = {}) {
  return {
    id,
    ticket_id: null,
    agent_slug: 'developer-ralph',
    conversation_id: 3214,
    started_at: new Date(`2026-05-15T12:00:0${id}Z`),
    last_step_id: null,
    status: 'paused',
    reason: 'paused-rate-limit',
    resume_at: new Date(`2026-05-15T12:15:0${id}Z`),
    resume_attempts: 0,
    metadata: { space_id: 11, retry_after_s: 900 },
    updated_at: new Date(`2026-05-15T12:00:0${id}Z`),
    ...overrides,
  };
}

describe('query_inflight_paused — scope resolution', () => {
  it('admin=true is honoured from space-1 context → no metadata.space_id filter', async () => {
    dbAll.mockResolvedValueOnce([paused(1), paused(2, { metadata: { space_id: 35 } })]);

    const res = await ticketToolHandlers.query_inflight_paused(
      { admin: true },
      1,
      { spaceId: 1 }
    );

    expect(res.success).toBe(true);
    expect(res.admin_view).toBe(true);
    expect(res.space_id).toBe(1);
    expect(res.count).toBe(2);

    const [sql, params] = dbAll.mock.calls[0];
    expect(sql).toContain("status = ?");
    expect(sql).not.toContain("(metadata->>'space_id')::int");
    expect(params).toEqual(['paused', 50]);
  });

  it('admin=true is silently DROPPED when caller is not in space-1', async () => {
    dbAll.mockResolvedValueOnce([paused(1)]);

    const res = await ticketToolHandlers.query_inflight_paused(
      { admin: true },
      1,
      { spaceId: 11 }
    );

    expect(res.admin_view).toBe(false);
    expect(res.space_id).toBe(11);
    const [sql, params] = dbAll.mock.calls[0];
    expect(sql).toContain("(metadata->>'space_id')::int = ?");
    expect(params).toEqual([11, 'paused', 50]);
  });

  it('non-admin caller is scoped to context.spaceId via metadata.space_id', async () => {
    dbAll.mockResolvedValueOnce([paused(1)]);

    await ticketToolHandlers.query_inflight_paused({}, 1, { spaceId: 11 });

    const [sql, params] = dbAll.mock.calls[0];
    expect(sql).toContain("(metadata->>'space_id')::int = ?");
    expect(params).toEqual([11, 'paused', 50]);
  });

  it('no context.spaceId + no admin → unfiltered query (system/internal caller)', async () => {
    dbAll.mockResolvedValueOnce([paused(1)]);

    const res = await ticketToolHandlers.query_inflight_paused({}, 1);

    // admin_view stays false because admin !== true
    expect(res.admin_view).toBe(false);
    expect(res.space_id).toBe(null);
    const [sql, params] = dbAll.mock.calls[0];
    expect(sql).not.toContain("metadata->>'space_id'");
    expect(params).toEqual(['paused', 50]);
  });
});

describe('query_inflight_paused — agent_slug / conversation_id / limit', () => {
  it('passes agent_slug into the WHERE clause', async () => {
    dbAll.mockResolvedValueOnce([paused(1, { agent_slug: 'architect' })]);

    await ticketToolHandlers.query_inflight_paused(
      { admin: true, agent_slug: 'architect' },
      1,
      { spaceId: 1 }
    );

    const [sql, params] = dbAll.mock.calls[0];
    expect(sql).toContain('agent_slug = ?');
    expect(params).toEqual(['paused', 'architect', 50]);
  });

  it('passes conversation_id into the WHERE clause', async () => {
    dbAll.mockResolvedValueOnce([paused(1, { conversation_id: 3214 })]);

    await ticketToolHandlers.query_inflight_paused(
      { admin: true, conversation_id: 3214 },
      1,
      { spaceId: 1 }
    );

    const [sql, params] = dbAll.mock.calls[0];
    expect(sql).toContain('conversation_id = ?');
    expect(params).toEqual(['paused', 3214, 50]);
  });

  it('caps limit at 200', async () => {
    dbAll.mockResolvedValueOnce([]);

    await ticketToolHandlers.query_inflight_paused({ admin: true, limit: 9999 }, 1, { spaceId: 1 });

    const [, params] = dbAll.mock.calls[0];
    expect(params[params.length - 1]).toBe(200);
  });

  it('uses default limit 50 when omitted', async () => {
    dbAll.mockResolvedValueOnce([]);

    await ticketToolHandlers.query_inflight_paused({ admin: true }, 1, { spaceId: 1 });

    const [, params] = dbAll.mock.calls[0];
    expect(params[params.length - 1]).toBe(50);
  });
});

describe('query_inflight_paused — empty result edge', () => {
  it('returns success with count=0 + empty runs when no rows match', async () => {
    dbAll.mockResolvedValueOnce([]);

    const res = await ticketToolHandlers.query_inflight_paused({}, 1, { spaceId: 11 });

    expect(res).toMatchObject({
      success: true,
      space_id: 11,
      admin_view: false,
      count: 0,
      runs: [],
    });
  });

  it('surfaces DB errors as { error } shape, not a throw', async () => {
    dbAll.mockRejectedValueOnce(new Error('connection refused'));

    const res = await ticketToolHandlers.query_inflight_paused({ admin: true }, 1, { spaceId: 1 });

    expect(res).toEqual({ error: 'connection refused' });
  });
});

describe('query_inflight_paused — row shape', () => {
  it('returns id/ticket_id/agent_slug/conversation_id/status/reason/resume_at/metadata', async () => {
    dbAll.mockResolvedValueOnce([
      paused(7, { metadata: { space_id: 11, retry_after_s: 60 } }),
    ]);

    const res = await ticketToolHandlers.query_inflight_paused(
      { admin: true },
      1,
      { spaceId: 1 }
    );

    expect(res.runs[0]).toMatchObject({
      id: 7,
      agent_slug: 'developer-ralph',
      conversation_id: 3214,
      status: 'paused',
      reason: 'paused-rate-limit',
      metadata: { space_id: 11, retry_after_s: 60 },
    });
    expect(res.runs[0].started_at).toBeInstanceOf(Date);
  });
});
