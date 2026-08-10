#!/usr/bin/env node
/**
 * Smoke test for ADR-0030 Phase 2 — agent_run_dispatcher (dry-run mode).
 *
 * Runs against the LOCAL godcrm_test DB (per ADR-0009 isolation rules).
 * Does NOT hit PROD or DEV remote.
 *
 * Six acceptance cases (matching T-140106 acceptance criteria):
 *   1. idle ticket → preparing → canceled within one tick.
 *   2. queued ticket → preparing → canceled within one tick.
 *   3. retry_after with run_next_attempt_after in past → claimed.
 *   4. retry_after with run_next_attempt_after in future → NOT claimed.
 *   5. paused=true → no claims; resume → claims again.
 *   6. max_concurrent_runs=1 with two ready tickets → only one transitions per tick.
 *   7. (bonus) audit log accumulates two entries per ticket (claim + cancel).
 *   8. (bonus) ticket in DONE state (state=24278) is not claimed.
 *
 * Cleanup: deletes all created tickets at the end.
 */

import {
  init as initDispatcher,
  shutdown as shutdownDispatcher,
  runTick,
  loadConfig,
} from '../backend/services/agent-run-dispatcher/index.js';

// ─── Force test DB before any DB import ────────────────────────
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_DB = 'godcrm_test';
process.env.POSTGRES_USER = 'godcrm';
process.env.POSTGRES_PASSWORD = 'godcrm_dev_2026';
process.env.POSTGRES_PORT = '5432';
process.env.AGENT_RUN_DISPATCHER_ENABLED = 'false'; // we drive ticks manually
process.env.NODE_ENV = 'test';

const { dbAll, dbGet, dbRun } = await import('../backend/database/connection.js');

const TICKETS_TABLE_ID = 1708;
const WORKFLOW_CONFIG_TABLE_ID = 100000;
const STATE_BACKLOG = 24275;
const STATE_DONE = 24278;
const SMOKE_TAG = 'smoke-adr0030-p2';
const ASSIGNED_TO = 'developer-ralph';

let pass = 0;
let fail = 0;
const created = []; // ticket ids to delete on cleanup

function assert(label, cond, extra = '') {
  if (cond) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label} ${extra}`);
    fail++;
  }
}

function genBaseId() {
  // 8-char uppercase alphanumeric, matching the format already in table_rows.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function createTicket({ run_state, run_next_attempt_after, ticket_state = STATE_BACKLOG }) {
  const data = {
    state: ticket_state,
    assigned_to: ASSIGNED_TO,
    what: SMOKE_TAG,
    created_by: 'manual-test',
    smoke_tag: SMOKE_TAG,
  };
  if (run_state !== undefined) data.run_state = run_state;
  if (run_next_attempt_after !== undefined) data.run_next_attempt_after = run_next_attempt_after;

  const row = await dbGet(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING id`,
    [TICKETS_TABLE_ID, genBaseId(), JSON.stringify(data)]
  );
  created.push(row.id);
  return row.id;
}

async function getRunState(ticketId) {
  const row = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = $1 AND id = $2`,
    [TICKETS_TABLE_ID, ticketId]
  );
  if (!row?.data) return null;
  const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  return {
    run_state: d.run_state,
    run_attempt: d.run_attempt,
    run_terminal_reason: d.run_terminal_reason,
    run_audit_log: d.run_audit_log || [],
    run_started_at: d.run_started_at,
    run_finished_at: d.run_finished_at,
  };
}

async function setConfig(patch) {
  const row = await dbGet(
    `SELECT id, data FROM table_rows WHERE table_id = $1 ORDER BY id ASC LIMIT 1`,
    [WORKFLOW_CONFIG_TABLE_ID]
  );
  const cur = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const next = { ...cur, ...patch };
  await dbRun(
    `UPDATE table_rows SET data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(next), row.id]
  );
  await loadConfig({ force: true });
}

async function cleanup() {
  if (created.length === 0) return;
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = $1 AND id = ANY($2::int[])`,
    [TICKETS_TABLE_ID, created]
  );
  // Also wipe any orphan rows tagged with our smoke tag from prior interrupted runs.
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = $1 AND data->>'smoke_tag' = $2`,
    [TICKETS_TABLE_ID, SMOKE_TAG]
  );
  // Reset config to canonical defaults.
  await setConfig({
    paused: false,
    max_concurrent_runs: 3,
    poll_interval_ms: 30000,
  });
}

async function main() {
  console.log('ADR-0030 Phase 2 smoke test (godcrm_test) — start\n');

  // Pre-flight: clear any leftovers from previous runs.
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = $1 AND data->>'smoke_tag' = $2`,
    [TICKETS_TABLE_ID, SMOKE_TAG]
  );
  await setConfig({ paused: false, max_concurrent_runs: 3 });

  // ── Case 1: idle → preparing → canceled
  console.log('Case 1: idle ticket transitions to canceled (dry-run)');
  {
    const id = await createTicket({ run_state: 'idle' });
    const stats = await runTick({ source: 'smoke_case_1' });
    assert('tick picked >= 1', stats.picked >= 1, JSON.stringify(stats));
    const s = await getRunState(id);
    assert('run_state == canceled', s.run_state === 'canceled', `got ${s.run_state}`);
    assert('terminal_reason == phase2_dryrun', s.run_terminal_reason === 'phase2_dryrun');
    assert('run_attempt == 1', s.run_attempt === 1, `got ${s.run_attempt}`);
    assert('run_started_at set', !!s.run_started_at);
    assert('run_finished_at set', !!s.run_finished_at);
  }

  // ── Case 2: queued → canceled
  console.log('\nCase 2: queued ticket transitions to canceled');
  {
    const id = await createTicket({ run_state: 'queued' });
    await runTick({ source: 'smoke_case_2' });
    const s = await getRunState(id);
    assert('run_state == canceled', s.run_state === 'canceled');
    assert('terminal_reason == phase2_dryrun', s.run_terminal_reason === 'phase2_dryrun');
  }

  // ── Case 3: retry_after with past timestamp → claimed
  console.log('\nCase 3: retry_after (past) is claimed');
  {
    const past = new Date(Date.now() - 60_000).toISOString();
    const id = await createTicket({ run_state: 'retry_after', run_next_attempt_after: past });
    await runTick({ source: 'smoke_case_3' });
    const s = await getRunState(id);
    assert('run_state == canceled (claimed and dry-run cancelled)', s.run_state === 'canceled');
  }

  // ── Case 4: retry_after with future timestamp → NOT claimed
  console.log('\nCase 4: retry_after (future) is NOT claimed');
  {
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    const id = await createTicket({ run_state: 'retry_after', run_next_attempt_after: future });
    await runTick({ source: 'smoke_case_4' });
    const s = await getRunState(id);
    assert('run_state still retry_after', s.run_state === 'retry_after', `got ${s.run_state}`);
    assert('no terminal_reason', !s.run_terminal_reason);
  }

  // ── Case 5: paused=true → skip; resume → claim
  console.log('\nCase 5: paused config halts claims, resume re-enables');
  {
    await setConfig({ paused: true });
    const id = await createTicket({ run_state: 'idle' });
    const stats = await runTick({ source: 'smoke_case_5_paused' });
    assert('paused stat = true', stats.paused === true);
    let s = await getRunState(id);
    assert('paused: ticket still idle (untouched)', s.run_state === 'idle', `got ${s.run_state}`);
    assert('paused: no terminal_reason yet', !s.run_terminal_reason);

    await setConfig({ paused: false });
    await runTick({ source: 'smoke_case_5_resumed' });
    s = await getRunState(id);
    assert('resumed: ticket reached canceled', s.run_state === 'canceled');
  }

  // ── Case 6: max_concurrent_runs=1 with two idle tickets → only one transitions per tick
  console.log('\nCase 6: max_concurrent_runs=1 throttles claims to 1/tick');
  {
    await setConfig({ max_concurrent_runs: 1 });
    const a = await createTicket({ run_state: 'idle' });
    const b = await createTicket({ run_state: 'idle' });
    const stats = await runTick({ source: 'smoke_case_6' });
    assert('picked == 1', stats.picked === 1, `got ${stats.picked}`);
    const sA = await getRunState(a);
    const sB = await getRunState(b);
    const aChanged = sA.run_state === 'canceled';
    const bChanged = sB.run_state === 'canceled';
    assert('exactly one of {a,b} ended canceled', (aChanged ? 1 : 0) + (bChanged ? 1 : 0) === 1,
      `aRunState=${sA.run_state} bRunState=${sB.run_state}`);

    // Second tick should pick up the other one.
    const stats2 = await runTick({ source: 'smoke_case_6_second' });
    assert('second tick picked == 1', stats2.picked === 1, `got ${stats2.picked}`);
    const sA2 = await getRunState(a);
    const sB2 = await getRunState(b);
    assert('both now canceled', sA2.run_state === 'canceled' && sB2.run_state === 'canceled',
      `aRunState=${sA2.run_state} bRunState=${sB2.run_state}`);

    // Restore config.
    await setConfig({ max_concurrent_runs: 3 });
  }

  // ── Case 7: audit log has 2 entries per ticket
  console.log('\nCase 7: audit log records claim + cancel transitions');
  {
    const id = await createTicket({ run_state: 'idle' });
    await runTick({ source: 'smoke_case_7' });
    const s = await getRunState(id);
    assert('audit_log length >= 2', s.run_audit_log.length >= 2, `got ${s.run_audit_log.length}`);
    const states = s.run_audit_log.map(e => e.to);
    assert('audit log includes "preparing"', states.includes('preparing'));
    assert('audit log includes "canceled"', states.includes('canceled'));
    const reasons = s.run_audit_log.map(e => e.reason);
    assert('phase2_dryrun reason recorded', reasons.includes('phase2_dryrun'));
  }

  // ── Case 8: terminal ticket state (DONE) is NOT claimed
  console.log('\nCase 8: ticket in DONE state is not claimed');
  {
    const id = await createTicket({ run_state: 'idle', ticket_state: STATE_DONE });
    await runTick({ source: 'smoke_case_8' });
    const s = await getRunState(id);
    assert('DONE ticket not transitioned', s.run_state === 'idle', `got ${s.run_state}`);
  }

  // ── Cleanup
  console.log('\nCleanup');
  await cleanup();
  assert('cleanup ran without error', true);

  console.log(`\n${pass + fail} assertions: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  cleanup().finally(() => process.exit(2));
});
