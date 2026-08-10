// ADR-164 Phase 3a — characterization ("golden-set") test for the agent-table resolver.
//
// Proves the shadow-read contract that lets the 11 hot-path swaps be behaviour-preserving:
//   1. 'name' mode returns exactly the name-matched table ids (the legacy literal).
//   2. 'marker' mode returns exactly the table_type='ai_agents' ids.
//   3. 'dual' mode (default) RETURNS THE NAME-SET — byte-identical to the old behaviour —
//      regardless of what the marker set contains.
//   4. 'dual' logs divergence separately:
//        - name \ marker  -> WARN  kind=name_minus_marker  (SAFETY gate; must be empty in prod)
//        - marker \ name  -> INFO  kind=marker_minus_name   (feature signal)
//      and when the two sets are identical, it logs NOTHING.
//   5. spaceId scopes the query; empty result yields [].

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockDbAll = vi.fn();
const mockIsPostgres = vi.fn(() => true);
const mockWarn = vi.fn();
const mockInfo = vi.fn();

vi.mock('../../database/connection.js', () => ({
  dbAll: (...a) => mockDbAll(...a),
  isPostgres: (...a) => mockIsPostgres(...a),
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { debug: vi.fn(), info: (...a) => mockInfo(...a), warn: (...a) => mockWarn(...a), error: vi.fn() },
}));

const { getAgentTableIds } = await import('../agentTableResolver.js');

// Route each dbAll call to a name- or marker-set based on the SQL it runs.
function wireSets({ nameIds = [], markerIds = [] }) {
  mockDbAll.mockImplementation((sql) => {
    if (/ut\.table_type\s*=/i.test(sql)) return Promise.resolve(markerIds.map(id => ({ id })));
    if (/ut\.name\s*=/i.test(sql)) return Promise.resolve(nameIds.map(id => ({ id })));
    return Promise.resolve([]);
  });
}

const ORIG_MODE = process.env.AGENT_TABLE_RESOLVE_MODE;

beforeEach(() => {
  mockDbAll.mockReset();
  mockIsPostgres.mockReturnValue(true);
  mockWarn.mockReset();
  mockInfo.mockReset();
});
afterEach(() => {
  if (ORIG_MODE === undefined) delete process.env.AGENT_TABLE_RESOLVE_MODE;
  else process.env.AGENT_TABLE_RESOLVE_MODE = ORIG_MODE;
});

describe('getAgentTableIds — modes', () => {
  it("'name' mode returns the name-matched ids (legacy literal) and never queries the marker", async () => {
    process.env.AGENT_TABLE_RESOLVE_MODE = 'name';
    wireSets({ nameIds: [1784, 278], markerIds: [1784] });

    const ids = await getAgentTableIds();

    expect(ids.sort((a, b) => a - b)).toEqual([278, 1784]);
    expect(mockDbAll).toHaveBeenCalledTimes(1); // name only
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("'marker' mode returns the marker ids and never queries by name", async () => {
    process.env.AGENT_TABLE_RESOLVE_MODE = 'marker';
    wireSets({ nameIds: [1784, 278], markerIds: [1784, 999] });

    const ids = await getAgentTableIds();

    expect(ids.sort((a, b) => a - b)).toEqual([999, 1784]);
    expect(mockDbAll).toHaveBeenCalledTimes(1); // marker only
  });
});

describe('getAgentTableIds — dual (default) shadow-read', () => {
  it('returns the NAME-set even when the marker set differs (behaviour-preserving)', async () => {
    delete process.env.AGENT_TABLE_RESOLVE_MODE; // default => dual
    wireSets({ nameIds: [1784, 278], markerIds: [1784, 999] });

    const ids = await getAgentTableIds();

    expect(ids.sort((a, b) => a - b)).toEqual([278, 1784]); // == name-set, NOT the marker-set
    expect(mockDbAll).toHaveBeenCalledTimes(2); // both queried
  });

  it('logs name_minus_marker as a WARN (safety gate) when a served table lacks the marker', async () => {
    process.env.AGENT_TABLE_RESOLVE_MODE = 'dual';
    wireSets({ nameIds: [1784, 278], markerIds: [1784] }); // 278 has no marker

    await getAgentTableIds();

    const warned = mockWarn.mock.calls.some(
      ([meta]) => meta?.event === 'agent_table_resolve_divergence'
        && meta?.kind === 'name_minus_marker'
        && Array.isArray(meta.tableIds) && meta.tableIds.includes(278),
    );
    expect(warned).toBe(true);
  });

  it('logs marker_minus_name as INFO (feature signal) for renamed/copy_space/passport-less tables', async () => {
    process.env.AGENT_TABLE_RESOLVE_MODE = 'dual';
    wireSets({ nameIds: [1784], markerIds: [1784, 999] }); // 999 marker-only

    await getAgentTableIds();

    const infoed = mockInfo.mock.calls.some(
      ([meta]) => meta?.event === 'agent_table_resolve_divergence'
        && meta?.kind === 'marker_minus_name'
        && Array.isArray(meta.tableIds) && meta.tableIds.includes(999),
    );
    expect(infoed).toBe(true);
  });

  it('logs NOTHING when name-set and marker-set are identical (the post-backfill steady state)', async () => {
    process.env.AGENT_TABLE_RESOLVE_MODE = 'dual';
    wireSets({ nameIds: [1784, 278], markerIds: [278, 1784] }); // same set, any order

    const ids = await getAgentTableIds();

    expect(ids.sort((a, b) => a - b)).toEqual([278, 1784]);
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockInfo).not.toHaveBeenCalled();
  });
});

describe('getAgentTableIds — scoping & edge cases', () => {
  it('passes spaceId into the query and returns [] when nothing matches', async () => {
    process.env.AGENT_TABLE_RESOLVE_MODE = 'name';
    wireSets({ nameIds: [] });

    const ids = await getAgentTableIds({ spaceId: 11 });

    expect(ids).toEqual([]);
    const call = mockDbAll.mock.calls[0];
    expect(call[0]).toMatch(/p\.space_id/i);      // space-scoped SQL
    expect(call[1]).toEqual(['AI Agents', 11]);   // name + spaceId params
  });

  it('dedupes and coerces ids to integers', async () => {
    process.env.AGENT_TABLE_RESOLVE_MODE = 'name';
    mockDbAll.mockResolvedValue([{ id: 1784 }, { id: '1784' }, { id: 278 }, { id: null }]);

    const ids = await getAgentTableIds();

    expect(ids.sort((a, b) => a - b)).toEqual([278, 1784]);
  });
});
