/**
 * ADR-150 P0 — split-timestamp stall detection tick.
 *
 * Table-driven coverage for `_runStallDetectImpl` (the testable export of
 * `_runStallDetect`) and `legacyStallKillIfStuck`. Every test stubs out the
 * boundary calls (dbAll, dbRun, killStalledProcess, destroyWorkspace,
 * appendAuditLog, activeAttempts) so we can drive the dispatcher logic
 * without writing to the DB.
 *
 * The dispatcher's SQL filter is replicated in JS inside the `dbAllFn` mock
 * so each test exercises BOTH:
 *   1. The dispatcher passing the right params to the SQL
 *   2. The downstream kill/audit/stats behavior
 *
 * Cases covered (per brief):
 *   - heartbeat-only fresh + event stale 11min     → KILL
 *   - heartbeat-only fresh + event stale 9min      → SKIP
 *   - completion intent 30s ago + event stale 6min → SKIP (within grace)
 *   - completion intent 120s ago + event stale 11min → KILL (grace expired)
 *   - smart_liveness_enabled=false + 31min wall clock → KILL via legacy path
 *   - smart_liveness_enabled=true + event 30s old (productive) → SKIP
 *   - audit entry includes mode='smart' or 'legacy'
 *
 * The boot guard in `backend/test/setup.js` aborts if POSTGRES_HOST looks
 * like PROD. Importing index.js drags in the DB pool at module load, but
 * no real query is fired in this file (every dbAll/dbRun is stubbed).
 */

import { describe, expect, it } from 'vitest';

import {
  _runStallDetectImpl,
  legacyStallKillIfStuck,
} from '../index.js';

const MIN = 60_000;
const NOW_FIXED = 1_700_000_000_000;

/**
 * Build a candidate-row factory. Each row carries the JSONB-extracted
 * timestamps the dispatcher would read from postgres.
 */
function makeRow(overrides = {}) {
  return {
    id: 1001,
    run_attempt: 1,
    run_state: 'running',
    last_event_at: new Date(NOW_FIXED - 11 * MIN).toISOString(),
    completion_intent_at: null,
    last_heartbeat_at: new Date(NOW_FIXED - 1_000).toISOString(),
    ...overrides,
  };
}

/**
 * Replicate the dispatcher's SQL filter in JS so test rows are returned
 * iff they would have been returned by postgres. Mirrors:
 *   AND last_event_at < NOW() - $2
 *   AND (completion_intent_at IS NULL OR completion_intent_at < NOW() - $3)
 */
function simulateSmartFilter(rows, idleThresholdMs, closingGraceMs, now = NOW_FIXED) {
  return rows.filter((row) => {
    if (!row.last_event_at) return false;
    const eventAge = now - new Date(row.last_event_at).getTime();
    if (eventAge <= idleThresholdMs) return false;
    if (row.completion_intent_at) {
      const ciAge = now - new Date(row.completion_intent_at).getTime();
      if (ciAge <= closingGraceMs) return false;
    }
    return true;
  });
}

function simulateLegacyFilter(rows, idleThresholdMs, now = NOW_FIXED) {
  return rows.filter((row) => {
    if (!row.last_event_at) return false;
    const eventAge = now - new Date(row.last_event_at).getTime();
    return eventAge > idleThresholdMs;
  });
}

function makeConfig(overrides = {}) {
  return {
    smart_liveness_enabled: true,
    meaningful_event_idle_ms: 10 * MIN,   // 10 min
    closing_grace_ms: 90_000,             // 90 s
    runner_backstop_ms: 4 * 60 * MIN,
    max_attempts: 3,
    retry_backoff_min_ms: 10_000,
    retry_backoff_max_ms: 40_000,
    completion_intent_terminal_states: ['Done', 'Closed'],
    completion_intent_tools: ['send_chat_message', 'send_widget_message', 'send_ticket_message'],
    ...overrides,
  };
}

function makeDeps({
  rows = [],
  stuckRows = [],          // ADR-0042 Task 5b — rows with run_liveness_state='stuck_check'
  activeMap = new Map(),
  legacy = false,
  classify = null,         // injectable secondary-signals classifier mock
  nowMs = NOW_FIXED,       // ADR-0042 Task 5b — virtual clock for stuck_check window math
} = {}) {
  const calls = {
    dbRun: [],
    audit: [],
    kill: [],
    destroy: [],
    dbAllParams: null,         // last call's params (back-compat)
    dbAllParamsByCall: [],     // every call (sweep 1 + sweep 2)
    classifyCalls: [],
  };
  return {
    deps: {
      dbAllFn: async (_sql, params) => {
        calls.dbAllParams = params;
        calls.dbAllParamsByCall.push(params);
        // ADR-0042 Task 5b — sweep 1 is the stuck_check probe (1 param).
        // Returns the caller-provided stuckRows verbatim; the dispatcher
        // is in charge of pid lookup + classify + verdict math.
        if (Array.isArray(params) && params.length === 1) {
          return stuckRows;
        }
        if (legacy) {
          // legacy path: [TICKETS_TABLE_ID, idleThresholdMs]
          return simulateLegacyFilter(rows, Number(params[1]));
        }
        // smart path: [TICKETS_TABLE_ID, idleThresholdMs, closingGraceMs]
        return simulateSmartFilter(rows, Number(params[1]), Number(params[2]));
      },
      dbRunFn: async (sql, params) => { calls.dbRun.push([sql, params]); return undefined; },
      audit:   async (id, entry) => { calls.audit.push([id, entry]); },
      kill:    async (pid, id) => { calls.kill.push([pid, id]); return { signaled: true }; },
      destroy: async (id) => { calls.destroy.push([id]); },
      activeMap,
      ...(classify ? {
        classify: async (pid, baseline) => {
          calls.classifyCalls.push([pid, baseline]);
          return classify(pid, baseline);
        },
      } : {}),
      nowMs,
    },
    calls,
  };
}

// ─── case 1 — heartbeat fresh + event stale 11min → KILL ─────────────────

describe('AC2 — event stale past meaningful_event_idle_ms triggers kill', () => {
  it('event stale 11min, threshold 10min, no completion intent → KILL with reason=stall, mode=smart', async () => {
    const row = makeRow({
      id: 1101,
      last_event_at: new Date(NOW_FIXED - 11 * MIN).toISOString(),
      last_heartbeat_at: new Date(NOW_FIXED - 1_000).toISOString(),  // process alive
    });
    const activeMap = new Map([[row.id, { pid: 11111 }]]);
    const { deps, calls } = makeDeps({ rows: [row], activeMap });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    await _runStallDetectImpl({ source: 'test', stats, config: makeConfig(), deps });

    expect(calls.kill).toHaveLength(1);
    expect(calls.kill[0][0]).toBe(11111);
    expect(calls.audit).toHaveLength(1);
    expect(calls.audit[0][1].reason).toBe('stall');
    expect(calls.audit[0][1].mode).toBe('smart');
    // attempt=1 < max_attempts=3 → retry_after.
    expect(calls.audit[0][1].to).toBe('retry_after');
    expect(stats.stalled).toBe(1);
    expect(stats.stall_retried).toBe(1);
  });
});

// ─── case 2 — event stale 9min → SKIP ────────────────────────────────────

describe('AC2 — event still fresh stays under threshold', () => {
  it('event stale 9min, threshold 10min → SKIP, no kill, no audit', async () => {
    const row = makeRow({
      id: 1201,
      last_event_at: new Date(NOW_FIXED - 9 * MIN).toISOString(),
    });
    const activeMap = new Map([[row.id, { pid: 12121 }]]);
    const { deps, calls } = makeDeps({ rows: [row], activeMap });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const examined = await _runStallDetectImpl({ source: 'test', stats, config: makeConfig(), deps });

    expect(examined).toBe(0);
    expect(calls.kill).toHaveLength(0);
    expect(calls.audit).toHaveLength(0);
    expect(stats.stalled).toBe(0);
  });
});

// ─── case 3 — completion intent 30s ago + event stale 6min → SKIP ────────

describe('AC3 — completion-intent grace shields a closing run from kill', () => {
  it('completion intent 30s ago + event stale 6min (over threshold) + grace 90s → SKIP', async () => {
    const row = makeRow({
      id: 1301,
      last_event_at: new Date(NOW_FIXED - 6 * MIN).toISOString(),
      completion_intent_at: new Date(NOW_FIXED - 30_000).toISOString(),
    });
    const activeMap = new Map([[row.id, { pid: 13131 }]]);
    const { deps, calls } = makeDeps({ rows: [row], activeMap });

    // Lower idle threshold to 5 min so the event would otherwise fire,
    // and confirm the grace clause shields the row.
    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const examined = await _runStallDetectImpl({
      source: 'test',
      stats,
      config: makeConfig({ meaningful_event_idle_ms: 5 * MIN, closing_grace_ms: 90_000 }),
      deps,
    });

    expect(examined).toBe(0);
    expect(calls.kill).toHaveLength(0);
    expect(stats.stalled).toBe(0);
  });
});

// ─── case 4 — completion intent 120s ago + event stale 11min → KILL ──────

describe('AC3 — completion-intent grace expires after closing_grace_ms', () => {
  it('completion intent 120s ago + event stale 11min + grace 90s → KILL', async () => {
    const row = makeRow({
      id: 1401,
      last_event_at: new Date(NOW_FIXED - 11 * MIN).toISOString(),
      completion_intent_at: new Date(NOW_FIXED - 120_000).toISOString(),
      run_attempt: 0,
    });
    const activeMap = new Map([[row.id, { pid: 14141 }]]);
    const { deps, calls } = makeDeps({ rows: [row], activeMap });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    await _runStallDetectImpl({ source: 'test', stats, config: makeConfig(), deps });

    expect(calls.kill).toHaveLength(1);
    expect(calls.audit[0][1].reason).toBe('stall');
    expect(calls.audit[0][1].mode).toBe('smart');
    expect(stats.stalled).toBe(1);
  });
});

// ─── case 5 — productive run (events every 30s) → SKIP forever ──────────

describe('AC1 — productive long-running run is NEVER killed', () => {
  it('event 30s ago + 60min wall clock + smart_liveness_enabled=true → SKIP', async () => {
    const row = makeRow({
      id: 1501,
      last_event_at: new Date(NOW_FIXED - 30_000).toISOString(),  // chatty agent
      last_heartbeat_at: new Date(NOW_FIXED - 1_000).toISOString(),
    });
    const activeMap = new Map([[row.id, { pid: 15151 }]]);
    const { deps, calls } = makeDeps({ rows: [row], activeMap });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const examined = await _runStallDetectImpl({ source: 'test', stats, config: makeConfig(), deps });

    expect(examined).toBe(0);
    expect(calls.kill).toHaveLength(0);
    expect(stats.stalled).toBe(0);
  });
});

// ─── case 6 — smart_liveness_enabled=false → legacy path ────────────────

describe('AC5 — legacy conflated-clock path when smart_liveness disabled', () => {
  it('smart_liveness_enabled=false + 31min wall clock → KILL via legacy path with mode=legacy', async () => {
    const row = makeRow({
      id: 1601,
      run_attempt: 3,                                                      // = max → terminal failed
      last_event_at: new Date(NOW_FIXED - 31 * MIN).toISOString(),
    });
    const activeMap = new Map([[row.id, { pid: 16161 }]]);
    const { deps, calls } = makeDeps({ rows: [row], activeMap, legacy: true });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const examined = await _runStallDetectImpl({
      source: 'test',
      stats,
      config: makeConfig({ smart_liveness_enabled: false, meaningful_event_idle_ms: 30 * MIN, max_attempts: 3 }),
      deps,
    });

    expect(examined).toBe(1);
    expect(calls.kill).toHaveLength(1);
    expect(calls.audit).toHaveLength(1);
    expect(calls.audit[0][1].reason).toBe('stall');
    expect(calls.audit[0][1].mode).toBe('legacy');
    expect(calls.audit[0][1].to).toBe('failed');  // attempt 3 of 3 → terminal
    expect(stats.stalled).toBe(1);
    expect(stats.stall_failed).toBe(1);
  });

  it('legacyStallKillIfStuck — directly invokable (mode=legacy in audit)', async () => {
    const row = makeRow({
      id: 1611,
      run_attempt: 0,
      last_event_at: new Date(NOW_FIXED - 35 * MIN).toISOString(),
    });
    const activeMap = new Map([[row.id, { pid: 17171 }]]);
    const { deps, calls } = makeDeps({ rows: [row], activeMap, legacy: true });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const handled = await legacyStallKillIfStuck({
      source: 'test',
      stats,
      config: makeConfig({ meaningful_event_idle_ms: 30 * MIN, max_attempts: 3 }),
      deps,
    });

    expect(handled).toBe(1);
    expect(calls.kill).toHaveLength(1);
    expect(calls.audit[0][1].mode).toBe('legacy');
    expect(calls.audit[0][1].to).toBe('retry_after');
    expect(stats.stall_retried).toBe(1);
  });
});

// ─── extra — SQL params verification ────────────────────────────────────

describe('SQL params reflect resolved config', () => {
  it('smart path passes meaningful_event_idle_ms + closing_grace_ms as $2/$3', async () => {
    const { deps, calls } = makeDeps({ rows: [] });
    await _runStallDetectImpl({
      source: 'test',
      stats: { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 },
      config: makeConfig({ meaningful_event_idle_ms: 7 * MIN, closing_grace_ms: 45_000 }),
      deps,
    });
    // params: [TICKETS_TABLE_ID, idleThresholdMs, closingGraceMs]
    expect(calls.dbAllParams[1]).toBe(7 * MIN);
    expect(calls.dbAllParams[2]).toBe(45_000);
  });

  it('smart path falls back stall_timeout_ms → meaningful_event_idle_ms when only legacy key set', async () => {
    const { deps, calls } = makeDeps({ rows: [] });
    await _runStallDetectImpl({
      source: 'test',
      stats: { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 },
      config: { smart_liveness_enabled: true, stall_timeout_ms: 4 * MIN, max_attempts: 3 },
      deps,
    });
    expect(calls.dbAllParams[1]).toBe(4 * MIN);
  });
});

// ════════════════════════════════════════════════════════════════════════
// ADR-0042 Task 5b — secondary-signals consumer wired into stall detector
// ════════════════════════════════════════════════════════════════════════
//
// Sweep 1 of `_runStallDetect` reads any ticket parked in `stuck_check`,
// re-samples /proc via `classify(pid, baseline.cpu)`, and turns the verdict
// into a kill/no-kill decision before the meaningful-event sweep runs.
//
// These tests inject a mock `classify` via deps and a synthetic stuck row
// so we can drive every verdict path without touching real /proc.

const SAMPLE_BASELINE_CPU = Object.freeze({
  utime: 1000,
  stime: 200,
  capturedAt: NOW_FIXED - 90_000,
});

function makeStuckRow(overrides = {}) {
  return {
    id: 5001,
    run_attempt: 1,
    run_state: 'running',
    liveness_state: 'stuck_check',
    state_entered_at: new Date(NOW_FIXED - 30_000).toISOString(),
    stuck_check_baseline: { baseline: { cpu: SAMPLE_BASELINE_CPU }, prev_state: 'tool_active' },
    ...overrides,
  };
}

describe('AC5 — secondary-signals consumer (verdict drives kill)', () => {
  it('verdict=dead → killTicket called with reason=secondary_signals_dead', async () => {
    const stuck = makeStuckRow({ id: 5101 });
    const activeMap = new Map([[stuck.id, { pid: 51111 }]]);
    const { deps, calls } = makeDeps({
      stuckRows: [stuck],
      rows: [],   // no event-idle rows
      activeMap,
      classify: async () => ({ verdict: 'dead', reasons: ['stat:state=Z'], proof: {} }),
    });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const handled = await _runStallDetectImpl({
      source: 'test',
      stats,
      config: makeConfig(),
      deps,
    });

    expect(handled).toBe(1);
    expect(calls.classifyCalls).toHaveLength(1);
    expect(calls.classifyCalls[0][0]).toBe(51111);
    expect(calls.classifyCalls[0][1]).toBe(SAMPLE_BASELINE_CPU);
    expect(calls.kill).toHaveLength(1);
    expect(calls.kill[0][0]).toBe(51111);
    expect(calls.audit).toHaveLength(1);
    expect(calls.audit[0][1].reason).toBe('secondary_signals_dead');
    expect(calls.audit[0][1].mode).toBe('smart');
    expect(stats.stalled).toBe(1);
  });

  it('verdict=inconclusive + dwell within stuck_check_window_ms → NO kill', async () => {
    const stuck = makeStuckRow({
      id: 5201,
      // 30s dwell, default window is 60s → still within → no kill.
      state_entered_at: new Date(NOW_FIXED - 30_000).toISOString(),
    });
    const activeMap = new Map([[stuck.id, { pid: 52222 }]]);
    const { deps, calls } = makeDeps({
      stuckRows: [stuck],
      rows: [],
      activeMap,
      classify: async () => ({
        verdict: 'inconclusive',
        reasons: ['cpu:delta=0.00%', 'net/tcp:1 active connection'],
        proof: {},
      }),
    });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const handled = await _runStallDetectImpl({
      source: 'test',
      stats,
      config: makeConfig({ stuck_check_window_ms: 60_000 }),
      deps,
    });

    expect(handled).toBe(0);
    expect(calls.classifyCalls).toHaveLength(1);
    expect(calls.kill).toHaveLength(0);
    expect(calls.audit).toHaveLength(0);
    expect(stats.stalled).toBe(0);
  });

  it('verdict=inconclusive + dwell past stuck_check_window_ms → KILL with reason=inconclusive_timeout', async () => {
    const stuck = makeStuckRow({
      id: 5301,
      // 90s dwell, window 60s → past → kill with inconclusive_timeout.
      state_entered_at: new Date(NOW_FIXED - 90_000).toISOString(),
    });
    const activeMap = new Map([[stuck.id, { pid: 53333 }]]);
    const { deps, calls } = makeDeps({
      stuckRows: [stuck],
      rows: [],
      activeMap,
      classify: async () => ({
        verdict: 'inconclusive',
        reasons: ['cpu:delta=0.00%'],
        proof: {},
      }),
    });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const handled = await _runStallDetectImpl({
      source: 'test',
      stats,
      config: makeConfig({ stuck_check_window_ms: 60_000 }),
      deps,
    });

    expect(handled).toBe(1);
    expect(calls.kill).toHaveLength(1);
    expect(calls.kill[0][0]).toBe(53333);
    expect(calls.audit).toHaveLength(1);
    expect(calls.audit[0][1].reason).toBe('inconclusive_timeout');
    expect(calls.audit[0][1].mode).toBe('smart');
    expect(stats.stalled).toBe(1);
  });

  it('verdict=alive → NO kill, classify still invoked next tick', async () => {
    const stuck = makeStuckRow({ id: 5401 });
    const activeMap = new Map([[stuck.id, { pid: 54444 }]]);
    const { deps, calls } = makeDeps({
      stuckRows: [stuck],
      rows: [],
      activeMap,
      classify: async () => ({
        verdict: 'alive',
        reasons: ['cpu:delta=2.40%'],
        proof: {},
      }),
    });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const handled = await _runStallDetectImpl({
      source: 'test',
      stats,
      config: makeConfig(),
      deps,
    });

    expect(handled).toBe(0);
    expect(calls.classifyCalls).toHaveLength(1);
    expect(calls.kill).toHaveLength(0);
    expect(stats.stalled).toBe(0);
  });

  it('baseline missing (no stuck_check_baseline blob) → skip classify, fall through to event-idle sweep', async () => {
    // Row is parked in stuck_check but has no baseline (entry-path failure
    // mode). Sweep 1 must NOT call classify and NOT kill — leave it for
    // the event-idle sweep / next tick.
    const stuck = makeStuckRow({
      id: 5501,
      stuck_check_baseline: null,
    });
    const activeMap = new Map([[stuck.id, { pid: 55555 }]]);
    const classifySpy = async () => {
      throw new Error('classify must NOT be called when baseline is missing');
    };
    const { deps, calls } = makeDeps({
      stuckRows: [stuck],
      rows: [],
      activeMap,
      classify: classifySpy,
    });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const handled = await _runStallDetectImpl({
      source: 'test',
      stats,
      config: makeConfig(),
      deps,
    });

    expect(handled).toBe(0);
    expect(calls.classifyCalls).toHaveLength(0);
    expect(calls.kill).toHaveLength(0);
    expect(stats.stalled).toBe(0);
  });

  it('AC5 walkthrough — network-hung WebFetch (CPU delta=0, sockets=1) trips before backstop', async () => {
    // Realistic AC5 scenario: WebFetch is hanging on a stuck TCP socket.
    // CPU delta is zero, sockets > 0, classify returns INCONCLUSIVE (per
    // ADR §9 hybrid). With the dwell past stuck_check_window_ms, the
    // dispatcher kills with `inconclusive_timeout` — this is the line
    // ADR-0042 Task 5b was added to draw, well before the 4h backstop.
    const stuck = makeStuckRow({
      id: 5601,
      run_state: 'streaming',
      state_entered_at: new Date(NOW_FIXED - 75_000).toISOString(), // 75s dwell
    });
    const activeMap = new Map([[stuck.id, { pid: 56666 }]]);
    let baselineSeen = null;
    const { deps, calls } = makeDeps({
      stuckRows: [stuck],
      rows: [],
      activeMap,
      classify: async (pid, baseline) => {
        baselineSeen = baseline;
        // WebFetch wedged on TCP — sockets snapshot is positive but no
        // CPU progress since baseline → INCONCLUSIVE per hybrid rule.
        return {
          verdict: 'inconclusive',
          reasons: [
            'stat:state=S',
            'net/tcp:1 active connection',
            'children:0 subprocs',
            'cpu:delta=0.00%',
          ],
          proof: { active_sockets: 1, child_count: 0 },
        };
      },
    });

    const stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
    const handled = await _runStallDetectImpl({
      source: 'test',
      stats,
      config: makeConfig({ stuck_check_window_ms: 60_000 }),
      deps,
    });

    expect(handled).toBe(1);
    expect(baselineSeen).toBe(SAMPLE_BASELINE_CPU);
    expect(calls.kill).toHaveLength(1);
    expect(calls.kill[0][0]).toBe(56666);
    expect(calls.audit[0][1].reason).toBe('inconclusive_timeout');
    expect(calls.audit[0][1].mode).toBe('smart');
    expect(stats.stalled).toBe(1);
  });
});
