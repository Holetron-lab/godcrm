#!/usr/bin/env node
/**
 * Smoke test for ADR-0030 Phase 4 — buildRunPrompt + runStreamHandler +
 * dispatcher 'live' phase.
 *
 * Runs against the LOCAL godcrm_test DB (per ADR-0009 isolation rules).
 * Does NOT hit PROD or DEV. Does NOT spawn the real `claude --print`
 * binary — every case uses a stub script via RUN_CLAUDE_SCRIPT_OVERRIDE.
 *
 * Cases:
 *   1. buildRunPrompt({ticketId, agentId}) returns prompt containing
 *      ticket title + agent name + role section.
 *   2. runStreamHandler with stub emitting 3 events, exit 0 → success
 *      summary, eventCount===3.
 *   3. runStreamHandler with stub emitting 1 event then exit 1 → failed
 *      summary with lastError populated.
 *   4. runStreamHandler with stub sleeping forever, timeoutMs=2000 →
 *      timeout summary.
 *   5. End-to-end: dispatcher tick with RUN_DISPATCHER_PHASE='live' and a
 *      stub script → ticket flips to run_state='succeeded',
 *      run_terminal_reason='completed'. Workspace destroyed in finally.
 *
 * Test ticket id range: 99980-99989 (P3 used 99990-99999).
 */

// ─── Force test DB + live phase BEFORE any module import ───────────
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_DB = 'godcrm_test';
process.env.POSTGRES_USER = 'godcrm';
process.env.POSTGRES_PASSWORD = 'godcrm_dev_2026';
process.env.POSTGRES_PORT = '5432';
process.env.AGENT_RUN_DISPATCHER_ENABLED = 'false'; // we drive ticks manually
process.env.RUN_DISPATCHER_PHASE = 'live';
process.env.NODE_ENV = 'test';
delete process.env.BUSINESS_CRM_IS_PROD;

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { buildRunPrompt } = await import(
  '../backend/services/agent-run-dispatcher/build-run-prompt.mjs'
);
const { runStreamHandler } = await import(
  '../backend/services/agent-run-dispatcher/run-stream-handler.mjs'
);
const { runTick } = await import(
  '../backend/services/agent-run-dispatcher/index.js'
);
const { destroyWorkspace } = await import(
  '../backend/services/agent-run-dispatcher/workspace-manager.js'
);
const { dbGet, dbRun } = await import('../backend/database/connection.js');

const TICKETS_TABLE_ID = 1708;
const AGENTS_TABLE_ID = 1784;
const STATE_BACKLOG = 24275;
const SMOKE_TAG = 'smoke-adr0030-p4';
// Concrete row ids assigned at insertion time — we let Postgres pick from the
// id_seq because the test DB lacks the PK constraint required for ON CONFLICT.
// Brief reserves 99980-99989 for tagging only; we filter by smoke_tag in cleanup.
const RUNTIME_IDS = {
  ticketPrompt: null,
  agentPrompt: null,
  ticketE2E: null,
  agentE2E: null,
};

let pass = 0;
let fail = 0;
const insertedRowIds = []; // track all rows we insert so cleanup nukes them
const stubFiles = [];      // track stub scripts so we can rm them

function assert(label, cond, extra = '') {
  if (cond) { console.log(`  PASS ${label}`); pass++; }
  else      { console.log(`  FAIL ${label} ${extra}`); fail++; }
}

function genBaseId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/**
 * Insert a row into table_rows. The id_seq picks the id; we capture and
 * return it. We can't force ids in 99980-99989 because the test DB lacks
 * the PK index needed for ON CONFLICT — we rely on smoke_tag for cleanup
 * instead.
 */
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

async function getTicketRunData(ticketId) {
  const row = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = $1 AND id = $2`,
    [TICKETS_TABLE_ID, ticketId]
  );
  if (!row?.data) return null;
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
}

/**
 * Write a stub script to a temp file, chmod +x, return path.
 */
async function writeStubScript(name, body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p4-stub-'));
  const file = path.join(dir, name);
  await fs.writeFile(file, body, { mode: 0o755 });
  // mkdtemp + writeFile may not honor mode on some hosts — chmod explicitly.
  await fs.chmod(file, 0o755);
  stubFiles.push(file);
  return file;
}

async function cleanup() {
  // Restore env so it doesn't leak.
  delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;

  // Nuke any workspaces we may have created via the live tick.
  if (RUNTIME_IDS.ticketE2E) {
    try { await destroyWorkspace(RUNTIME_IDS.ticketE2E); } catch { /* best-effort */ }
  }

  // Delete inserted table_rows.
  if (insertedRowIds.length > 0) {
    const ids = insertedRowIds.map((r) => r.id);
    await dbRun(
      `DELETE FROM table_rows WHERE id = ANY($1::int[])`,
      [ids]
    );
  }
  // Catch orphans by smoke_tag.
  await dbRun(
    `DELETE FROM table_rows WHERE data->>'smoke_tag' = $1`,
    [SMOKE_TAG]
  );

  // Best-effort: rm any messages we may have inserted (none expected for
  // case 5 because no conversation is bound — but cheap to clean by pattern).
  try {
    const e2e = RUNTIME_IDS.ticketE2E;
    const prompt = RUNTIME_IDS.ticketPrompt;
    const ids = [e2e, prompt].filter((x) => Number.isInteger(x));
    if (ids.length > 0) {
      await dbRun(
        `DELETE FROM messages WHERE bound_table_id = $1 AND bound_row_id = ANY($2::int[])`,
        [TICKETS_TABLE_ID, ids]
      );
    }
  } catch { /* messages may not have been written */ }

  // Remove stub scripts + their temp dirs.
  for (const f of stubFiles) {
    try {
      await fs.rm(path.dirname(f), { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
}

async function main() {
  console.log('ADR-0030 Phase 4 smoke test (godcrm_test) — start');
  console.log(`  RUN_DISPATCHER_PHASE=${process.env.RUN_DISPATCHER_PHASE}`);

  // Pre-flight: scrub anything left behind by prior interrupted runs.
  await dbRun(
    `DELETE FROM table_rows WHERE data->>'smoke_tag' = $1`,
    [SMOKE_TAG]
  );

  // ── Case 1: buildRunPrompt
  console.log('\nCase 1: buildRunPrompt returns prompt with ticket title + agent name');
  {
    RUNTIME_IDS.agentPrompt = await insertRow(AGENTS_TABLE_ID, {
      name: 'Smoke Agent Prompt',
      system_prompt: 'You write concise replies. SMOKE_AGENT_MARKER',
      smoke_tag: SMOKE_TAG,
    });
    RUNTIME_IDS.ticketPrompt = await insertRow(TICKETS_TABLE_ID, {
      state: STATE_BACKLOG,
      assigned_to: String(RUNTIME_IDS.agentPrompt),
      title: 'Smoke prompt ticket title XYZ',
      description: 'Some description body for smoke test',
      story: 'As a smoke test, I want a story field rendered.',
      smoke_tag: SMOKE_TAG,
      run_state: 'idle',
    });
    const result = await buildRunPrompt({
      ticketId: RUNTIME_IDS.ticketPrompt,
      agentId: RUNTIME_IDS.agentPrompt,
    });
    assert('prompt is string', typeof result.prompt === 'string' && result.prompt.length > 0);
    assert('contains ticket title', result.prompt.includes('Smoke prompt ticket title XYZ'),
           `prompt head: ${result.prompt.slice(0, 200)}`);
    assert('contains agent name', result.prompt.includes('Smoke Agent Prompt'));
    assert('contains agent system_prompt marker', result.prompt.includes('SMOKE_AGENT_MARKER'));
    assert('contains description section', result.prompt.includes('## Description'));
    assert('contains story section', result.prompt.includes('## Story'));
    assert('contains constraints section', result.prompt.includes('## Constraints'));
    assert('contains role header with agent name',
           result.prompt.includes('## Your role: Smoke Agent Prompt'));
    assert('returns agentRow', !!result.agentRow);
    assert('returns ticketRow', !!result.ticketRow);
    assert('returns resolvedAt ISO', typeof result.resolvedAt === 'string' && result.resolvedAt.length > 10);
  }

  // ── Case 2: stream handler — 3 events + exit 0 → success
  console.log('\nCase 2: runStreamHandler success path (3 events, exit 0)');
  {
    const stub = await writeStubScript('stub-success.sh', `#!/usr/bin/env bash
set -e
# Ignore args; consume stdin so caller's pipe doesn't block.
cat > /dev/null
echo '{"type":"info","message":"stub_started"}'
echo '{"type":"info","message":"stub_progress"}'
echo '{"type":"output","content":"hi from stub","status":"success","exit":0}'
exit 0
`);
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = stub;
    const events = [];
    const summary = await runStreamHandler({
      ticketId: 99980,
      workspacePath: '/tmp',
      prompt: 'hello',
      agentId: 0,
      onEvent: (e) => events.push(e),
      timeoutMs: 10_000,
      heartbeatMs: 50_000,
    });
    assert('exitCode === 0', summary.exitCode === 0, JSON.stringify(summary));
    assert('finalStatus === success', summary.finalStatus === 'success', JSON.stringify(summary));
    assert('eventCount === 3', summary.eventCount === 3, `got ${summary.eventCount}`);
    assert('events array length matches', events.length === 3, `got ${events.length}`);
    assert('no lastError on success', !summary.lastError, JSON.stringify(summary));
  }

  // ── Case 3: stream handler — 1 event then exit 1 → failed
  console.log('\nCase 3: runStreamHandler failed path (1 event, exit 1)');
  {
    const stub = await writeStubScript('stub-fail.sh', `#!/usr/bin/env bash
cat > /dev/null
echo '{"type":"info","message":"stub_about_to_fail"}'
echo "diagnostic line on stderr" >&2
echo "second stderr line" >&2
exit 1
`);
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = stub;
    const summary = await runStreamHandler({
      ticketId: 99980,
      workspacePath: '/tmp',
      prompt: 'hello',
      agentId: 0,
      timeoutMs: 10_000,
      heartbeatMs: 50_000,
    });
    assert('exitCode === 1', summary.exitCode === 1, JSON.stringify(summary));
    assert('finalStatus === failed', summary.finalStatus === 'failed', JSON.stringify(summary));
    assert('eventCount === 1', summary.eventCount === 1, `got ${summary.eventCount}`);
    assert('lastError populated', !!summary.lastError, JSON.stringify(summary));
    assert('lastError mentions diagnostic',
           summary.lastError && summary.lastError.includes('diagnostic'),
           JSON.stringify(summary.lastError));
  }

  // ── Case 4: stream handler — sleep forever, timeoutMs=2000
  console.log('\nCase 4: runStreamHandler timeout path');
  {
    const stub = await writeStubScript('stub-sleep.sh', `#!/usr/bin/env bash
cat > /dev/null
echo '{"type":"info","message":"stub_sleeping"}'
sleep 60
exit 0
`);
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = stub;
    const t0 = Date.now();
    const summary = await runStreamHandler({
      ticketId: 99980,
      workspacePath: '/tmp',
      prompt: 'hello',
      agentId: 0,
      timeoutMs: 2_000,
      heartbeatMs: 50_000,
    });
    const elapsed = Date.now() - t0;
    assert('finalStatus === timeout', summary.finalStatus === 'timeout', JSON.stringify(summary));
    assert('elapsed near timeoutMs (2-10s)', elapsed >= 2000 && elapsed < 10_000, `elapsed=${elapsed}ms`);
    assert('eventCount >= 1', summary.eventCount >= 1, JSON.stringify(summary));
  }

  // ── Case 5: end-to-end dispatcher tick with stub
  console.log('\nCase 5: end-to-end dispatcher tick → ticket flips to succeeded');
  {
    // Stub that just confirms the prompt arrived (cat to /dev/null) + emits
    // a tiny success result. Faster than running real claude.
    const stub = await writeStubScript('stub-e2e.sh', `#!/usr/bin/env bash
# Drain stdin so the parent's pipe doesn't block.
PROMPT=$(cat)
echo '{"type":"info","message":"e2e_stub_started"}'
# Emit an output event with a fixed string so we can verify chat-post path
# (will silently no-op since no conversation is bound).
echo '{"type":"output","content":"E2E stub output content.","status":"success","exit":0}'
echo '{"type":"result","status":"success","exit":0}'
exit 0
`);
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = stub;

    RUNTIME_IDS.agentE2E = await insertRow(AGENTS_TABLE_ID, {
      name: 'Smoke Agent E2E',
      system_prompt: 'Be brief.',
      smoke_tag: SMOKE_TAG,
    });
    RUNTIME_IDS.ticketE2E = await insertRow(TICKETS_TABLE_ID, {
      state: STATE_BACKLOG,
      assigned_to: String(RUNTIME_IDS.agentE2E),
      title: 'E2E phase4 smoke ticket',
      what: 'E2E phase4 smoke ticket',
      smoke_tag: SMOKE_TAG,
      run_state: 'idle',
    });

    const stats = await runTick({ source: 'smoke_p4_case_5' });
    assert('tick picked >= 1', stats.picked >= 1, JSON.stringify(stats));
    assert('tick reports live_succeeded >= 1',
           stats.live_succeeded >= 1, JSON.stringify(stats));
    assert('tick reports workspaces_created >= 1',
           stats.workspaces_created >= 1, JSON.stringify(stats));

    const data = await getTicketRunData(RUNTIME_IDS.ticketE2E);
    assert('ticket has data', !!data, 'ticket vanished');
    assert('run_state === succeeded',
           data.run_state === 'succeeded', `got ${data?.run_state}`);
    assert('run_terminal_reason === completed',
           data.run_terminal_reason === 'completed', `got ${data?.run_terminal_reason}`);
    assert('run_finished_at set', !!data.run_finished_at);
    assert('run_exit_code === 0', data.run_exit_code === 0, `got ${data?.run_exit_code}`);
    assert('run_duration_ms is number', typeof data.run_duration_ms === 'number');
    assert('run_event_count >= 3', (data.run_event_count ?? 0) >= 3, `got ${data?.run_event_count}`);

    // Audit log should record claim + start + terminal.
    const audit = data.run_audit_log || [];
    assert('audit has >= 3 entries', audit.length >= 3, `got ${audit.length}`);
    const startEntry = audit.find((e) => e.reason === 'live_run_started');
    assert('audit has live_run_started entry', !!startEntry);
    const terminalEntry = audit.find((e) => e.reason === 'completed');
    assert('audit has completed entry', !!terminalEntry);

    // Workspace must be cleaned up (Phase 4 owns lifecycle).
    let dirGone = false;
    try {
      await fs.access(`/root/workspaces/T-${RUNTIME_IDS.ticketE2E}`);
    } catch {
      dirGone = true;
    }
    assert('workspace dir removed after run', dirGone);
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
