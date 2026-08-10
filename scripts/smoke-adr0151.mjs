#!/usr/bin/env node
/**
 * ADR-0042 Task 7 — smoke / dogfood for the smart-liveness FSM.
 *
 * Runs against the LOCAL godcrm_test DB (per ADR-0009 isolation rules).
 * Does NOT hit PROD or DEV. The scenarios simulate wall-clock time by
 * back-dating `run_state_entered_at` / `run_last_event_at` so the
 * dispatcher's stall sweep sees a "16-min stuck Bash" without us actually
 * waiting 16 minutes. The kill / no-kill decision is made by the
 * production code path (`runStallDetect` → smart sweep or
 * `legacyStallKillIfStuck`), so the test exercises real logic.
 *
 * Scenarios (3, exit 0 only if all pass):
 *   1. Bash stuck for 16 min  — meaningful-event idle past 10-min default
 *      → dispatcher kills with `run_terminal_reason='stall'` after the
 *      max-attempt is exhausted. Covers AC1 (per-tool window), AC2 (idle
 *      escalation), AC8 (smart path is the active mode).
 *   2. Healthy 60-min long task — recent meaningful event (60 s ago) +
 *      old `run_state_entered_at` (60 min) → dispatcher does NOT kill.
 *   3. 31-min legacy rollback — env `AGENT_LIVENESS_LEGACY=1` flips
 *      `runStallDetect` to `legacyStallKillIfStuck`, which kills any
 *      idle-past-threshold ticket regardless of FSM state. Covers AC8.
 *
 * The script seeds and cleans up its own rows under `smoke_tag='smoke-adr-0042'`.
 *
 * @see ADR-0042 §13 Task 7, doc 143508.
 */

// ─── Force test DB BEFORE any module import (ADR-0009 boot guard) ──
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_DB   = 'godcrm_test';
process.env.POSTGRES_USER = 'godcrm';
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026';
process.env.POSTGRES_PORT = '5432';
process.env.AGENT_RUN_DISPATCHER_ENABLED = 'false';   // we drive sweeps manually
process.env.NODE_ENV = 'test';
delete process.env.BUSINESS_CRM_IS_PROD;

// Defer the boot-guard import until after env mutations — static `import`
// statements are hoisted and would run before our env tweaks.
await import('../backend/test/setup.js');

const dispatcher = await import(
  '../backend/services/agent-run-dispatcher/index.js'
);
const {
  runStallDetect,
  legacyStallKillIfStuck,
  loadConfig,
} = dispatcher;
const { dbGet, dbRun } = await import('../backend/database/connection.js');

const TICKETS_TABLE_ID = 1708;
const AGENTS_TABLE_ID  = 1784;
const STATE_BACKLOG    = 24275;
const SMOKE_TAG        = 'smoke-adr-0042';

let pass = 0;
let fail = 0;
const insertedRowIds = [];

function assert(label, cond, extra = '') {
  if (cond) {
    console.log(`  PASS ${label}`);
    pass++;
  } else {
    console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
    fail++;
  }
}

function genBaseId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function insertRow(tableId, data) {
  const row = await dbGet(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING id`,
    [tableId, genBaseId(), JSON.stringify(data)]
  );
  insertedRowIds.push({ table_id: tableId, id: row.id });
  return row.id;
}

async function getTicket(ticketId) {
  const row = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = $1 AND id = $2`,
    [TICKETS_TABLE_ID, ticketId]
  );
  if (!row?.data) return null;
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
}

async function makeTicket({
  runState        = 'running',
  runAttempt     = 3,                       // force terminal failure on kill
  lastEventMin   = 16,                      // minutes ago
  stateEnteredMin = null,                   // defaults to lastEventMin
  toolName        = null,
  livenessState   = null,
  extra           = {},
} = {}) {
  const now = Date.now();
  const lastEventAt = new Date(now - lastEventMin * 60_000).toISOString();
  const enteredAt = new Date(
    now - (stateEnteredMin ?? lastEventMin) * 60_000
  ).toISOString();
  const agentId = await insertRow(AGENTS_TABLE_ID, {
    name: 'Smoke Agent ADR-0042',
    smoke_tag: SMOKE_TAG,
  });
  const data = {
    state: STATE_BACKLOG,
    assigned_to: String(agentId),
    title: 'ADR-0042 smoke ticket',
    what:  'ADR-0042 smoke ticket',
    smoke_tag: SMOKE_TAG,
    run_state: runState,
    run_attempt: runAttempt,
    run_started_at: enteredAt,
    run_last_event_at: lastEventAt,
    run_state_entered_at: enteredAt,
    ...extra,
  };
  if (toolName) data.run_current_tool = { name: toolName };
  if (livenessState) data.run_liveness_state = livenessState;
  const ticketId = await insertRow(TICKETS_TABLE_ID, data);
  return { agentId, ticketId, lastEventAt, enteredAt };
}

async function cleanup() {
  if (insertedRowIds.length > 0) {
    const ids = insertedRowIds.map((r) => r.id);
    try {
      await dbRun(`DELETE FROM table_rows WHERE id = ANY($1::int[])`, [ids]);
    } catch { /* best-effort */ }
  }
  // Catch any orphans tagged with our smoke tag.
  await dbRun(
    `DELETE FROM table_rows WHERE data->>'smoke_tag' = $1`,
    [SMOKE_TAG]
  ).catch(() => {});
}

async function scenarioBashStuck() {
  console.log('\nScenario 1 — Bash stuck for 16 min (smart path)');
  const { ticketId } = await makeTicket({
    runState: 'running',
    runAttempt: 3,                  // exhausted → terminal failed
    lastEventMin: 16,               // > 10-min default meaningful_event_idle_ms
    toolName: 'Bash',
    livenessState: 'tool_active',
  });

  const config = await loadConfig({ force: true });
  const stats = { stalled: 0, stall_failed: 0, stall_retried: 0, errors: 0 };
  delete process.env.AGENT_LIVENESS_LEGACY;          // ensure smart path
  await runStallDetect({ source: 'smoke-1', stats, config });

  const after = await getTicket(ticketId);
  assert('S1 ticket flipped to failed',
    after?.run_state === 'failed',
    `got run_state=${after?.run_state}`);
  assert('S1 terminal_reason=stall (smart sweep 2)',
    after?.run_terminal_reason === 'stall',
    `got reason=${after?.run_terminal_reason}`);
  assert('S1 stats.stall_failed incremented',
    stats.stall_failed === 1,
    `got ${JSON.stringify(stats)}`);
  assert('S1 audit log has stall mode=smart',
    Array.isArray(after?.run_audit_log)
      && after.run_audit_log.some((e) => e?.reason === 'stall' && e?.mode === 'smart'),
    `audit_log=${JSON.stringify(after?.run_audit_log?.slice(-2))}`);
}

async function scenarioHealthyLongTask() {
  console.log('\nScenario 2 — Healthy 60-min long task (no kill)');
  const { ticketId } = await makeTicket({
    runState: 'running',
    runAttempt: 1,
    lastEventMin: 1 / 60,            // 1-second-old event = fresh
    stateEnteredMin: 60,             // ticket has been running 60 min
    toolName: 'Bash',
    livenessState: 'tool_active',
  });

  const config = await loadConfig({ force: true });
  const stats = { stalled: 0, stall_failed: 0, stall_retried: 0, errors: 0 };
  delete process.env.AGENT_LIVENESS_LEGACY;
  await runStallDetect({ source: 'smoke-2', stats, config });

  const after = await getTicket(ticketId);
  assert('S2 ticket still running (not killed)',
    after?.run_state === 'running',
    `got run_state=${after?.run_state}`);
  assert('S2 no terminal_reason set',
    !after?.run_terminal_reason,
    `got reason=${after?.run_terminal_reason}`);
  assert('S2 stats untouched (no stall counted)',
    stats.stalled === 0 && stats.stall_failed === 0 && stats.stall_retried === 0,
    `got ${JSON.stringify(stats)}`);
}

async function scenarioLegacyRollback() {
  console.log('\nScenario 3 — 31-min legacy rollback (AGENT_LIVENESS_LEGACY=1)');
  const { ticketId } = await makeTicket({
    runState: 'running',
    runAttempt: 3,                  // exhausted → terminal failed
    lastEventMin: 31,               // > legacy default (10 min)
    // Legacy path doesn't read FSM state — set neither tool nor liveness.
  });

  const config = await loadConfig({ force: true });
  const stats = { stalled: 0, stall_failed: 0, stall_retried: 0, errors: 0 };
  process.env.AGENT_LIVENESS_LEGACY = '1';
  let count;
  try {
    count = await runStallDetect({ source: 'smoke-3', stats, config });
  } finally {
    delete process.env.AGENT_LIVENESS_LEGACY;
  }

  const after = await getTicket(ticketId);
  assert('S3 legacy sweep returned a positive count',
    typeof count === 'number' && count >= 1,
    `got count=${count}`);
  assert('S3 ticket flipped to failed',
    after?.run_state === 'failed',
    `got run_state=${after?.run_state}`);
  assert('S3 terminal_reason=stall',
    after?.run_terminal_reason === 'stall',
    `got reason=${after?.run_terminal_reason}`);
  assert('S3 audit log has stall mode=legacy',
    Array.isArray(after?.run_audit_log)
      && after.run_audit_log.some((e) => e?.reason === 'stall' && e?.mode === 'legacy'),
    `audit_log=${JSON.stringify(after?.run_audit_log?.slice(-2))}`);
}

async function main() {
  console.log('ADR-0042 smoke (godcrm_test) — start');
  try {
    await scenarioBashStuck();
    await scenarioHealthyLongTask();
    await scenarioLegacyRollback();
  } catch (err) {
    console.error('SMOKE THREW:', err);
    fail++;
  } finally {
    await cleanup();
  }

  console.log(`\n${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
