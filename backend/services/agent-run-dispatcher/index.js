/**
 * Agent Run Dispatcher — ADR-0030 Phase 2 (dry-run mode).
 *
 * In-process worker that ticks every `_workflow_config.poll_interval_ms`
 * (default 30s) and drives the run-state machine on tickets table 1708.
 *
 * Phase 2 scope (dry-run):
 *   - Tick Part A: stall detection — no-op pass while no live runs exist.
 *   - Tick Part B: claim ready tickets and immediately cancel them with
 *     terminal_reason='phase2_dryrun'. Validates state machine + DB
 *     mutations + concurrency guards without running real agent work.
 *
 * Real agent execution (worktree, claude CLI, stream handler, TOTP gate)
 * lands in Phases 3–5.
 *
 * Module Lifecycle (ADR-0025): exports init / shutdown / health.
 * Manual tick trigger for tests:
 *   POST /api/v3/admin/agent-run-dispatcher/tick   (admin-only).
 *
 * Feature flag: AGENT_RUN_DISPATCHER_ENABLED. Defaults to false in
 * Phase 2 — must be flipped to 'true' explicitly per environment.
 *
 * @see ADR-0030 §3.2 (_workflow_config), §3.3 (tick), §3.4 (run_* cols).
 */

import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { createWorkspace, destroyWorkspace } from './workspace-manager.js';
import { buildRunPrompt } from './build-run-prompt.mjs';
import { runStreamHandler, eventTranslator, warnLegacyOnce } from './run-stream-handler.mjs';
import {
  STATES,
  SIDE_EFFECTS,
  INITIAL,
  transition,
} from './state-machine.js';
import {
  generateApprovalCode,
  persistApprovalRequest,
  awaitApproval,
  APPROVAL_OUTCOMES,
  APPROVAL_CONSTANTS,
} from './approval-gate.js';
import { classify as classifySecondarySignals, VERDICT } from './secondary-signals.js';
import { isCompletionIntent as evtIsCompletionIntent } from './completion-intent.js';

const log = apiLogger.child({ module: 'agent_run_dispatcher' });

// Phase env flag (ADR-0030 Phase 4):
//   'dryrun'         → Phase 2 behavior (default, safe). Cancel immediately
//                      with run_terminal_reason='phase2_dryrun'.
//   'workspace_only' → Phase 3 behavior. Materialize git worktree, store
//                      path on ticket, then cancel with reason
//                      'phase3_workspace_only'. Still no claude CLI.
//   'live'           → Phase 4 behavior. Materialize worktree, build prompt
//                      from ticket+agent, spawn `claude --print` via the
//                      runner script, stream NDJSON, then transition to
//                      run_state='succeeded'|'failed' (NOT terminal ticket
//                      state). Workspace destroyed in finally.
// Read once at module load. Operators flip via env + restart.
const RUN_DISPATCHER_PHASE = (() => {
  const v = (process.env.RUN_DISPATCHER_PHASE || 'dryrun').toLowerCase();
  if (v !== 'dryrun' && v !== 'workspace_only' && v !== 'live') {
    // Unknown phase value → fall back to safest (dryrun) and warn at init.
    return 'dryrun';
  }
  return v;
})();

// Phase 5 env flag: gate live runs behind a TOTP approval step.
//   'true'  → generate 6-digit code, post to ticket chat, block until
//             approve/deny/expire. DEFAULT in 'live' phase (security-critical).
//   'false' → skip the gate entirely (P4 behavior). Used by smoke tests and
//             one-off operator overrides only.
// We intentionally default to 'true' in 'live' phase; in dryrun/workspace_only
// the gate is irrelevant (we never reach processLive).
const RUN_REQUIRE_APPROVAL = (() => {
  const v = (process.env.RUN_REQUIRE_APPROVAL || '').toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  if (v === 'true' || v === '1' || v === 'yes') return true;
  // Default: ON when phase is 'live'.
  return (process.env.RUN_DISPATCHER_PHASE || 'dryrun').toLowerCase() === 'live';
})();

// Audit-log rate limit for noisy stream events (per-ticket).
const AUDIT_RATE_LIMIT_MS = 5_000;

// ─── Constants (table IDs are stable per CLAUDE.md) ────────────
const TICKETS_TABLE_ID = 1708;
const WORKFLOW_CONFIG_TABLE_ID = 100000;
// _workflow_config is a singleton table — id is autoincrement, fetch the
// only row by table_id rather than guessing an id.

const FIRST_TICK_DELAY_MS = 5_000;
const FALLBACK_POLL_INTERVAL_MS = 30_000;
const CONFIG_RELOAD_INTERVAL_MS = 5 * 60 * 1000;

// Terminal `state` values from pipeline-config.js Space 11 — tickets in
// these states MUST NOT be claimed by the run loop ("not closed" filter
// per ADR-0030 §3.3).
const TICKET_TERMINAL_STATES = ['24278', '24277', '43438', '43437'];
//                              done    review  rejected control

// Run states eligible for claim (idle is the implicit default for tickets
// that never started a run — `data->>'run_state'` is NULL on those rows;
// we cover both NULL and 'idle' explicitly).
const CLAIMABLE_RUN_STATES = ['idle', 'queued', 'retry_after'];

// ADR-0030 Phase 6 — run states that are subject to stall detection. Note:
// 'awaiting_approval' is INTENTIONALLY excluded — humans are slow on purpose.
// 'streaming' is currently a synonym used by some flows for 'running'; both
// are checked so we don't miss a hung run that landed in either bucket.
const STALL_CHECK_RUN_STATES = ['preparing', 'running', 'streaming'];

// SIGKILL grace after SIGTERM during stall-kill. Mirrors the runner's own
// timeout path — keep them aligned so a hung child gets the same treatment
// regardless of which timer fires first.
const STALL_SIGKILL_GRACE_MS = 5_000;

// Default config (used only if _workflow_config row vanishes — defensive).
//
// ADR-0042 §10 (lines 296–317) is authoritative for the smart-liveness keys
// below. Flat keys at top level so they round-trip through the existing
// shallow merge in `loadConfig()`; nested objects (`tool_timeout_ms`,
// `secondary_signal_thresholds`) are JSONB blobs replaced wholesale on
// override. Operators tune via the existing `_workflow_config` MCP UI.
const DEFAULT_CONFIG = {
  poll_interval_ms: FALLBACK_POLL_INTERVAL_MS,
  max_concurrent_runs: 3,
  max_per_agent: 1,
  max_attempts: 3,
  paused: false,
  // Phase 6 stall detection knobs (legacy single-threshold path).
  stall_timeout_ms: 300_000,        // 5 min between events before a run is considered stalled (legacy alias)
  // ADR-150 P0 — meaningful-event freshness window. Replaces `stall_timeout_ms`
  // semantically; legacy key is read as a fallback during the deprecation
  // window. Default raised to 10 min: agents legitimately go quiet during
  // long Bash/WebFetch tools and the per-state FSM no longer governs this
  // path. Operators can lower via `_workflow_config`.
  meaningful_event_idle_ms: 600_000,
  retry_backoff_min_ms: 10_000,     // attempt 1 → 10s
  retry_backoff_max_ms: 40_000,     // cap so we don't push retries past 40s window

  // ─── ADR-0042 smart-liveness FSM (Task 3) ─────────────────────
  // AC8 rollback: setting `false` reverts to the legacy 30-min cap path
  // driven by `stall_timeout_ms`.
  smart_liveness_enabled: true,

  // Per-state idle thresholds (ADR §10, §State Machine table lines 62–68).
  idle_idle_ms:           300_000,        // 5 min
  thinking_idle_ms:       360_000,        // 6 min
  closing_grace_ms:        90_000,        // 90 s — no kill, only grace before backstop
  stuck_check_window_ms:   60_000,        // 60 s observation in stuck_check
  // Per-tool timeouts (used when state=tool_active). Lookup is
  // `config.tool_timeout_ms[toolName] ?? config.tool_timeout_ms.default`.
  // ADR §Per-Tool Timeout Map (lines 196–215).
  tool_timeout_ms: {
    Bash:        900_000,    // 15 min — long builds
    WebFetch:    300_000,    // 5 min — slow upstreams
    deep_scrape: 600_000,    // 10 min — multi-page crawls
    web_search:  180_000,    // 3 min
    Grep:         60_000,
    Glob:         60_000,
    Read:         60_000,
    Edit:         60_000,
    Write:        60_000,
    MultiEdit:    60_000,
    TodoWrite:    30_000,
    manage_plan:  30_000,
    default:     300_000,    // fallback for unlisted / MCP tools
  },

  // Secondary-signal classifier (Task 2 owns sampling/classify;
  // dispatcher reads these on stuck_check entry).
  //
  // ADR-0042 hybrid (variant C): CPU% delta-vs-baseline is the PRIMARY
  // liveness axis — sockets/children remain snapshot-only.
  //   - cpu_liveness_threshold_pct: default 1% — over threshold → ALIVE.
  //     Conservative: even a barely-alive event loop ticks above this.
  //   - cpu_alive_pct / cpu_dead_pct / require_all_dead are LEGACY keys
  //     from pre-hybrid Task 2; left in place so older config rows that
  //     reference them don't crash. Remove once §3 migration completes.
  secondary_signal_thresholds: {
    cpu_liveness_threshold_pct: 1,
    cpu_alive_pct:    0.5,        // legacy
    cpu_dead_pct:     0.05,       // legacy
    require_all_dead: true,       // legacy
  },

  // Backstop — wall-clock hard guard. Single warn entry at 75% elapsed.
  // ADR §Stream Handler Changes (lines 232–239).
  runner_backstop_ms:  4 * 60 * 60 * 1000,    // 4h
  backstop_warn_ratio: 0.75,                  // warn at 3h

  // Completion-intent predicate inputs. Locked decision (per Task 3 brief):
  // setter-tools (`update_ticket_status`, `update_table_row`,
  // `mcp__godcrm__update_table_row`) participate when their `input.status`
  // is in `completion_intent_terminal_states` — the FSM module's
  // `transition()` enforces the guard; the list here is the universe.
  completion_intent_tools: [
    'send_chat_message',
    'send_widget_message',
    'send_ticket_message',
    'ExitPlanMode',
    'EndTurn',
    'update_ticket_status',
    'update_table_row',
    'mcp__godcrm__update_table_row',
  ],
  completion_intent_terminal_states: ['Done', 'Closed', 'Resolved'],
};

// Map FSM state → the DEFAULT_CONFIG key holding its idle threshold.
// Extracted for `effectiveThresholdMs` so the lookup stays declarative.
const STATE_TIMEOUT_KEY = Object.freeze({
  idle:        'idle_idle_ms',
  thinking:    'thinking_idle_ms',
  tool_active: null,                  // resolved per-tool; falls back via DEFAULT
  closing:     'closing_grace_ms',
  stuck_check: 'stuck_check_window_ms',
});

/**
 * ADR-0042 §10 — resolve the effective idle threshold (ms) for a given
 * (state, toolName) pair. Pure function, no side effects, no I/O.
 *
 * Priority:
 *   1. If `toolName` is provided AND `config.tool_timeout_ms[toolName]` is
 *      set → return that. (Per-tool override always wins, regardless of
 *      state — this matches AC3: a long Bash run survives the 6-min
 *      thinking threshold because Bash is 15 min.)
 *   2. Else if `state` maps to a flat key (e.g. `idle_idle_ms`) and the
 *      config has a numeric value there → return that.
 *   3. Else → `config.tool_timeout_ms.default` (per-tool fallback).
 *   4. Else → DEFAULT_CONFIG values for the same lookup chain.
 *
 * Defensive: nullish/missing config never throws.
 *
 * @param {string|null|undefined} state — one of FSM STATES values
 * @param {string|null|undefined} toolName — current tool name when state=tool_active
 * @param {object|null|undefined} config — usually the merged loadConfig() result
 * @returns {number} threshold in milliseconds
 */
export function effectiveThresholdMs(state, toolName, config) {
  const cfg = config && typeof config === 'object' ? config : null;

  // 1. Per-tool override.
  if (toolName) {
    const cfgTools = cfg && cfg.tool_timeout_ms;
    if (cfgTools && typeof cfgTools === 'object') {
      const v = cfgTools[toolName];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    }
    const defTools = DEFAULT_CONFIG.tool_timeout_ms;
    const dv = defTools[toolName];
    if (typeof dv === 'number' && Number.isFinite(dv) && dv > 0) return dv;
  }

  // 2. Per-state flat key.
  if (state) {
    const key = STATE_TIMEOUT_KEY[state];
    if (key) {
      if (cfg && typeof cfg[key] === 'number' && Number.isFinite(cfg[key]) && cfg[key] > 0) {
        return cfg[key];
      }
      const dv = DEFAULT_CONFIG[key];
      if (typeof dv === 'number' && Number.isFinite(dv) && dv > 0) return dv;
    }
  }

  // 3. Per-tool default fallback.
  const cfgTools = cfg && cfg.tool_timeout_ms;
  if (cfgTools && typeof cfgTools.default === 'number'
      && Number.isFinite(cfgTools.default) && cfgTools.default > 0) {
    return cfgTools.default;
  }

  // 4. Hard-coded ultimate fallback.
  return DEFAULT_CONFIG.tool_timeout_ms.default;
}

// ─── Module state ──────────────────────────────────────────────
let intervalHandle = null;
let firstTickTimer = null;
let isTicking = false;
let cachedConfig = null;
let configLoadedAt = 0;
let currentPollIntervalMs = FALLBACK_POLL_INTERVAL_MS;

// In-memory tracker for "currently running" attempts. In dry-run we
// transition straight to canceled within a single tick, so this stays
// at zero in practice — but the framework is in place for Phase 3+.
const _activeAttempts = new Map(); // ticket_id → { agent_id, claimedAt }

/**
 * Load the singleton _workflow_config row, with caching.
 * Re-fetches from DB at most every CONFIG_RELOAD_INTERVAL_MS.
 */
export async function loadConfig({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedConfig && now - configLoadedAt < CONFIG_RELOAD_INTERVAL_MS) {
    return cachedConfig;
  }
  try {
    const row = await dbGet(
      `SELECT data FROM table_rows WHERE table_id = $1 ORDER BY id ASC LIMIT 1`,
      [WORKFLOW_CONFIG_TABLE_ID]
    );
    if (!row?.data) {
      log.warn(
        { table_id: WORKFLOW_CONFIG_TABLE_ID },
        '_workflow_config row missing — using DEFAULT_CONFIG'
      );
      cachedConfig = { ...DEFAULT_CONFIG };
    } else {
      const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
    }
    configLoadedAt = now;
    return cachedConfig;
  } catch (err) {
    log.error({ err }, 'failed to load _workflow_config — keeping previous cache');
    return cachedConfig || { ...DEFAULT_CONFIG };
  }
}

/**
 * Append a transition entry to the ticket's data.run_audit_log JSONB array.
 * Read-modify-write within the existing transaction is unnecessary here:
 * jsonb_insert keeps the operation server-side and atomic per row.
 */
async function appendAuditLog(ticketId, entry) {
  try {
    await dbRun(
      `UPDATE table_rows
          SET data = jsonb_set(
                       COALESCE(data, '{}'::jsonb),
                       '{run_audit_log}',
                       COALESCE(data->'run_audit_log', '[]'::jsonb) || $2::jsonb,
                       true
                     ),
              updated_at = NOW()
        WHERE table_id = $1 AND id = $3`,
      [TICKETS_TABLE_ID, JSON.stringify([entry]), ticketId]
    );
  } catch (err) {
    log.warn({ err, ticket_id: ticketId }, 'audit log append failed (non-blocking)');
  }
}

/**
 * ADR-0030 Phase 6 — exponential backoff for retry scheduling.
 *
 * Pure function, exported for unit-test introspection. Attempt is the
 * 1-based index of the run that just stalled (so the FIRST stall is
 * attempt=1 → minWindow). The next attempt's wait grows by powers of 2
 * but is clamped to retry_backoff_max_ms.
 *
 *   attempt=1 → min        (10000ms default)
 *   attempt=2 → min*2      (20000ms)
 *   attempt=3 → min*4      (40000ms — hits cap by default)
 *   attempt=N → min(min*2^(N-1), max)
 */
export function computeBackoff(attempt, config = DEFAULT_CONFIG) {
  const min = Number(config?.retry_backoff_min_ms) || DEFAULT_CONFIG.retry_backoff_min_ms;
  const max = Number(config?.retry_backoff_max_ms) || DEFAULT_CONFIG.retry_backoff_max_ms;
  const a = Math.max(1, Number(attempt) | 0);
  // 2^(a-1) — guard against absurd attempts saturating Math.pow.
  const exp = Math.min(a - 1, 30);
  return Math.min(min * Math.pow(2, exp), max);
}

/**
 * Probe whether a process exists. `process.kill(pid, 0)` does NOT signal —
 * it just throws if the PID is gone (ESRCH) or refused (EPERM, treated as
 * "exists but ours-not-to-touch"). Returns false for ESRCH / invalid pid,
 * true otherwise so we can decide whether to escalate to SIGKILL.
 */
function probeAlive(pid) {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process. Anything else (e.g., EPERM) we treat as
    // "still around" since we can't confirm it's gone.
    if (err && err.code === 'ESRCH') return false;
    return true;
  }
}

/**
 * Send SIGTERM, then SIGKILL after grace if still alive. Best-effort —
 * each kill is wrapped so a missing PID never bubbles. Async because we
 * sleep between term and kill.
 */
async function killStalledProcess(pid, ticketId) {
  if (!probeAlive(pid)) {
    log.debug({ ticket_id: ticketId, pid }, 'stall: pid already gone (no signal needed)');
    return { signaled: false, reason: 'already_gone' };
  }
  try {
    process.kill(pid, 'SIGTERM');
    log.info({ ticket_id: ticketId, pid }, 'stall: SIGTERM sent');
  } catch (err) {
    if (err && err.code === 'ESRCH') {
      return { signaled: false, reason: 'esrch_on_term' };
    }
    log.warn({ err: err.message, pid, ticket_id: ticketId }, 'stall: SIGTERM failed');
  }
  await new Promise((r) => setTimeout(r, STALL_SIGKILL_GRACE_MS));
  if (probeAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
      log.warn({ ticket_id: ticketId, pid }, 'stall: SIGKILL sent (SIGTERM grace expired)');
      return { signaled: true, escalated: true };
    } catch (err) {
      if (err && err.code === 'ESRCH') {
        return { signaled: true, escalated: false };
      }
      log.warn({ err: err.message, pid, ticket_id: ticketId }, 'stall: SIGKILL failed');
    }
  }
  return { signaled: true, escalated: false };
}

// ─── ADR-0042 Task 4 — FSM persistence helpers ─────────────────
//
// All helpers are best-effort (warn + swallow on failure). The FSM is
// pure; this layer mediates between FSM `sideEffects[]` outputs and the
// JSONB columns on the ticket row. Heartbeat ordering: bump after the
// state write so a state flip is never visible without its associated
// `run_last_event_at` advance.

/**
 * Persist `data.run_liveness_state` AND bump `run_state_entered_at` to NOW().
 * Called when transition() returns a state different from the previously-
 * persisted one. The `entered_at` stamp is what the stall-detect tick
 * compares against `effectiveThresholdMs(state, tool)`, so it MUST advance
 * on every state flip — otherwise a long thinking → tool_active → thinking
 * cycle would inherit the original entered_at and trip the threshold.
 */
export async function persistStateChange(rowId, newState) {
  if (!rowId || typeof newState !== 'string') return;
  try {
    const ts = new Date().toISOString();
    await dbRun(
      `UPDATE table_rows
          SET data = data
                     || jsonb_build_object(
                          'run_liveness_state', $2::text,
                          'run_state_entered_at', $3::text
                        ),
              updated_at = NOW()
        WHERE table_id = $1 AND id = $4`,
      [TICKETS_TABLE_ID, newState, ts, rowId]
    );
  } catch (err) {
    log.warn({ err: err.message, ticket_id: rowId, newState }, 'persistStateChange failed (non-blocking)');
  }
}

/**
 * Persist `data.run_current_tool` (object | null). Set on tool_started,
 * cleared on tool_finished. Shape: `{name, tool_use_id, attempt_idx}`.
 */
export async function persistCurrentTool(rowId, toolName) {
  if (!rowId) return;
  try {
    if (toolName == null) {
      // Clear key entirely.
      await dbRun(
        `UPDATE table_rows
            SET data = data - 'run_current_tool',
                updated_at = NOW()
          WHERE table_id = $1 AND id = $2`,
        [TICKETS_TABLE_ID, rowId]
      );
    } else {
      // toolName may be the full {name,...} object or a bare string.
      const payload = typeof toolName === 'object' ? toolName : { name: String(toolName) };
      await dbRun(
        `UPDATE table_rows
            SET data = jsonb_set(data, '{run_current_tool}', $2::jsonb, true),
                updated_at = NOW()
          WHERE table_id = $1 AND id = $3`,
        [TICKETS_TABLE_ID, JSON.stringify(payload), rowId]
      );
    }
  } catch (err) {
    log.warn({ err: err.message, ticket_id: rowId }, 'persistCurrentTool failed (non-blocking)');
  }
}

/**
 * Persist a stuck-check baseline snapshot. ADR-0042 Task 5 shape:
 *   {
 *     baseline: <secondary-signals proof blob>,    // raw classify() proof
 *     prev_state: '<idle|thinking|tool_active|closing>',  // for restore
 *   }
 *
 * Called once on entry into `stuck_check` state. The dispatcher's
 * `_runStallDetect` tick re-reads this on the *next* tick — if the second
 * sample says alive, we restore prev_state; if dead, we kill; if
 * inconclusive past a window, we kill `stuck_inconclusive`.
 *
 * `entered_at` is intentionally NOT duplicated here — that lives in
 * `data.run_state_entered_at` and is set by `persistStateChange`.
 */
export async function persistStuckCheckBaseline(rowId, payload) {
  if (!rowId) return;
  try {
    const blob = payload && typeof payload === 'object'
      ? {
          baseline: payload.baseline ?? null,
          prev_state: typeof payload.prev_state === 'string' ? payload.prev_state : null,
        }
      : { baseline: null, prev_state: null };
    await dbRun(
      `UPDATE table_rows
          SET data = jsonb_set(data, '{run_stuck_check_baseline}', $2::jsonb, true),
              updated_at = NOW()
        WHERE table_id = $1 AND id = $3`,
      [TICKETS_TABLE_ID, JSON.stringify(blob), rowId]
    );
  } catch (err) {
    log.warn({ err: err.message, ticket_id: rowId }, 'persistStuckCheckBaseline failed (non-blocking)');
  }
}

/**
 * ADR-0042 Task 5 — clear the stuck-check baseline + restore prior FSM state.
 * Used when a `stuck_check` re-sample classifies the process as 'alive':
 * the ticket goes back to whatever state it came from, the entered_at clock
 * resets to NOW so the next idle-window starts fresh, and the baseline blob
 * is dropped.
 *
 * Best-effort: any failure is warned + swallowed. The next tick will simply
 * re-evaluate on stale data (worst case: another stuck_check entry).
 */
export async function restorePriorState(rowId, prevState) {
  if (!rowId || typeof prevState !== 'string' || prevState.length === 0) return;
  try {
    const ts = new Date().toISOString();
    await dbRun(
      `UPDATE table_rows
          SET data = (data
                      || jsonb_build_object(
                           'run_liveness_state', $2::text,
                           'run_state_entered_at', $3::text
                         )
                     ) - 'run_stuck_check_baseline',
              updated_at = NOW()
        WHERE table_id = $1 AND id = $4`,
      [TICKETS_TABLE_ID, prevState, ts, rowId]
    );
  } catch (err) {
    log.warn({ err: err.message, ticket_id: rowId, prevState }, 'restorePriorState failed (non-blocking)');
  }
}

/**
 * ADR-150 P0 — Bump `data.run_last_heartbeat_at` to NOW(). Distinct from
 * `bumpLastEventAt` which writes `run_last_event_at`. The split lets the
 * stall detector tell apart "process is alive" (heartbeat fresh) from
 * "agent is doing meaningful work" (event fresh). Cheap UPDATE, single
 * jsonb_set, fire-and-forget.
 *
 * BUG-FIX (ADR-150 P0): previously this bumped `run_last_event_at`, which
 * masked real stalls because the 15s timer kept the freshness clock fresh
 * even when the agent was completely silent.
 */
export async function bumpHeartbeatAt(rowId) {
  if (!rowId) return;
  try {
    const ts = new Date().toISOString();
    await dbRun(
      `UPDATE table_rows
          SET data = jsonb_set(data, '{run_last_heartbeat_at}', to_jsonb($2::text), true)
        WHERE table_id = $1 AND id = $3`,
      [TICKETS_TABLE_ID, ts, rowId]
    );
  } catch (err) {
    log.warn({ err: err.message, ticket_id: rowId }, 'bumpHeartbeatAt failed (non-blocking)');
  }
}

/**
 * ADR-0042 Task 6 — record the single backstop-warn edge for a live run.
 *
 * Fired by the runner's `onBackstopWarn` callback when wall-clock elapsed
 * crosses `backstop_ms * backstop_warn_ratio` (≈3h with the 4h default).
 * The runner already enforces per-run idempotency via a single-shot timer;
 * this helper is the DB-level idempotency net for callers that may resume
 * a long-lived run across dispatcher restarts. The conditional UPDATE
 * writes only when `data.run_backstop_warned_at` is missing/null, so a
 * second invocation is a no-op.
 *
 * Returns `true` iff the row was actually updated (i.e. this is the FIRST
 * warn for this run). Caller uses the return value to decide whether to
 * append the audit entry — we don't want a `backstop_warn` line per
 * resumed tick.
 *
 * Best-effort: any failure is warned + swallowed.
 */
export async function persistBackstopWarn(rowId, info) {
  if (!rowId || !info || typeof info !== 'object') return false;
  const at = typeof info.at === 'string' && info.at ? info.at : new Date().toISOString();
  try {
    const result = await dbRun(
      `UPDATE table_rows
          SET data = jsonb_set(
                       COALESCE(data, '{}'::jsonb),
                       '{run_backstop_warned_at}',
                       to_jsonb($2::text),
                       true
                     ),
              updated_at = NOW()
        WHERE table_id = $1 AND id = $3
          AND (data->>'run_backstop_warned_at') IS NULL`,
      [TICKETS_TABLE_ID, at, rowId]
    );
    return (result?.changes ?? 0) > 0;
  } catch (err) {
    log.warn({ err: err.message, ticket_id: rowId }, 'persistBackstopWarn failed (non-blocking)');
    return false;
  }
}

/**
 * Bump `data.run_completion_intent_at`. Fired once on the entry edge
 * into `closing` so observers can compute "time since the agent first
 * tried to wrap up" without scanning the audit log.
 */
export async function bumpCompletionIntentAt(rowId) {
  if (!rowId) return;
  try {
    const ts = new Date().toISOString();
    await dbRun(
      `UPDATE table_rows
          SET data = jsonb_set(data, '{run_completion_intent_at}', to_jsonb($2::text), true),
              updated_at = NOW()
        WHERE table_id = $1 AND id = $3`,
      [TICKETS_TABLE_ID, ts, rowId]
    );
  } catch (err) {
    log.warn({ err: err.message, ticket_id: rowId }, 'bumpCompletionIntentAt failed (non-blocking)');
  }
}

// In-memory FSM state per active row. Reset on dispatcher restart — we
// re-read `data.run_liveness_state` lazily on the first event after
// startup. Keyed by ticketId.
const _fsmState = new Map(); // rowId → { state, currentTool }

/**
 * ADR-0042 Task 4 — single entry point invoked from the streaming
 * attach handler for every NDJSON event. Translates the legacy event,
 * runs the FSM, applies side-effects.
 *
 * Pipeline:
 *   1. eventTranslator() → AnthropicEvent | null   (skip if null)
 *   2. Read prev FSM state (from in-mem cache, falling back to row).
 *   3. transition(prev, evt, config) → {state, currentTool, sideEffects}
 *   4. Apply each side effect via persistence helpers.
 *
 * Best-effort: each persistence step is independently try/caught inside
 * its helper. A bug here MUST NOT take the runner down.
 *
 * @param {number|string} rowId
 * @param {object} event — raw legacy NDJSON event from the runner
 * @param {object} [opts]
 * @param {object} [opts.config] — usually the dispatcher's loaded config
 */
export async function onMeaningfulEvent(rowId, event, opts = {}) {
  if (!rowId) return;

  const translated = eventTranslator(event);
  if (!translated) return;  // info / unknown — heartbeat-only via the runner's own onHeartbeat.

  // Pull prev state from in-mem cache. On the first event for a row we
  // seed from the last persisted value (handles dispatcher restart
  // mid-run); on subsequent events we trust the cache. Reads are
  // best-effort — on failure we fall back to INITIAL.
  let prev = _fsmState.get(rowId);
  if (!prev) {
    let dbState = STATES.IDLE;
    let dbTool = null;
    try {
      const row = await dbGet(
        `SELECT data->>'run_liveness_state' AS s,
                data->'run_current_tool'    AS t
           FROM table_rows
          WHERE table_id = $1 AND id = $2`,
        [TICKETS_TABLE_ID, rowId]
      );
      if (row?.s && typeof row.s === 'string') dbState = row.s;
      if (row?.t && typeof row.t === 'object') dbTool = row.t;
    } catch (err) {
      log.debug({ err: err.message, ticket_id: rowId }, 'onMeaningfulEvent: prev state lookup failed');
    }
    prev = { state: dbState, currentTool: dbTool };
  }

  const config = opts.config || cachedConfig || DEFAULT_CONFIG;
  const completionTools = Array.isArray(config?.completion_intent_tools)
    ? config.completion_intent_tools
    : DEFAULT_CONFIG.completion_intent_tools;
  const terminalStates = Array.isArray(config?.completion_intent_terminal_states)
    ? config.completion_intent_terminal_states
    : DEFAULT_CONFIG.completion_intent_terminal_states;

  let next;
  try {
    next = transition(prev, translated, { completionTools, terminalStates });
  } catch (err) {
    log.warn({ err: err.message, ticket_id: rowId }, 'onMeaningfulEvent: transition threw (non-blocking)');
    return;
  }

  // Update in-mem cache eagerly so successive events see the new state
  // even if a persistence write is still in flight.
  _fsmState.set(rowId, { state: next.state, currentTool: next.currentTool });

  const sideEffects = Array.isArray(next.sideEffects) ? next.sideEffects : [];

  // Persist state change FIRST, then heartbeat, so a tail observer never
  // sees a fresh event timestamp paired with the old state.
  if (next.state !== prev.state) {
    await persistStateChange(rowId, next.state);
  }

  // tool started/finished: keep `run_current_tool` in lockstep with FSM.
  if (sideEffects.includes(SIDE_EFFECTS.TOOL_STARTED) && next.currentTool) {
    await persistCurrentTool(rowId, next.currentTool);
  }
  if (sideEffects.includes(SIDE_EFFECTS.TOOL_FINISHED)) {
    await persistCurrentTool(rowId, null);
  }

  // Completion-intent edge: fire bumpCompletionIntentAt once.
  if (sideEffects.includes(SIDE_EFFECTS.BUMP_COMPLETION_INTENT)) {
    await bumpCompletionIntentAt(rowId);
  }

  // stuck_check entry → record baseline. The FSM never enters stuck_check
  // by itself in the meaningful-event path (it's the dispatcher tick that
  // promotes a stale tool_active/thinking into stuck_check); but if a
  // stuck_check transition does happen here, write a baseline blob with
  // prev_state + an initial /proc CPU sample. The dispatcher's
  // `_runStallDetect` will pass this `baseline.cpu` to `classify(pid, ...)`
  // on the next tick to compute a CPU%-delta verdict (ADR-0042 §9 hybrid).
  if (next.state === STATES.STUCK_CHECK && prev.state !== STATES.STUCK_CHECK) {
    let baseline = null;
    const entry = _activeAttempts.get(rowId);
    const pid = entry && Number.isFinite(entry.pid) ? entry.pid : null;
    if (pid) {
      try {
        // First call: pass baseline=null to capture the initial CPU
        // sample. We only care about `proof.cpu` here — the verdict
        // itself is irrelevant on entry (we're recording, not deciding).
        const r = await classifySecondarySignals(pid, null);
        if (r && r.proof && r.proof.cpu) {
          baseline = { cpu: r.proof.cpu };
        }
      } catch (err) {
        // Non-blocking: persist a null baseline if classify failed; the
        // next tick's classify(pid, null) on retry will re-capture.
        log.debug(
          { err: err.message, ticket_id: rowId },
          'stuck_check entry: classify baseline capture failed'
        );
      }
    }
    await persistStuckCheckBaseline(rowId, { baseline, prev_state: prev.state });
  }

  // ADR-150 P0: BUMP_EVENT is a meaningful-event signal — bump the
  // event-freshness clock (not the heartbeat clock).
  if (sideEffects.includes(SIDE_EFFECTS.BUMP_EVENT)) {
    await bumpLastEventAt(rowId);
  }
}

// Test-only accessor for the in-memory FSM cache.
export function _getFsmStateForTest() {
  return _fsmState;
}

/**
 * ADR-0030 Phase 6 — Tick Part A.
 *
 * Find tickets stuck in (preparing, running, streaming) where
 *   now() - run_last_event_at > config.stall_timeout_ms
 * and either retry-enqueue or terminally fail them.
 *
 * `awaiting_approval` is intentionally NOT in STALL_CHECK_RUN_STATES —
 * humans are slow on purpose; the approval gate has its own TTL.
 *
 * Steps per stalled row:
 *   1. SIGTERM/SIGKILL the tracked PID (if any).
 *   2. Best-effort destroyWorkspace.
 *   3. If run_attempt < max_attempts: → retry_after with exponential backoff.
 *      Else: terminal failed + run_terminal_reason='stall'.
 *   4. Audit log entry.
 *   5. Free the _activeAttempts slot.
 *
 * Updates `stats` in place with: stalled, stall_retried, stall_failed.
 * Returns the count of stalled rows handled.
 */
export async function runStallDetect({ source = 'manual', stats = null, config = null } = {}) {
  // Smoke-test affordance: when called directly, ensure config + stats are
  // populated. The internal tick path always passes both.
  if (!config) config = await loadConfig();
  if (!stats) stats = { stalled: 0, stall_retried: 0, stall_failed: 0, errors: 0 };
  return _runStallDetect({ source, stats, config });
}

/**
 * ADR-0042 Task 5 — kill a ticket because its FSM said it's stuck.
 *
 * Mirrors the legacy retry/terminal decision but with a parametrized reason
 * so the smart path can write `stall`, `stuck`, or `stuck_inconclusive`. Also
 * SIGTERMs the tracked PID and best-effort destroys the workspace.
 *
 * Optional `deps` for tests:
 *   - kill         — replacement for killStalledProcess
 *   - destroy      — replacement for destroyWorkspace
 *   - audit        — replacement for appendAuditLog
 *   - dbRunFn      — replacement for dbRun
 *   - activeMap    — replacement for the _activeAttempts Map
 */
async function killTicket(ticketId, {
  prevState,
  attempt,
  reason,            // 'stall' | 'stuck' | 'stuck_inconclusive'
  mode,              // ADR-150 P0: 'smart' | 'legacy' — recorded in audit
  source,
  config,
  stats,
  deps = {},
} = {}) {
  const _kill         = deps.kill         || killStalledProcess;
  const _destroy      = deps.destroy      || destroyWorkspace;
  const _audit        = deps.audit        || appendAuditLog;
  const _dbRun        = deps.dbRunFn      || dbRun;
  const _activeMap    = deps.activeMap    || _activeAttempts;
  const maxAttempts   = Number(config?.max_attempts) || DEFAULT_CONFIG.max_attempts;
  const ticketIdNum   = Number(ticketId);
  const attemptNum    = Number(attempt) || 0;

  // 1. Kill the live process if we tracked it.
  const tracked = _activeMap.get(ticketIdNum);
  if (tracked && tracked.pid) {
    try {
      await _kill(tracked.pid, ticketIdNum);
    } catch (killErr) {
      log.warn({ err: killErr.message, ticket_id: ticketIdNum }, 'stall: killStalledProcess threw (non-blocking)');
    }
  }

  // 2. Cleanup workspace — best-effort.
  try {
    await _destroy(ticketIdNum);
  } catch (wsErr) {
    log.warn({ err: wsErr.message, ticket_id: ticketIdNum }, 'stall: workspace cleanup failed (non-blocking)');
  }

  // 3. Retry vs terminal.
  const now = new Date();
  const ts = now.toISOString();
  let toState;

  if (attemptNum < maxAttempts) {
    const backoffMs = computeBackoff(attemptNum, config);
    const nextAt = new Date(now.getTime() + backoffMs).toISOString();
    toState = 'retry_after';
    try {
      await _dbRun(
        `UPDATE table_rows
            SET data = (data
                        || jsonb_build_object(
                             'run_state', 'retry_after',
                             'run_next_attempt_after', $2::text,
                             'run_last_event_at', $3::text
                           )
                       ) - 'run_stuck_check_baseline' - 'run_liveness_state' - 'run_state_entered_at' - 'run_current_tool',
                updated_at = NOW()
          WHERE table_id = $1 AND id = $4`,
        [TICKETS_TABLE_ID, nextAt, ts, ticketIdNum]
      );
    } catch (err) {
      if (stats) stats.errors = (stats.errors || 0) + 1;
      log.error({ err, ticket_id: ticketIdNum }, 'stall: failed to flip → retry_after');
      return { outcome: 'error' };
    }
    if (stats) stats.stall_retried = (stats.stall_retried || 0) + 1;
    log.info(
      { ticket_id: ticketIdNum, attempt: attemptNum, backoffMs, nextAt, source, reason },
      'stall: enqueued retry'
    );
  } else {
    toState = 'failed';
    try {
      await _dbRun(
        `UPDATE table_rows
            SET data = (data
                        || jsonb_build_object(
                             'run_state', 'failed',
                             'run_terminal_reason', $2::text,
                             'run_finished_at', $3::text,
                             'run_last_event_at', $3::text
                           )
                       ) - 'run_next_attempt_after' - 'run_stuck_check_baseline' - 'run_liveness_state' - 'run_state_entered_at' - 'run_current_tool',
                updated_at = NOW()
          WHERE table_id = $1 AND id = $4`,
        [TICKETS_TABLE_ID, reason, ts, ticketIdNum]
      );
    } catch (err) {
      if (stats) stats.errors = (stats.errors || 0) + 1;
      log.error({ err, ticket_id: ticketIdNum }, 'stall: failed to flip → failed');
      return { outcome: 'error' };
    }
    if (stats) stats.stall_failed = (stats.stall_failed || 0) + 1;
    log.warn(
      { ticket_id: ticketIdNum, attempt: attemptNum, source, reason },
      'stall: max_attempts exhausted — terminal failure'
    );
  }

  // 4. Audit. ADR-150 P0: include `mode` so observers can tell the smart
  // and legacy paths apart in the run history.
  await _audit(ticketIdNum, {
    at: ts,
    from: prevState,
    to: toState,
    attempt: attemptNum,
    reason,
    mode: mode || (config?.smart_liveness_enabled === false ? 'legacy' : 'smart'),
    source: 'tick_part_a',
    tick_source: source,
  });

  // 5. Free slot + clear in-mem FSM cache.
  _activeMap.delete(ticketIdNum);
  _fsmState.delete(ticketIdNum);

  return { outcome: toState };
}

/**
 * ADR-150 P0 §AC5 — legacy conflated-clock stall path.
 *
 * Used when `config.smart_liveness_enabled === false`. Heartbeat and
 * meaningful event share `run_last_event_at`, so the threshold check is
 * effectively a wall-clock cap. Pure-DB filter (no /proc, no FSM): any
 * ticket in (preparing|running|streaming) whose `run_last_event_at` is
 * older than the threshold gets the kill path.
 *
 * Threshold lookup chain (matches the smart path so the same
 * `_workflow_config` row works in both modes):
 *   `meaningful_event_idle_ms` → `stall_timeout_ms` (legacy alias) →
 *   default 600_000.
 *
 * Returns the count of rows handled.
 */
export async function legacyStallKillIfStuck({ source = 'manual', stats, config, deps = {} } = {}) {
  const stallTimeoutMs =
    Number(config?.meaningful_event_idle_ms) ||
    Number(config?.stall_timeout_ms) ||
    DEFAULT_CONFIG.meaningful_event_idle_ms;
  const stallStateList = STALL_CHECK_RUN_STATES.map((s) => `'${s}'`).join(',');
  const _dbAll         = deps.dbAllFn   || dbAll;

  const rows = await _dbAll(
    `
    SELECT id,
           COALESCE((data->>'run_attempt')::int, 0) AS run_attempt,
           data->>'run_state'                       AS run_state,
           (data->>'run_last_event_at')::timestamptz AS last_event_at
      FROM table_rows
     WHERE table_id = $1
       AND data->>'run_state' IN (${stallStateList})
       AND (data->>'run_last_event_at') IS NOT NULL
       AND (data->>'run_last_event_at')::timestamptz < NOW() - ($2::bigint * INTERVAL '1 millisecond')
     ORDER BY id ASC
     FOR UPDATE SKIP LOCKED
    `,
    [TICKETS_TABLE_ID, stallTimeoutMs]
  );

  if (rows.length === 0) return 0;

  log.info({ source, count: rows.length, stallTimeoutMs, mode: 'legacy' },
    'stall_detect (legacy): found stalled tickets');

  for (const row of rows) {
    if (stats) stats.stalled = (stats.stalled || 0) + 1;
    await killTicket(row.id, {
      prevState: row.run_state,
      attempt:   row.run_attempt,
      reason:    'stall',
      mode:      'legacy',
      source,
      config,
      stats,
      deps,
    });
  }
  return rows.length;
}

/**
 * ADR-150 P0 — split-timestamp stall detection tick.
 *
 * The check is a pure-DB filter on two JSONB timestamps:
 *   - `run_last_event_at`         must be older than `meaningful_event_idle_ms`
 *   - `run_completion_intent_at`  must be NULL or older than `closing_grace_ms`
 *
 * The completion-intent grace clause is the key change vs. the legacy path:
 * once the agent has fired `send_chat_message` / `update_ticket_status` →
 * Done / etc., it gets a 90 s window where no kill path can fire even if
 * `run_last_event_at` is technically over the idle threshold. This eliminates
 * the false-positive kill that used to happen during the natural quiet tail
 * of a turn.
 *
 * Threshold lookup chain (matches `legacyStallKillIfStuck` so the same
 * `_workflow_config` row works in both modes):
 *   `meaningful_event_idle_ms` → `stall_timeout_ms` (legacy alias) →
 *   default 600_000.
 *
 * AC8 rollback: `smart_liveness_enabled === false` skips this entirely and
 * delegates to `legacyStallKillIfStuck`.
 *
 * `deps` injection lets tests bypass the real DB / runner registry. Returns
 * the count of rows examined.
 */
async function _runStallDetect({ source, stats, config, deps = {} } = {}) {
  // AC8 — operator can flip back to legacy conflated-clock path. Two
  // escape hatches are wired:
  //   - per-config `smart_liveness_enabled === false` (ADR-150 P0 carry-over)
  //   - env `AGENT_LIVENESS_LEGACY=1` for runtime override without DB write
  if (
    config?.smart_liveness_enabled === false
    || process.env.AGENT_LIVENESS_LEGACY === '1'
  ) {
    return legacyStallKillIfStuck({ source, stats, config, deps });
  }

  const _dbAll         = deps.dbAllFn   || dbAll;
  const _classify      = deps.classify  || classifySecondarySignals;
  const _activeMap     = deps.activeMap || _activeAttempts;
  const _now           = typeof deps.nowMs === 'number' ? deps.nowMs : Date.now();
  const stallStateList = STALL_CHECK_RUN_STATES.map((s) => `'${s}'`).join(',');
  const meaningfulIdleMs =
    Number(config?.meaningful_event_idle_ms) ||
    Number(config?.stall_timeout_ms) ||
    DEFAULT_CONFIG.meaningful_event_idle_ms;
  const closingGraceMs =
    Number(config?.closing_grace_ms) || DEFAULT_CONFIG.closing_grace_ms;
  // ADR-0042 §10 — stuck_check observation window. Resolved through the
  // canonical `effectiveThresholdMs` so an operator override on
  // `stuck_check_window_ms` propagates without code changes.
  const stuckCheckWindowMs = effectiveThresholdMs(
    STATES.STUCK_CHECK, null, config
  );

  // ─── Sweep 1 (ADR-0042 Task 5b) — stuck_check rows with a baseline ──
  // For tickets the FSM has parked in `stuck_check`, the second-opinion
  // gate runs here: re-sample /proc, compare to the captured baseline,
  // and let the verdict drive the kill decision before the meaningful-
  // event idle clock or 4h backstop ever fire.
  //
  // We query separately from the legacy event-idle sweep because the
  // semantics differ: this sweep doesn't care whether `last_event_at` is
  // stale (the FSM has already decided the run is suspect by promoting
  // it into stuck_check); it cares about the verdict + state-window.
  const stuckRows = await _dbAll(
    `
    SELECT id,
           COALESCE((data->>'run_attempt')::int, 0)              AS run_attempt,
           data->>'run_state'                                     AS run_state,
           data->>'run_liveness_state'                            AS liveness_state,
           (data->>'run_state_entered_at')::timestamptz           AS state_entered_at,
           data->'run_stuck_check_baseline'                       AS stuck_check_baseline
      FROM table_rows
     WHERE table_id = $1
       AND data->>'run_state' IN (${stallStateList})
       AND data->>'run_liveness_state' = 'stuck_check'
     ORDER BY id ASC
     FOR UPDATE SKIP LOCKED
    `,
    [TICKETS_TABLE_ID]
  );

  let secondarySignalKills = 0;
  for (const row of stuckRows) {
    const tracked = _activeMap.get(row.id);
    const pid = tracked && Number.isFinite(tracked.pid) ? tracked.pid : null;
    const baseline = row.stuck_check_baseline
      && typeof row.stuck_check_baseline === 'object'
      ? row.stuck_check_baseline.baseline
      : null;
    const baselineCpu = baseline && typeof baseline === 'object' ? baseline.cpu : null;
    if (!pid || !baselineCpu) {
      // Missing pid (ticket re-claimed by another worker?) or missing
      // baseline blob (entry path failed quietly). Fall through to the
      // legacy event-idle sweep — it will eventually catch this row.
      continue;
    }

    let verdict;
    let reasons = [];
    try {
      const result = await _classify(pid, baselineCpu);
      verdict = result?.verdict;
      reasons = Array.isArray(result?.reasons) ? result.reasons : [];
    } catch (err) {
      log.warn(
        { err: err.message, ticket_id: row.id, pid },
        'stall_detect: classify threw — leaving row for next tick'
      );
      continue;
    }

    if (verdict === VERDICT.ALIVE) {
      // FSM will lift the row out of stuck_check on the next meaningful
      // event (`stuck_check is a hold` per state-machine.js). No-op here.
      log.debug(
        { ticket_id: row.id, pid, reasons },
        'stall_detect: stuck_check verdict=alive — keep waiting'
      );
      continue;
    }

    if (verdict === VERDICT.DEAD) {
      if (stats) stats.stalled = (stats.stalled || 0) + 1;
      await killTicket(row.id, {
        prevState: row.run_state,
        attempt:   row.run_attempt,
        reason:    'secondary_signals_dead',
        mode:      'smart',
        source,
        config,
        stats,
        deps,
      });
      log.warn(
        { ticket_id: row.id, pid, reasons },
        'stall_detect: stuck_check verdict=dead — killed'
      );
      secondarySignalKills += 1;
      continue;
    }

    // verdict === INCONCLUSIVE — kill only if the stuck_check window
    // has elapsed. Otherwise let the next tick re-sample (the baseline
    // stays put; classify() will get a fresh delta against it).
    const enteredAtMs = row.state_entered_at
      ? new Date(row.state_entered_at).getTime()
      : null;
    const dwellMs = enteredAtMs ? (_now - enteredAtMs) : null;
    if (dwellMs !== null && dwellMs > stuckCheckWindowMs) {
      if (stats) stats.stalled = (stats.stalled || 0) + 1;
      await killTicket(row.id, {
        prevState: row.run_state,
        attempt:   row.run_attempt,
        reason:    'inconclusive_timeout',
        mode:      'smart',
        source,
        config,
        stats,
        deps,
      });
      log.warn(
        { ticket_id: row.id, pid, dwellMs, stuckCheckWindowMs, reasons },
        'stall_detect: stuck_check inconclusive past window — killed'
      );
      secondarySignalKills += 1;
      continue;
    }

    log.debug(
      { ticket_id: row.id, pid, dwellMs, stuckCheckWindowMs, reasons },
      'stall_detect: stuck_check verdict=inconclusive within window — re-sample next tick'
    );
  }

  // ─── Sweep 2 — meaningful-event idle (legacy ADR-150 P0 path) ──────
  // Catches rows that never made it into stuck_check (FSM never promoted
  // them) but whose meaningful-event clock has nevertheless elapsed.
  // This path remains the safety net and matches pre-Task-5b behavior.
  const rows = await _dbAll(
    `
    SELECT id,
           COALESCE((data->>'run_attempt')::int, 0)             AS run_attempt,
           data->>'run_state'                                    AS run_state,
           (data->>'run_last_event_at')::timestamptz             AS last_event_at,
           (data->>'run_completion_intent_at')::timestamptz      AS completion_intent_at
      FROM table_rows
     WHERE table_id = $1
       AND data->>'run_state' IN (${stallStateList})
       AND (data->>'run_last_event_at') IS NOT NULL
       AND (data->>'run_last_event_at')::timestamptz
           < NOW() - ($2::bigint * INTERVAL '1 millisecond')
       AND (
         (data->>'run_completion_intent_at') IS NULL
         OR (data->>'run_completion_intent_at')::timestamptz
            < NOW() - ($3::bigint * INTERVAL '1 millisecond')
       )
     ORDER BY id ASC
     FOR UPDATE SKIP LOCKED
    `,
    [TICKETS_TABLE_ID, meaningfulIdleMs, closingGraceMs]
  );

  if (rows.length === 0) return secondarySignalKills;

  log.info(
    { source, count: rows.length, meaningfulIdleMs, closingGraceMs, mode: 'smart' },
    'stall_detect (smart): found stalled tickets'
  );

  for (const row of rows) {
    if (stats) stats.stalled = (stats.stalled || 0) + 1;
    await killTicket(row.id, {
      prevState: row.run_state,
      attempt:   row.run_attempt,
      reason:    'stall',
      mode:      'smart',
      source,
      config,
      stats,
      deps,
    });
  }
  return rows.length + secondarySignalKills;
}

// Test-only export: lets the table-driven test drive the tick with mocked
// classify/dbAll/activeMap/now without monkey-patching the live module.
export const _runStallDetectImpl = (opts) => _runStallDetect(opts);

/**
 * Atomically claim up to `limit` tickets ready for a run.
 *
 * Strategy: PostgreSQL `FOR UPDATE SKIP LOCKED` on table_rows row-locks,
 * combined with a JSONB-merge UPDATE that flips run_state to 'preparing'
 * and bumps run_attempt. Two concurrent dispatchers will never claim the
 * same row — the second sees `SKIP LOCKED` and moves on.
 *
 * Filter:
 *   - table_id = TICKETS_TABLE_ID
 *   - run_state IS NULL OR IN CLAIMABLE_RUN_STATES
 *   - assigned_to IS NOT NULL AND assigned_to != ''
 *   - state NOT IN terminal states (don't claim closed tickets)
 *   - run_next_attempt_after IS NULL OR <= now() (retry backoff respect)
 *
 * Returns: claimed rows with id, agent_id, prev_run_state, new run_attempt.
 */
async function claimReady(limit) {
  if (limit <= 0) return [];

  const terminalList = TICKET_TERMINAL_STATES.map(s => `'${s}'`).join(',');
  const claimableList = CLAIMABLE_RUN_STATES.map(s => `'${s}'`).join(',');

  // The CTE selects + locks candidate rows; the UPDATE then flips them.
  // Doing it in one statement keeps the lock window minimal.
  //
  // Tickets must explicitly opt into the run loop by setting
  // run_state='idle' (or queued/retry_after). NULL run_state means
  // "not enrolled" and is intentionally excluded — most pre-P1 tickets
  // have no run_state field and must not be auto-claimed.
  const sql = `
    WITH candidate AS (
      SELECT id
        FROM table_rows
       WHERE table_id = $1
         AND data->>'run_state' IN (${claimableList})
         AND COALESCE(NULLIF(data->>'assigned_to', ''), NULL) IS NOT NULL
         AND COALESCE(data->>'state', '') NOT IN (${terminalList})
         AND (
              data->>'run_next_attempt_after' IS NULL
              OR (data->>'run_next_attempt_after')::timestamptz <= NOW()
             )
       ORDER BY created_at ASC, id ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
    )
    UPDATE table_rows tr
       SET data = tr.data
                  || jsonb_build_object(
                       'run_state', 'preparing',
                       'run_started_at', COALESCE(tr.data->>'run_started_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
                       'run_last_event_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'run_attempt', COALESCE((tr.data->>'run_attempt')::int, 0) + 1
                     ),
           updated_at = NOW()
      FROM candidate c
     WHERE tr.id = c.id
     RETURNING tr.id,
               tr.data->>'assigned_to'  AS assigned_to,
               (tr.data->>'run_attempt')::int AS run_attempt
  `;
  return await dbAll(sql, [TICKETS_TABLE_ID, limit]);
}

/**
 * Dry-run terminal: flip preparing → canceled with phase2_dryrun reason.
 * Phase 3 retains this for `RUN_DISPATCHER_PHASE='dryrun'` (default) and
 * for rollback. Phase 4 will replace the workspace path with handler spawn.
 */
async function dryRunCancel(ticketId) {
  const ts = new Date().toISOString();
  await dbRun(
    `UPDATE table_rows
        SET data = data
                   || jsonb_build_object(
                        'run_state', 'canceled',
                        'run_terminal_reason', 'phase2_dryrun',
                        'run_finished_at', $2::text,
                        'run_last_event_at', $2::text
                      ),
            updated_at = NOW()
      WHERE table_id = $1 AND id = $3`,
    [TICKETS_TABLE_ID, ts, ticketId]
  );
}

/**
 * Phase 3 terminal: workspace was materialized, store its path, then flip
 * preparing → canceled with phase3_workspace_only reason. The cancel keeps
 * the loop terminating cleanly until Phase 4 wires the claude CLI.
 */
async function phase3WorkspaceOnlyCancel(ticketId, workspacePath) {
  const ts = new Date().toISOString();
  await dbRun(
    `UPDATE table_rows
        SET data = data
                   || jsonb_build_object(
                        'run_state', 'canceled',
                        'run_terminal_reason', 'phase3_workspace_only',
                        'run_workspace_path', $4::text,
                        'run_finished_at', $2::text,
                        'run_last_event_at', $2::text
                      ),
            updated_at = NOW()
      WHERE table_id = $1 AND id = $3`,
    [TICKETS_TABLE_ID, ts, ticketId, workspacePath]
  );
}

/**
 * Phase 4 helpers.
 *
 * Flip preparing → running. We don't carry prev state back from RETURNING
 * in claimReady, so we always set 'running' unconditionally — concurrency
 * is already protected by the row-level lock.
 */
async function transitionToRunning(ticketId) {
  const ts = new Date().toISOString();
  await dbRun(
    `UPDATE table_rows
        SET data = data
                   || jsonb_build_object(
                        'run_state', 'running',
                        'run_last_event_at', $2::text
                      ),
            updated_at = NOW()
      WHERE table_id = $1 AND id = $3`,
    [TICKETS_TABLE_ID, ts, ticketId]
  );
}

/**
 * ADR-150 P0 — bump `run_last_event_at`. Fires for every meaningful NDJSON
 * event the runner emits; this is the freshness signal stall detection
 * actually reads. Cheap UPDATE: single jsonb_set, fire-and-forget.
 */
export async function bumpLastEventAt(ticketId) {
  if (!ticketId) return;
  const ts = new Date().toISOString();
  try {
    await dbRun(
      `UPDATE table_rows
          SET data = jsonb_set(data, '{run_last_event_at}', to_jsonb($2::text), true)
        WHERE table_id = $1 AND id = $3`,
      [TICKETS_TABLE_ID, ts, ticketId]
    );
  } catch (err) {
    log.warn({ err: err.message, ticket_id: ticketId }, 'bumpLastEventAt failed (non-blocking)');
  }
}

/**
 * Apply terminal Phase 4 transition based on stream handler summary.
 * Does NOT touch ticket `state` — only run_* columns. The ticket's
 * lifecycle stays under the human's control.
 */
async function applyRunTerminal(ticketId, summary) {
  const ts = new Date().toISOString();
  let runState;
  let terminalReason;
  if (summary.finalStatus === 'success') {
    runState = 'succeeded';
    terminalReason = 'completed';
  } else if (summary.finalStatus === 'timeout') {
    runState = 'failed';
    // ADR-150 P0: stream handler now emits terminalReason='backstop' on
    // wall-clock kill. Honor it; otherwise keep the historical 'timeout'.
    terminalReason = summary.terminalReason || 'timeout';
  } else {
    runState = 'failed';
    terminalReason = summary.terminalReason || 'runner_failed';
  }
  const updates = {
    run_state: runState,
    run_terminal_reason: terminalReason,
    run_finished_at: ts,
    run_last_event_at: ts,
    run_duration_ms: summary.durationMs,
    run_event_count: summary.eventCount,
  };
  if (summary.lastError) {
    // Truncate to 500 chars per brief.
    updates.run_terminal_error = String(summary.lastError).slice(-500);
  }
  if (summary.exitCode != null) {
    updates.run_exit_code = summary.exitCode;
  }
  await dbRun(
    `UPDATE table_rows
        SET data = data || $2::jsonb,
            updated_at = NOW()
      WHERE table_id = $1 AND id = $3`,
    [TICKETS_TABLE_ID, JSON.stringify(updates), ticketId]
  );
}

/**
 * Resolve the conversation_id bound to a given ticket. Returns null if no
 * conversation is attached — caller should silently skip the chat post.
 *
 * Two strategies, in order:
 *   1. ticket.data.chat_conversation_id (explicit denorm — preferred).
 *   2. SELECT id FROM conversations WHERE bound_table_id=1708 AND bound_row_id=<ticketId>
 *      ORDER BY id ASC LIMIT 1 (fallback — works for tickets that had a
 *      chat created via the standard binding path).
 */
async function findTicketConversationId(ticketId, ticketRow) {
  const explicit = ticketRow?.chat_conversation_id;
  if (explicit) {
    const n = Number(explicit);
    if (Number.isInteger(n) && n > 0) return n;
  }
  try {
    const row = await dbGet(
      `SELECT id FROM conversations
        WHERE bound_table_id = $1 AND bound_row_id = $2
        ORDER BY id ASC LIMIT 1`,
      [TICKETS_TABLE_ID, ticketId]
    );
    if (row?.id) return Number(row.id);
  } catch (err) {
    log.debug({ err: err.message, ticket_id: ticketId }, 'conversation lookup failed');
  }
  return null;
}

/**
 * Post a system-style approval message to the ticket's chat. Sender is
 * 'system'/null user. Returns true if posted, false if no conversation.
 *
 * IMPORTANT: caller passes plaintext code — this function sends it once
 * to the chat (the only acceptable destination) and never persists or
 * logs it elsewhere. The redaction marker `[approval-code]` lets a future
 * hook scrub it from chat history if needed.
 */
async function postApprovalCodeToChat({ ticketId, ticketRow, code, expiresAt }) {
  const conversationId = await findTicketConversationId(ticketId, ticketRow);
  if (!conversationId) {
    log.warn(
      { ticket_id: ticketId },
      'no conversation bound to ticket — approval code cannot be posted to chat'
    );
    return false;
  }
  const expiresMin = Math.round(APPROVAL_CONSTANTS.TTL_MS / 60_000);
  const content =
    `🔐 Approval required for run on ticket T-${ticketId}.\n\n` +
    `[approval-code]\`${code}\`[/approval-code]\n\n` +
    `Expires in ${expiresMin} min. Submit:\n` +
    `\`POST /api/v3/admin/agent-run-dispatcher/approve/${ticketId}\` ` +
    `with body \`{"code":"${code}"}\`. ` +
    `Expires at ${expiresAt}.`;
  try {
    await dbRun(
      `INSERT INTO messages
         (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, created_at, updated_at)
       VALUES ($1, NULL, 'system', 'system', $2, 'markdown', NULL, NOW(), NOW())`,
      [conversationId, content]
    );
    log.info(
      { ticket_id: ticketId, conversation_id: conversationId, code: '<redacted>' },
      'approval code posted to chat'
    );
    return true;
  } catch (err) {
    log.warn(
      { err: err.message, ticket_id: ticketId },
      'failed to post approval code to chat'
    );
    return false;
  }
}

/**
 * Post the agent's text output as a single message into the ticket chat.
 * Best-effort — never throws to caller. If conversation doesn't exist, log
 * + skip (per Phase 4 brief: must not crash on missing chat).
 */
async function postRunOutputToChat({ ticketId, ticketRow, agentId, content }) {
  if (!content || !String(content).trim()) {
    log.debug({ ticket_id: ticketId }, 'no content to post to chat — skipping');
    return;
  }
  const conversationId = await findTicketConversationId(ticketId, ticketRow);
  if (!conversationId) {
    log.warn({ ticket_id: ticketId }, 'no conversation bound to ticket — skipping chat post');
    return;
  }
  try {
    await dbRun(
      `INSERT INTO messages
         (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, created_at, updated_at)
       VALUES ($1, NULL, 'agent', 'assistant', $2, 'markdown', $3, NOW(), NOW())`,
      [conversationId, String(content), agentId != null ? Number(agentId) || null : null]
    );
    log.info({ ticket_id: ticketId, conversation_id: conversationId, content_len: content.length }, 'posted run output to chat');
  } catch (err) {
    log.warn({ err: err.message, ticket_id: ticketId }, 'failed to post run output to chat (non-blocking)');
  }
}

/**
 * Phase 4 live execution path. Runs a single ticket end-to-end:
 *   createWorkspace → preparing→running → buildPrompt → runStreamHandler →
 *   apply terminal → post chat → destroyWorkspace.
 *
 * Always destroys workspace + decrements active map in finally so a crash
 * never leaks state. Returns one of: 'succeeded', 'failed', 'timeout',
 * 'workspace_create_failed'.
 */
async function processLive({ row, source, stats }) {
  let ws = null;
  let outputContent = '';
  let agentId = row.assigned_to;
  try {
    // 1. Workspace.
    ws = await createWorkspace(row.id);
    stats.workspaces_created++;
    _activeAttempts.set(row.id, {
      agent_id: agentId,
      claimedAt: Date.now(),
      workspacePath: ws.path,
    });
    log.info(
      { ticket_id: row.id, workspace_path: ws.path, branch: ws.branch, reused: !!ws.reused },
      'phase4: workspace materialized'
    );

    // Persist workspace path on the ticket so observers can see it.
    await dbRun(
      `UPDATE table_rows
          SET data = jsonb_set(data, '{run_workspace_path}', to_jsonb($2::text), true),
              updated_at = NOW()
        WHERE table_id = $1 AND id = $3`,
      [TICKETS_TABLE_ID, ws.path, row.id]
    );

    // 2. Build prompt.
    const { prompt, ticketRow } = await buildRunPrompt({
      ticketId: row.id,
      agentId,
    });

    // 2.5 Approval gate (Phase 5). Default ON in 'live' phase. Blocks here
    // until human approves via POST /admin/agent-run-dispatcher/approve/:id
    // (or hits 10-min TTL / 5 wrong attempts). Skipped entirely when
    // RUN_REQUIRE_APPROVAL=false (smoke tests + opt-out).
    if (RUN_REQUIRE_APPROVAL) {
      const { code, code_hash, expires_at, generated_at } = generateApprovalCode();
      await persistApprovalRequest(row.id, { code_hash, expires_at, generated_at });
      stats.awaiting_approval++;
      await appendAuditLog(row.id, {
        at: new Date().toISOString(),
        from: 'preparing',
        to: 'awaiting_approval',
        attempt: row.run_attempt,
        reason: 'approval_required',
        source,
        expires_at,
        // code/code_hash intentionally omitted — never logged.
      });
      // Post the code to chat. The plaintext `code` lives only in this
      // local frame; we drop the reference immediately after.
      await postApprovalCodeToChat({
        ticketId: row.id,
        ticketRow,
        code,
        expiresAt: expires_at,
      });

      const { outcome, attempts } = await awaitApproval(row.id);
      if (outcome === APPROVAL_OUTCOMES.APPROVED) {
        stats.approval_approved++;
        await appendAuditLog(row.id, {
          at: new Date().toISOString(),
          from: 'awaiting_approval',
          to: 'preparing',
          attempt: row.run_attempt,
          reason: 'approval_granted',
          source,
          attempts,
        });
        // resolveApproval already flipped run_state to 'preparing'.
      } else {
        // denied or expired: terminal failure, skip runStreamHandler.
        const terminalReason = outcome === APPROVAL_OUTCOMES.DENIED
          ? 'approval_denied'
          : 'approval_timeout';
        stats[outcome === APPROVAL_OUTCOMES.DENIED ? 'approval_denied' : 'approval_expired']++;
        await applyRunTerminal(row.id, {
          finalStatus: 'failed',
          durationMs: 0,
          eventCount: 0,
          exitCode: null,
          lastError: terminalReason,
        });
        // applyRunTerminal sets run_terminal_reason='runner_failed' for
        // generic failed → patch it to the approval-specific reason.
        await dbRun(
          `UPDATE table_rows
              SET data = jsonb_set(data, '{run_terminal_reason}', to_jsonb($2::text), true),
                  updated_at = NOW()
            WHERE table_id = $1 AND id = $3`,
          [TICKETS_TABLE_ID, terminalReason, row.id]
        );
        await appendAuditLog(row.id, {
          at: new Date().toISOString(),
          from: 'awaiting_approval',
          to: 'failed',
          attempt: row.run_attempt,
          reason: terminalReason,
          source,
          attempts,
        });
        stats.live_failed++;
        return 'failed';
      }
    }

    // 3. preparing → running.
    await transitionToRunning(row.id);
    await appendAuditLog(row.id, {
      at: new Date().toISOString(),
      from: 'preparing',
      to: 'running',
      attempt: row.run_attempt,
      reason: 'live_run_started',
      source,
      workspace_path: ws.path,
    });

    // 4. Stream handler. ADR-150 P0 wiring:
    //    - onEvent           → capture output, audit (and FSM tracker for
    //                          observability — does not drive stall detection
    //                          anymore).
    //    - onMeaningfulEvent → bumpLastEventAt + (if completion-intent)
    //                          bumpCompletionIntentAt. This is the freshness
    //                          signal stall detection actually reads.
    //    - onHeartbeat       → bumpHeartbeatAt (writes run_last_heartbeat_at).
    //                          When smart_liveness is OFF, ALSO bumps
    //                          run_last_event_at (legacy conflated mode).
    //    - backstopMs        → 4h smart, 30 min legacy.
    let lastAuditAt = 0;
    warnLegacyOnce();
    const config = await loadConfig();
    const smartLivenessEnabled = config?.smart_liveness_enabled !== false;
    const terminalStates = Array.isArray(config?.completion_intent_terminal_states)
      ? config.completion_intent_terminal_states
      : DEFAULT_CONFIG.completion_intent_terminal_states;
    const closingTools = Array.isArray(config?.completion_intent_tools)
      ? config.completion_intent_tools
      : DEFAULT_CONFIG.completion_intent_tools;
    const backstopMs = smartLivenessEnabled
      ? (Number(config?.runner_backstop_ms) || DEFAULT_CONFIG.runner_backstop_ms)
      : 30 * 60 * 1000;  // legacy conflated mode reverts to 30-min cap (AC5)
    // ADR-0042 Task 6 — pass-through of the warn ratio. Out-of-range values
    // are sanitized inside `runStreamHandler`; we just forward the config
    // value verbatim and let the runner fall back to DEFAULT_BACKSTOP_WARN_RATIO.
    const backstopWarnRatio = Number(config?.backstop_warn_ratio)
      || DEFAULT_CONFIG.backstop_warn_ratio;

    const summary = await runStreamHandler({
      ticketId: row.id,
      workspacePath: ws.path,
      prompt,
      agentId,
      backstopMs,
      backstopWarnRatio,
      onSpawn: ({ pid }) => {
        // Phase 6: record the PID so a future tick's stall detector can
        // signal it. The same _activeAttempts entry was set above; we
        // mutate in place so concurrent reads stay consistent.
        const entry = _activeAttempts.get(row.id);
        if (entry) entry.pid = pid;
      },
      onEvent: (evt) => {
        // Capture model output content for chat posting.
        if (evt && evt.type === 'output' && typeof evt.content === 'string') {
          outputContent = evt.content;
        }
        // FSM tracker — observability only; stall path no longer reads
        // run_liveness_state under ADR-150 P0. Fire-and-forget.
        onMeaningfulEvent(row.id, evt).catch((err) => {
          log.debug({ err: err.message, ticket_id: row.id }, 'onMeaningfulEvent threw');
        });
        // Audit rate limit — at most 1 entry per AUDIT_RATE_LIMIT_MS per ticket.
        const now = Date.now();
        if (now - lastAuditAt >= AUDIT_RATE_LIMIT_MS) {
          lastAuditAt = now;
          appendAuditLog(row.id, {
            at: new Date().toISOString(),
            event_type: evt?.type || 'unknown',
            event_message: typeof evt?.message === 'string' ? evt.message.slice(0, 200) : undefined,
            source: 'stream_event',
          }).catch(() => {});
        }
      },
      onMeaningfulEvent: (evt) => {
        // ADR-150 P0: bump the meaningful-event freshness clock. This is
        // the ONLY place run_last_event_at moves during a live run.
        bumpLastEventAt(row.id).catch(() => {});
        // Completion-intent edge: stamp run_completion_intent_at so the
        // stall tick's grace clause can shield the closing window.
        if (evtIsCompletionIntent(evt, { closingTools, terminalStates })) {
          bumpCompletionIntentAt(row.id).catch(() => {});
        }
      },
      onHeartbeat: () => {
        // ADR-150 P0: heartbeat writes ONLY run_last_heartbeat_at. The
        // 15s timer must NOT keep run_last_event_at fresh — that was the
        // bug that masked real stalls.
        bumpHeartbeatAt(row.id).catch(() => {});
        if (!smartLivenessEnabled) {
          // Legacy conflated mode: heartbeat ALSO bumps run_last_event_at
          // so the legacy threshold check has the same shape it always did.
          bumpLastEventAt(row.id).catch(() => {});
        }
      },
      onBackstopWarn: (warn) => {
        // ADR-0042 Task 6 — single audit edge ~3h before the 4h backstop.
        // `persistBackstopWarn` returns true only when the conditional
        // UPDATE actually flipped the row (DB-level idempotency); on a
        // resumed run where the flag is already set, we skip the audit.
        persistBackstopWarn(row.id, warn)
          .then((firstWarn) => {
            if (!firstWarn) return;
            return appendAuditLog(row.id, {
              at: warn.at,
              event_type: 'backstop_warn',
              elapsed_ms: warn.elapsedMs,
              ratio: warn.ratio,
              threshold_ms: warn.thresholdMs,
              backstop_ms: warn.backstopMs,
              source: 'run_stream_handler',
            });
          })
          .catch(() => {});
      },
    });

    // 5. Terminal transition.
    await applyRunTerminal(row.id, summary);
    await appendAuditLog(row.id, {
      at: new Date().toISOString(),
      from: 'running',
      to: summary.finalStatus === 'success' ? 'succeeded' : 'failed',
      attempt: row.run_attempt,
      reason: summary.finalStatus === 'success' ? 'completed'
            : summary.finalStatus === 'timeout' ? 'timeout'
            : 'runner_failed',
      source,
      duration_ms: summary.durationMs,
      event_count: summary.eventCount,
      exit_code: summary.exitCode,
    });

    // 6. Chat post (success only — failures don't get posted to user-facing
    // chat; they live in the audit log + run_terminal_error).
    if (summary.finalStatus === 'success' && outputContent) {
      await postRunOutputToChat({
        ticketId: row.id,
        ticketRow,
        agentId,
        content: outputContent,
      });
    }

    if (summary.finalStatus === 'success') stats.live_succeeded++;
    else if (summary.finalStatus === 'timeout') stats.live_timeout++;
    else stats.live_failed++;

    return summary.finalStatus;
  } catch (err) {
    stats.errors++;
    log.error({ err, ticket_id: row.id }, 'phase4: processLive failed — flipping to failed');
    try {
      await applyRunTerminal(row.id, {
        finalStatus: 'failed',
        durationMs: 0,
        eventCount: 0,
        exitCode: null,
        lastError: err.message || String(err),
      });
      await appendAuditLog(row.id, {
        at: new Date().toISOString(),
        from: 'preparing',
        to: 'failed',
        attempt: row.run_attempt,
        reason: 'live_path_exception',
        source,
        error: err.message,
      });
    } catch (innerErr) {
      log.error({ err: innerErr, ticket_id: row.id }, 'phase4: failed to record terminal failure');
    }
    stats.live_failed++;
    return 'failed';
  } finally {
    // Always cleanup workspace + active map, even on failure paths.
    if (ws) {
      try {
        await destroyWorkspace(row.id);
      } catch (cleanupErr) {
        log.warn({ err: cleanupErr.message, ticket_id: row.id }, 'phase4: workspace cleanup failed');
      }
    }
    _activeAttempts.delete(row.id);
    _fsmState.delete(row.id);
  }
}

/**
 * One full tick. Safe to call manually from admin route.
 */
export async function runTick({ source = 'interval' } = {}) {
  if (isTicking) {
    log.debug({ source }, 'tick already in progress; skipping');
    return { skipped: true, reason: 'already_ticking' };
  }
  isTicking = true;
  const startedAt = Date.now();
  const stats = {
    picked: 0,
    transitioned: 0,
    canceled_dryrun: 0,
    canceled_workspace_only: 0,
    workspaces_created: 0,
    live_succeeded: 0,
    live_failed: 0,
    live_timeout: 0,
    awaiting_approval: 0,
    approval_approved: 0,
    approval_denied: 0,
    approval_expired: 0,
    // Phase 6 stall detection counters.
    stalled: 0,
    stall_retried: 0,
    stall_failed: 0,
    errors: 0,
    paused: false,
  };

  try {
    const config = await loadConfig();

    // Update poll interval if config changed (will take effect next tick).
    if (typeof config.poll_interval_ms === 'number' && config.poll_interval_ms !== currentPollIntervalMs) {
      log.info(
        { old_ms: currentPollIntervalMs, new_ms: config.poll_interval_ms },
        'poll_interval_ms changed — re-arming interval'
      );
      currentPollIntervalMs = config.poll_interval_ms;
      _rearmInterval();
    }

    if (config.paused === true) {
      stats.paused = true;
      log.debug({ source }, 'config.paused=true — skipping tick');
      return { ...stats, duration_ms: Date.now() - startedAt };
    }

    // ─── Part A: stall detection (Phase 6) ─────────────────────
    // Find tickets stuck in (preparing|running|streaming) past
    // stall_timeout_ms with no recent run_last_event_at, kill any tracked
    // PID, retry with exponential backoff, or terminally fail when
    // attempts are exhausted. awaiting_approval is excluded by design.
    try {
      await _runStallDetect({ source, stats, config });
    } catch (err) {
      stats.errors++;
      log.error({ err }, 'tick: stall_detect failed');
    }

    // ─── Part B: claim ready work ──────────────────────────────
    const headroom = Math.max(0, (config.max_concurrent_runs || 3) - _activeAttempts.size);
    if (headroom === 0) {
      log.debug({ active: _activeAttempts.size }, 'no headroom — skipping claim');
      return { ...stats, duration_ms: Date.now() - startedAt };
    }

    const claimed = await claimReady(headroom);
    stats.picked = claimed.length;

    for (const row of claimed) {
      try {
        // Audit: idle/queued/retry_after → preparing
        await appendAuditLog(row.id, {
          at: new Date().toISOString(),
          from: '<previous>',  // we don't carry it back from RETURNING; cheap to omit
          to: 'preparing',
          attempt: row.run_attempt,
          reason: 'claimed_by_dispatcher',
          source,
        });
        stats.transitioned++;

        if (RUN_DISPATCHER_PHASE === 'live') {
          // Phase 4: full pipeline — workspace + prompt + claude + chat post.
          // processLive owns its own audit + cleanup; we just await it here.
          await processLive({ row, source, stats });
          continue;
        }

        if (RUN_DISPATCHER_PHASE === 'workspace_only') {
          // Phase 3: materialize git worktree, store path, then cancel.
          let ws;
          try {
            ws = await createWorkspace(row.id);
            stats.workspaces_created++;
            // Track in active map so shutdown() can clean it up.
            _activeAttempts.set(row.id, {
              agent_id: row.assigned_to,
              claimedAt: Date.now(),
              workspacePath: ws.path,
            });
            log.info(
              { ticket_id: row.id, workspace_path: ws.path, branch: ws.branch, reused: !!ws.reused },
              'phase3: workspace materialized'
            );
          } catch (wsErr) {
            stats.errors++;
            log.error({ err: wsErr, ticket_id: row.id }, 'phase3: workspace creation failed — falling back to dryrun cancel');
            await dryRunCancel(row.id);
            await appendAuditLog(row.id, {
              at: new Date().toISOString(),
              from: 'preparing',
              to: 'canceled',
              attempt: row.run_attempt,
              reason: 'workspace_create_failed',
              source,
              error: wsErr.message,
            });
            stats.canceled_dryrun++;
            continue;
          }

          await phase3WorkspaceOnlyCancel(row.id, ws.path);
          await appendAuditLog(row.id, {
            at: new Date().toISOString(),
            from: 'preparing',
            to: 'canceled',
            attempt: row.run_attempt,
            reason: 'phase3_workspace_only',
            source,
            workspace_path: ws.path,
            branch: ws.branch,
          });
          stats.canceled_workspace_only++;
          // Workspace is intentionally LEFT on disk for inspection/debug.
          // Phase 4 will own its lifecycle (destroy after handler exits).
          // shutdown() still cleans up _activeAttempts entries on graceful stop.
        } else {
          // Phase 2 dry-run: immediately cancel (default).
          await dryRunCancel(row.id);
          await appendAuditLog(row.id, {
            at: new Date().toISOString(),
            from: 'preparing',
            to: 'canceled',
            attempt: row.run_attempt,
            reason: 'phase2_dryrun',
            source,
          });
          stats.canceled_dryrun++;
        }
      } catch (err) {
        stats.errors++;
        log.error({ err, ticket_id: row.id }, 'tick: error processing claimed ticket');
      }
    }
  } catch (err) {
    stats.errors++;
    log.error({ err }, 'tick: unhandled error');
  } finally {
    isTicking = false;
  }

  const duration_ms = Date.now() - startedAt;
  if (stats.picked > 0 || stats.errors > 0) {
    log.info({ ...stats, duration_ms, source }, 'agent_run_dispatcher tick complete');
  } else {
    log.debug({ ...stats, duration_ms, source }, 'agent_run_dispatcher tick (idle)');
  }
  return { ...stats, duration_ms };
}

function _rearmInterval() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = setInterval(() => {
      runTick({ source: 'interval' }).catch((err) => log.error({ err }, 'periodic tick failed'));
    }, currentPollIntervalMs);
    intervalHandle.unref?.();
  }
}

// ─── Module Lifecycle ──────────────────────────────────────────

export async function init() {
  if (intervalHandle) return health();

  if (process.env.AGENT_RUN_DISPATCHER_ENABLED !== 'true') {
    log.info(
      { flag: 'AGENT_RUN_DISPATCHER_ENABLED', value: process.env.AGENT_RUN_DISPATCHER_ENABLED || '<unset>' },
      'agent_run_dispatcher disabled by feature flag — not starting'
    );
    return { ok: false, running: false, disabled: true };
  }

  // Pre-load config so the first tick uses real poll_interval_ms.
  await loadConfig({ force: true });
  currentPollIntervalMs = cachedConfig?.poll_interval_ms || FALLBACK_POLL_INTERVAL_MS;

  log.info(
    { intervalMs: currentPollIntervalMs, firstDelayMs: FIRST_TICK_DELAY_MS, phase: RUN_DISPATCHER_PHASE },
    `starting agent_run_dispatcher (RUN_DISPATCHER_PHASE=${RUN_DISPATCHER_PHASE})`
  );

  // ADR-150 P0: log resolved values of the four smart-liveness knobs once
  // at boot so operators can confirm the active configuration without
  // tailing per-tick output.
  log.info(
    {
      smart_liveness_enabled:
        cachedConfig?.smart_liveness_enabled !== false,
      meaningful_event_idle_ms:
        Number(cachedConfig?.meaningful_event_idle_ms)
        || Number(cachedConfig?.stall_timeout_ms)
        || DEFAULT_CONFIG.meaningful_event_idle_ms,
      closing_grace_ms:
        Number(cachedConfig?.closing_grace_ms) || DEFAULT_CONFIG.closing_grace_ms,
      runner_backstop_ms:
        Number(cachedConfig?.runner_backstop_ms) || DEFAULT_CONFIG.runner_backstop_ms,
    },
    'agent_run_dispatcher: ADR-150 P0 smart-liveness knobs (resolved)'
  );

  firstTickTimer = setTimeout(() => {
    runTick({ source: 'first_tick' }).catch((err) => log.error({ err }, 'first tick failed'));
  }, FIRST_TICK_DELAY_MS);

  intervalHandle = setInterval(() => {
    runTick({ source: 'interval' }).catch((err) => log.error({ err }, 'periodic tick failed'));
  }, currentPollIntervalMs);

  intervalHandle.unref?.();
  firstTickTimer.unref?.();

  return health();
}

export async function shutdown() {
  if (firstTickTimer) {
    clearTimeout(firstTickTimer);
    firstTickTimer = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('agent_run_dispatcher stopped');
  }

  // Phase 3: clean up any worktrees we still consider "active" so we don't
  // leak orphaned dirs across restarts. Use Promise.allSettled — one
  // failure mustn't block the rest.
  if (_activeAttempts.size > 0) {
    const ticketIds = Array.from(_activeAttempts.keys());
    log.info({ count: ticketIds.length }, 'shutdown: cleaning up active workspaces');
    const results = await Promise.allSettled(
      ticketIds.map((id) => destroyWorkspace(id))
    );
    let cleaned = 0;
    let failed = 0;
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') cleaned++;
      else {
        failed++;
        log.warn({ ticket_id: ticketIds[idx], err: r.reason?.message }, 'shutdown: workspace cleanup failed');
      }
    });
    _activeAttempts.clear();
    log.info({ cleaned, failed }, 'shutdown: workspace cleanup complete');
  }
}

export function health() {
  // In Phase 4 every entry in _activeAttempts represents a live runner
  // currently executing (we delete on terminal). For dryrun/workspace_only
  // phases the count is a no-op signal.
  const liveAttemptsCount = RUN_DISPATCHER_PHASE === 'live' ? _activeAttempts.size : 0;
  // Phase 5: count tickets currently in awaiting_approval. Best-effort:
  // failures fall back to undefined so health endpoint never crashes.
  let awaitingApprovalCount;
  return {
    ok: !!intervalHandle,
    running: !!intervalHandle,
    isTicking,
    intervalMs: currentPollIntervalMs,
    activeAttempts: _activeAttempts.size,
    liveAttemptsCount,
    awaitingApprovalCount, // Filled async via _awaitingApprovalCount when polled; sync default undefined.
    phase: RUN_DISPATCHER_PHASE,
    requireApproval: RUN_REQUIRE_APPROVAL,
    config: cachedConfig
      ? {
          poll_interval_ms: cachedConfig.poll_interval_ms,
          max_concurrent_runs: cachedConfig.max_concurrent_runs,
          paused: cachedConfig.paused,
        }
      : null,
  };
}

/**
 * Async health flavor — adds awaitingApprovalCount. Use from admin /health
 * route when you want the live count. Sync `health()` stays cheap.
 */
export async function healthAsync() {
  const base = health();
  try {
    const row = await dbGet(
      `SELECT COUNT(*)::int AS n
         FROM table_rows
        WHERE table_id = $1 AND data->>'run_state' = 'awaiting_approval'`,
      [TICKETS_TABLE_ID]
    );
    base.awaitingApprovalCount = Number(row?.n) || 0;
  } catch (err) {
    log.debug({ err: err.message }, 'healthAsync: awaitingApprovalCount lookup failed');
    base.awaitingApprovalCount = null;
  }
  return base;
}

// Phase 6 smoke-test affordance: expose the in-memory active-attempts map
// so tests can inject a PID for the SIGTERM/SIGKILL code path. Production
// code MUST NOT mutate this directly; `processLive` owns it.
export function _getActiveAttemptsForTest() {
  return _activeAttempts;
}

// ─── T-148528 (WP-B) — user-initiated abort ──────────────────
//
// The /stop button in chat lands here (via streamController). The legacy
// `cancelJob(jobId)` path only kills `agent_jobs` workers; dispatcher runs
// never create that row, so without this hook the child claude-code keeps
// eating tokens after a user pressed Stop.
//
// Contract:
//   - `abortRun(rowId, { reason })` is idempotent. Re-entry on an already-
//     dead/missing run is a no-op that resolves `{ aborted:false }`.
//   - Process kill uses the process-group trick (`process.kill(-pid, ...)`)
//     so child shells / MCP spawns get cleaned up too. Falls back to
//     direct-pid kill if the PGID path raises ESRCH.
//   - Terminal DB writes mark `run_state='canceled'`, `run_terminal_reason
//     ='user_stop'`, `run_finished_at=now()` — independently of whether
//     applyRunTerminal eventually fires from processLive's catch block.
//   - The conversation lookup intentionally does NOT depend on the
//     `_agent_runs` table (that name was floated in ADR-0030 drafts but
//     never landed). We walk `conversations.bound_row_id` → ticket.id.

const ABORT_SIGKILL_GRACE_MS = 5_000;

async function _persistRunCanceled(rowId, reason) {
  const nowIso = new Date().toISOString();
  try {
    await dbRun(
      `UPDATE table_rows
          SET data = COALESCE(data, '{}'::jsonb)
                     || jsonb_build_object(
                          'run_state',           'canceled'::text,
                          'run_terminal_reason', $2::text,
                          'run_finished_at',     $3::text,
                          'run_last_event_at',   $3::text
                        ),
              updated_at = NOW()
        WHERE table_id = $1 AND id = $4`,
      [TICKETS_TABLE_ID, reason || 'user_stop', nowIso, rowId]
    );
  } catch (err) {
    log.warn({ err: err.message, ticket_id: rowId }, 'abortRun: persist canceled state failed (non-blocking)');
  }
  await appendAuditLog(rowId, {
    at: nowIso,
    event_type: 'aborted',
    reason: reason || 'user_stop',
    source: 'abort_run',
  });
}

/**
 * Abort an active dispatcher run for a single ticket row.
 *
 * Looks up the live PID in `_activeAttempts`. Sends SIGTERM to the
 * process group, waits up to 5s, then escalates to SIGKILL if the child
 * is still alive. Always writes `run_state='canceled'` so observers
 * (incl. the next runTick) treat this as terminal even if the kill
 * raced with a natural exit.
 *
 * @param {number} rowId - ticket row id (table 1708)
 * @param {{reason?: string}} [opts]
 * @returns {Promise<{aborted: boolean, pid?: number, reason: string, escalated?: boolean}>}
 */
export async function abortRun(rowId, { reason = 'user_stop' } = {}) {
  if (!rowId || typeof rowId !== 'number') {
    return { aborted: false, reason: 'invalid_row_id' };
  }
  const entry = _activeAttempts.get(rowId);
  const pid = entry?.pid;

  // Persist terminal state regardless — if a stale `_activeAttempts` entry
  // is missing the PID, we still flip the ticket so future ticks don't
  // re-pick it up.
  await _persistRunCanceled(rowId, reason);

  // Drop the active-attempts entry up front so concurrent ticks don't
  // treat this run as still live.
  _activeAttempts.delete(rowId);

  if (!pid || typeof pid !== 'number' || pid <= 0) {
    log.info({ ticket_id: rowId, reason }, 'abortRun: no live PID — terminal state persisted, nothing to signal');
    return { aborted: true, reason, pid: null };
  }

  if (!probeAlive(pid)) {
    log.info({ ticket_id: rowId, pid, reason }, 'abortRun: pid already gone — nothing to signal');
    return { aborted: true, reason, pid, escalated: false };
  }

  // SIGTERM the process group so child shells / MCP spawns get cleaned up.
  try {
    process.kill(-pid, 'SIGTERM');
    log.info({ ticket_id: rowId, pid, reason }, 'abortRun: SIGTERM sent to process group');
  } catch (err) {
    if (err && err.code === 'ESRCH') {
      log.debug({ ticket_id: rowId, pid }, 'abortRun: PGID kill ESRCH — falling back to direct PID');
      try { process.kill(pid, 'SIGTERM'); }
      catch (innerErr) { /* already gone */ void innerErr; }
    } else {
      log.warn({ err: err.message, ticket_id: rowId, pid }, 'abortRun: SIGTERM failed (non-fatal)');
    }
  }

  // SIGKILL grace timer. We do NOT await it — abortRun must return
  // quickly so the HTTP handler can release. The timer unref()s so it
  // doesn't keep the event loop alive on shutdown.
  const grace = setTimeout(() => {
    if (!probeAlive(pid)) return;
    try {
      process.kill(-pid, 'SIGKILL');
      log.warn({ ticket_id: rowId, pid }, 'abortRun: SIGKILL sent (SIGTERM grace expired)');
    } catch (err) {
      if (!err || err.code !== 'ESRCH') {
        log.warn({ err: err.message, ticket_id: rowId, pid }, 'abortRun: SIGKILL failed');
      }
    }
  }, ABORT_SIGKILL_GRACE_MS);
  grace.unref?.();

  return { aborted: true, reason, pid };
}

/**
 * Abort any active dispatcher run associated with a chat conversation.
 *
 * Walks `conversations.bound_row_id` → ticket row id, then checks whether
 * that ticket is currently in `_activeAttempts`. If yes, delegates to
 * `abortRun`. Safe to call for conversations that have no bound ticket
 * (returns `{aborted: false}` without touching anything).
 *
 * @param {number|string} conversationId
 * @param {{reason?: string}} [opts]
 * @returns {Promise<{aborted: boolean, reason: string, pid?: number|null, ticket_id?: number|null}>}
 */
export async function abortRunByConversation(conversationId, { reason = 'user_stop' } = {}) {
  if (!conversationId) {
    return { aborted: false, reason: 'invalid_conversation_id' };
  }
  let conv;
  try {
    conv = await dbGet(
      `SELECT bound_row_id, bound_table_id FROM conversations WHERE id = $1`,
      [conversationId]
    );
  } catch (err) {
    log.warn({ err: err.message, conversationId }, 'abortRunByConversation: conversation lookup failed');
    return { aborted: false, reason: 'lookup_failed' };
  }
  const ticketRowId = conv?.bound_row_id ? Number(conv.bound_row_id) : null;
  // Tolerate both bound_table_id present (canonical) and missing (older rows).
  // The lookup is the authoritative signal — `_activeAttempts` keys are ticket
  // row ids regardless of which table they live in.
  if (!ticketRowId || !_activeAttempts.has(ticketRowId)) {
    return { aborted: false, reason: 'no_active_run', ticket_id: ticketRowId };
  }
  const result = await abortRun(ticketRowId, { reason });
  return { ...result, ticket_id: ticketRowId };
}

export default {
  init,
  shutdown,
  health,
  healthAsync,
  runTick,
  loadConfig,
  runStallDetect,
  computeBackoff,
  abortRun,
  abortRunByConversation,
};
