#!/usr/bin/env node
/**
 * Smoke test for ADR-0030 Phase 6 — stall detection + retry with backoff.
 *
 * Runs against the LOCAL godcrm_test DB (per ADR-0009 isolation rules).
 * Does NOT hit PROD or DEV.
 *
 * Cases (10 total — covers T-140111 acceptance criteria 1..7):
 *   1. Stall → retry_after with computed backoff window + audit entry.
 *   2. Stall on max-attempts ticket → terminal failed + reason='stall'.
 *   3. awaiting_approval is EXCLUDED from stall detection.
 *   4. Fresh ticket (last event 10s ago) is UNTOUCHED.
 *   5. idle ticket (regardless of last_event_at) is UNTOUCHED.
 *   6. SIGTERM/SIGKILL of a tracked PID — process gone within grace.
 *   7. computeBackoff math: 1→10000, 2→20000, 3→40000, 4→40000.
 *   8. Hot-reload: shrink stall_timeout_ms via _workflow_config.
 *   9. End-to-end runTick: 'running' ticket with old event → retry_after.
 *  10. Retry pickup: claimReady picks up ready retry, skips not-yet-due.
 */

// ─── Force test DB BEFORE any module import (ADR-0009 boot guard) ──
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_DB = 'godcrm_test';
process.env.POSTGRES_USER = 'godcrm';
process.env.POSTGRES_PASSWORD = 'godcrm_dev_2026';
process.env.POSTGRES_PORT = '5432';
process.env.AGENT_RUN_DISPATCHER_ENABLED = 'false'; // we drive ticks manually
process.env.RUN_DISPATCHER_PHASE = 'dryrun';        // P6 doesn't need live runs
process.env.RUN_REQUIRE_APPROVAL = 'false';
process.env.NODE_ENV = 'test';
delete process.env.BUSINESS_CRM_IS_PROD;

// Defer setup-guard import until AFTER the env mutations above; static
// `import` statements are hoisted and would run before our env tweaks.
await import('../backend/test/setup.js');

const { spawn } = await import('node:child_process');

const dispatcher = await import(
  '../backend/services/agent-run-dispatcher/index.js'
);
const {
  runStallDetect,
  runTick,
  loadConfig,
  computeBackoff,
  _getActiveAttemptsForTest,
} = dispatcher;
const { dbGet, dbRun, dbAll } = await import('../backend/database/connection.js');

const TICKETS_TABLE_ID = 1708;
const AGENTS_TABLE_ID = 1784;
const WORKFLOW_CONFIG_TABLE_ID = 100000;
const STATE_BACKLOG = 24275;
const SMOKE_TAG = 'smoke-adr0030-p6';

let pass = 0;
let fail = 0;
const insertedRowIds = []; // { table_id, id }
const childProcs = [];     // spawned children for case 6
let originalConfigRow = null; // captured for hot-reload restore

function assert(label, cond, extra = '') {
  if (cond) {
    console.log(`  PASS ${label}`);
    pass++;
  } else {
    console.log(`  FAIL ${label} ${extra}`);
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

async function getTicketData(ticketId) {
  const row = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = $1 AND id = $2`,
    [TICKETS_TABLE_ID, ticketId]
  );
  if (!row?.data) return null;
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
}

async function makeStalledTicket({
  runState = 'running',
  runAttempt = 1,
  ageMinutes = 10,
  extra = {},
} = {}) {
  const lastEventAt = new Date(Date.now() - ageMinutes * 60_000).toISOString();
  const agentId = await insertRow(AGENTS_TABLE_ID, {
    name: 'Smoke Agent P6',
    smoke_tag: SMOKE_TAG,
  });
  const ticketId = await insertRow(TICKETS_TABLE_ID, {
    state: STATE_BACKLOG,
    assigned_to: String(agentId),
    title: 'P6 smoke ticket',
    what: 'P6 smoke ticket',
    smoke_tag: SMOKE_TAG,
    run_state: runState,
    run_attempt: runAttempt,
    run_started_at: new Date(Date.now() - 11 * 60_000).toISOString(),
    run_last_event_at: lastEventAt,
    ...extra,
  });
  return { agentId, ticketId, lastEventAt };
}

async function cleanup() {
  if (insertedRowIds.length > 0) {
    const ids = insertedRowIds.map((r) => r.id);
    try {
      await dbRun(`DELETE FROM table_rows WHERE id = ANY($1::int[])`, [ids]);
    } catch { /* best-effort */ }
  }
  // Catch orphans by smoke_tag.
  await dbRun(
    `DELETE FROM table_rows WHERE data->>'smoke_tag' = $1`,
    [SMOKE_TAG]
  ).catch(() => {});

  // Kill any test children that survived.
  for (const c of childProcs) {
    try {
      if (!c.killed) c.kill('SIGKILL');
    } catch { /* gone */ }
  }

  // Restore original _workflow_config row if we mutated it.
  if (originalConfigRow) {
    try {
      await dbRun(
        `UPDATE table_rows SET data = $2::jsonb, updated_at = NOW()
          WHERE table_id = $1 AND id = $3`,
        [WORKFLOW_CONFIG_TABLE_ID, JSON.stringify(originalConfigRow.data), originalConfigRow.id]
      );
    } catch { /* best-effort */ }
  }
}

async function main() {
  console.log('ADR-0030 Phase 6 smoke test (godcrm_test) — start');

  // Pre-flight scrub.
  await dbRun(
    `DELETE FROM table_rows WHERE data->>'smoke_tag' = $1`,
    [SMOKE_TAG]
  );

  // Capture _workflow_config row so we can restore later (case 8 mutates it).
  originalConfigRow = await dbGet(
    `SELECT id, data FROM table_rows WHERE table_id = $1 ORDER BY id ASC LIMIT 1`,
    [WORKFLOW_CONFIG_TABLE_ID]
  );
  if (originalConfigRow && typeof originalConfigRow.data === 'string') {
    originalConfigRow.data = JSON.parse(originalConfigRow.data);
  }

  // Force config reload with brief defaults (40000 cap, 10000 min, 300000 stall).
  // The DB has retry_backoff_max_ms=300000 — override for deterministic test.
  if (originalConfigRow) {
    const merged = {
      ...originalConfigRow.data,
      stall_timeout_ms: 300_000,
      retry_backoff_min_ms: 10_000,
      retry_backoff_max_ms: 40_000,
      max_attempts: 3,
      paused: false,
    };
    await dbRun(
      `UPDATE table_rows SET data = $2::jsonb, updated_at = NOW()
        WHERE table_id = $1 AND id = $3`,
      [WORKFLOW_CONFIG_TABLE_ID, JSON.stringify(merged), originalConfigRow.id]
    );
  }
  await loadConfig({ force: true });

  // ── Case 1: stall → retry_after + backoff + audit
  console.log('\nCase 1: stall → retry_after with backoff window');
  {
    const { ticketId } = await makeStalledTicket({ runAttempt: 1, ageMinutes: 10 });
    const t0 = Date.now();
    await runStallDetect({ source: 'smoke_p6_case_1' });
    const data = await getTicketData(ticketId);
    assert('run_state === retry_after',
           data.run_state === 'retry_after', `got ${data?.run_state}`);
    assert('run_next_attempt_after present', !!data.run_next_attempt_after);
    if (data.run_next_attempt_after) {
      const delay = Date.parse(data.run_next_attempt_after) - t0;
      // attempt=1 → 10000ms backoff (allow ±2000 fuzz).
      assert('backoff ~10s for attempt=1',
             delay > 8_000 && delay < 12_000,
             `delay=${delay}ms`);
    }
    assert('run_terminal_reason NOT set (non-terminal)',
           !data.run_terminal_reason, `got ${data?.run_terminal_reason}`);
    const audit = data.run_audit_log || [];
    const stallEntry = audit.find(
      (e) => e.reason === 'stall' && e.to === 'retry_after'
    );
    assert('audit entry reason=stall to=retry_after',
           !!stallEntry, JSON.stringify(audit));
    if (stallEntry) {
      assert('audit.from === running',
             stallEntry.from === 'running', JSON.stringify(stallEntry));
      assert('audit.attempt === 1',
             stallEntry.attempt === 1, JSON.stringify(stallEntry));
      assert('audit.source === tick_part_a',
             stallEntry.source === 'tick_part_a', JSON.stringify(stallEntry));
    }
  }

  // ── Case 2: max-attempts → terminal failed
  console.log('\nCase 2: max_attempts exhausted → terminal failed');
  {
    const { ticketId } = await makeStalledTicket({ runAttempt: 3, ageMinutes: 10 });
    await runStallDetect({ source: 'smoke_p6_case_2' });
    const data = await getTicketData(ticketId);
    assert('run_state === failed',
           data.run_state === 'failed', `got ${data?.run_state}`);
    assert('run_terminal_reason === stall',
           data.run_terminal_reason === 'stall',
           `got ${data?.run_terminal_reason}`);
    assert('run_next_attempt_after NOT set on terminal',
           data.run_next_attempt_after == null,
           `got ${data?.run_next_attempt_after}`);
    assert('run_finished_at set', !!data.run_finished_at);
    const audit = data.run_audit_log || [];
    const failEntry = audit.find(
      (e) => e.reason === 'stall' && e.to === 'failed'
    );
    assert('audit reason=stall to=failed', !!failEntry, JSON.stringify(audit));
  }

  // ── Case 3: awaiting_approval EXCLUDED
  console.log('\nCase 3: awaiting_approval is EXCLUDED');
  {
    const { ticketId } = await makeStalledTicket({
      runState: 'awaiting_approval',
      runAttempt: 1,
      ageMinutes: 10,
    });
    await runStallDetect({ source: 'smoke_p6_case_3' });
    const data = await getTicketData(ticketId);
    assert('run_state stays awaiting_approval',
           data.run_state === 'awaiting_approval', `got ${data?.run_state}`);
    assert('no run_terminal_reason set',
           !data.run_terminal_reason, `got ${data?.run_terminal_reason}`);
    const audit = data.run_audit_log || [];
    assert('no stall audit entries',
           !audit.some((e) => e.reason === 'stall'),
           JSON.stringify(audit));
  }

  // ── Case 4: fresh ticket UNTOUCHED
  console.log('\nCase 4: fresh ticket (10s old) UNTOUCHED');
  {
    const fresh = new Date(Date.now() - 10_000).toISOString();
    const agentId = await insertRow(AGENTS_TABLE_ID, {
      name: 'Smoke Agent P6 fresh', smoke_tag: SMOKE_TAG,
    });
    const ticketId = await insertRow(TICKETS_TABLE_ID, {
      state: STATE_BACKLOG,
      assigned_to: String(agentId),
      title: 'P6 fresh ticket',
      what: 'P6 fresh ticket',
      smoke_tag: SMOKE_TAG,
      run_state: 'running',
      run_attempt: 1,
      run_last_event_at: fresh,
    });
    await runStallDetect({ source: 'smoke_p6_case_4' });
    const data = await getTicketData(ticketId);
    assert('run_state stays running',
           data.run_state === 'running', `got ${data?.run_state}`);
  }

  // ── Case 5: idle ticket UNTOUCHED (not in STALL_CHECK_RUN_STATES)
  console.log('\nCase 5: idle ticket UNTOUCHED even with old last_event_at');
  {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const agentId = await insertRow(AGENTS_TABLE_ID, {
      name: 'Smoke Agent P6 idle', smoke_tag: SMOKE_TAG,
    });
    const ticketId = await insertRow(TICKETS_TABLE_ID, {
      state: STATE_BACKLOG,
      assigned_to: String(agentId),
      title: 'P6 idle ticket',
      what: 'P6 idle ticket',
      smoke_tag: SMOKE_TAG,
      run_state: 'idle',
      run_attempt: 0,
      run_last_event_at: old,
    });
    await runStallDetect({ source: 'smoke_p6_case_5' });
    const data = await getTicketData(ticketId);
    assert('idle ticket stays idle',
           data.run_state === 'idle', `got ${data?.run_state}`);
  }

  // ── Case 6: SIGTERM/SIGKILL of tracked PID
  console.log('\nCase 6: SIGTERM tracked PID — process gone within grace');
  {
    // Long-running child that ignores nothing (default Node handles SIGTERM
    // and exits cleanly).
    const child = spawn(
      process.execPath,
      ['-e', 'setTimeout(()=>{},60_000)'],
      { stdio: 'ignore', detached: false }
    );
    childProcs.push(child);
    // Wait for spawn to register.
    await new Promise((r) => setTimeout(r, 50));
    const pid = child.pid;
    assert('child spawned with pid', typeof pid === 'number' && pid > 0,
           `pid=${pid}`);

    const { ticketId } = await makeStalledTicket({ runAttempt: 1, ageMinutes: 10 });
    // Inject the PID into the dispatcher's active-attempts map.
    const map = _getActiveAttemptsForTest();
    map.set(ticketId, { agent_id: 'test', claimedAt: Date.now(), pid });

    // Kick stall detect — this should SIGTERM the child synchronously and
    // return after the 5s grace.
    const t0 = Date.now();
    await runStallDetect({ source: 'smoke_p6_case_6' });
    const elapsed = Date.now() - t0;

    // Probe: child should be gone now.
    let alive = true;
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    assert('child PID is gone after stall kill', !alive, `pid=${pid} elapsed=${elapsed}ms`);
    assert('elapsed within ~6s', elapsed < 6500, `elapsed=${elapsed}ms`);
    assert('_activeAttempts entry was freed',
           !map.has(ticketId), `still has entry`);
  }

  // ── Case 7: computeBackoff math
  console.log('\nCase 7: computeBackoff math (10000 / 20000 / 40000 cap)');
  {
    const cfg = {
      retry_backoff_min_ms: 10_000,
      retry_backoff_max_ms: 40_000,
    };
    assert('attempt=1 → 10000', computeBackoff(1, cfg) === 10_000,
           `got ${computeBackoff(1, cfg)}`);
    assert('attempt=2 → 20000', computeBackoff(2, cfg) === 20_000,
           `got ${computeBackoff(2, cfg)}`);
    assert('attempt=3 → 40000', computeBackoff(3, cfg) === 40_000,
           `got ${computeBackoff(3, cfg)}`);
    assert('attempt=4 → 40000 (capped)',
           computeBackoff(4, cfg) === 40_000,
           `got ${computeBackoff(4, cfg)}`);
    assert('attempt=10 → 40000 (capped)',
           computeBackoff(10, cfg) === 40_000,
           `got ${computeBackoff(10, cfg)}`);
  }

  // ── Case 8: hot-reload of stall_timeout_ms
  console.log('\nCase 8: hot-reload stall_timeout_ms via _workflow_config');
  {
    if (!originalConfigRow) {
      console.log('  SKIP (no _workflow_config row in test DB)');
    } else {
      // Set stall_timeout_ms = 60000 (1 minute) in _workflow_config.
      const updated = {
        ...originalConfigRow.data,
        stall_timeout_ms: 60_000,
        retry_backoff_min_ms: 10_000,
        retry_backoff_max_ms: 40_000,
        max_attempts: 3,
        paused: false,
      };
      await dbRun(
        `UPDATE table_rows SET data = $2::jsonb, updated_at = NOW()
          WHERE table_id = $1 AND id = $3`,
        [WORKFLOW_CONFIG_TABLE_ID, JSON.stringify(updated), originalConfigRow.id]
      );
      const newConfig = await loadConfig({ force: true });
      assert('config.stall_timeout_ms == 60000',
             newConfig.stall_timeout_ms === 60_000,
             `got ${newConfig.stall_timeout_ms}`);

      // 65s old ticket — beyond shrunk threshold, would NOT have stalled
      // under the 5min default.
      const sixtyFiveSec = new Date(Date.now() - 65_000).toISOString();
      const agentId = await insertRow(AGENTS_TABLE_ID, {
        name: 'Smoke Agent P6 hotreload', smoke_tag: SMOKE_TAG,
      });
      const ticketId = await insertRow(TICKETS_TABLE_ID, {
        state: STATE_BACKLOG,
        assigned_to: String(agentId),
        title: 'P6 hotreload',
        what: 'P6 hotreload',
        smoke_tag: SMOKE_TAG,
        run_state: 'running',
        run_attempt: 1,
        run_last_event_at: sixtyFiveSec,
      });
      await runStallDetect({ source: 'smoke_p6_case_8' });
      const data = await getTicketData(ticketId);
      assert('shrunken threshold marked 65s ticket stalled',
             data.run_state === 'retry_after', `got ${data?.run_state}`);
    }
  }

  // ── Case 9: end-to-end runTick — running ticket stalls into retry_after
  console.log('\nCase 9: runTick end-to-end → retry_after');
  {
    // Use default 300_000 stall_timeout_ms and a 10-min-old event.
    if (originalConfigRow) {
      const reset = {
        ...originalConfigRow.data,
        stall_timeout_ms: 300_000,
        retry_backoff_min_ms: 10_000,
        retry_backoff_max_ms: 40_000,
        max_attempts: 3,
        paused: false,
      };
      await dbRun(
        `UPDATE table_rows SET data = $2::jsonb, updated_at = NOW()
          WHERE table_id = $1 AND id = $3`,
        [WORKFLOW_CONFIG_TABLE_ID, JSON.stringify(reset), originalConfigRow.id]
      );
      await loadConfig({ force: true });
    }
    const { ticketId } = await makeStalledTicket({ runAttempt: 2, ageMinutes: 10 });
    const stats = await runTick({ source: 'smoke_p6_case_9' });
    assert('tick stats.stalled >= 1',
           stats.stalled >= 1, JSON.stringify(stats));
    assert('tick stats.stall_retried >= 1',
           stats.stall_retried >= 1, JSON.stringify(stats));
    const data = await getTicketData(ticketId);
    assert('runTick flipped ticket to retry_after',
           data.run_state === 'retry_after', `got ${data?.run_state}`);
    if (data.run_next_attempt_after) {
      const delay = Date.parse(data.run_next_attempt_after) - Date.now();
      // attempt=2 → ~20000ms backoff.
      assert('backoff ~20s for attempt=2',
             delay > 17_000 && delay < 22_000,
             `delay=${delay}ms`);
    }
  }

  // ── Case 10: retry pickup — claimReady picks ready, skips not-yet-due
  console.log('\nCase 10: retry pickup — past vs future run_next_attempt_after');
  {
    // Two retry_after tickets: one past-due, one future.
    const past = new Date(Date.now() - 30_000).toISOString();
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    const agentIdA = await insertRow(AGENTS_TABLE_ID, {
      name: 'P6 retry A', smoke_tag: SMOKE_TAG,
    });
    const agentIdB = await insertRow(AGENTS_TABLE_ID, {
      name: 'P6 retry B', smoke_tag: SMOKE_TAG,
    });
    const readyId = await insertRow(TICKETS_TABLE_ID, {
      state: STATE_BACKLOG,
      assigned_to: String(agentIdA),
      title: 'P6 retry ready',
      what: 'P6 retry ready',
      smoke_tag: SMOKE_TAG,
      run_state: 'retry_after',
      run_attempt: 1,
      run_next_attempt_after: past,
    });
    const notYetId = await insertRow(TICKETS_TABLE_ID, {
      state: STATE_BACKLOG,
      assigned_to: String(agentIdB),
      title: 'P6 retry not yet',
      what: 'P6 retry not yet',
      smoke_tag: SMOKE_TAG,
      run_state: 'retry_after',
      run_attempt: 1,
      run_next_attempt_after: future,
    });
    // RUN_DISPATCHER_PHASE='dryrun' — runTick will claim + cancel any
    // ready ticket. notYetId should NOT be claimed.
    const stats = await runTick({ source: 'smoke_p6_case_10' });
    assert('tick.picked >= 1', stats.picked >= 1, JSON.stringify(stats));
    const readyData = await getTicketData(readyId);
    const notYetData = await getTicketData(notYetId);
    assert('past-due retry was picked up (state moved off retry_after)',
           readyData.run_state !== 'retry_after',
           `got ${readyData?.run_state}`);
    assert('future retry was SKIPPED',
           notYetData.run_state === 'retry_after',
           `got ${notYetData?.run_state}`);
    assert('skipped ticket retains run_next_attempt_after',
           notYetData.run_next_attempt_after === future,
           `got ${notYetData?.run_next_attempt_after}`);
  }

  console.log(`\n${pass + fail} assertions: ${pass} pass / ${fail} fail`);
  if (fail === 0) console.log('all assertions passed');
}

main()
  .catch((err) => {
    console.error('SMOKE FAILED with exception:', err);
    fail++;
  })
  .finally(async () => {
    try { await cleanup(); } catch (err) { console.error('cleanup error:', err); }
    process.exit(fail === 0 ? 0 : 1);
  });
