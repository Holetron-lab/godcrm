#!/usr/bin/env node
/**
 * Smoke test for ADR-0030 Phase 5 — TOTP approval gate.
 *
 * Runs against the LOCAL godcrm_test DB (per ADR-0009 isolation rules).
 * Does NOT hit PROD or DEV. Does NOT spawn the real `claude --print`
 * binary — case 10 uses a stub via RUN_CLAUDE_SCRIPT_OVERRIDE.
 *
 * Cases (10 total):
 *   1. generateApprovalCode — shape + hash matches.
 *   2. timingSafeHashEqual — equal hashes pass; mismatched / malformed fail.
 *   3. persistApprovalRequest → readApprovalState round-trip + run_state flip.
 *   4. resolveApproval('approved') → run_state='preparing', resolved_at set.
 *   5. resolveApproval('denied')  → run_state='failed', terminal='approval_denied'.
 *   6. resolveApproval('expired') → run_state='failed', terminal='approval_timeout'.
 *   7. recordAttempt — 5 wrong attempts auto-deny (state='denied').
 *   8. awaitApproval — already-approved short-circuits immediately.
 *   9. awaitApproval — TTL elapsed → outcome='expired', state persisted.
 *   10. End-to-end: dispatcher tick with RUN_REQUIRE_APPROVAL='true' and stub
 *       claude → ticket reaches 'awaiting_approval'; in-flight resolveApproval
 *       unblocks the gate; final run_state='succeeded' + audit log carries
 *       'approval_required' and 'approval_granted' entries.
 */

// ─── Force test DB + live phase BEFORE any module import ───────────
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_DB = 'godcrm_test';
process.env.POSTGRES_USER = 'godcrm';
process.env.POSTGRES_PASSWORD = 'godcrm_dev_2026';
process.env.POSTGRES_PORT = '5432';
process.env.AGENT_RUN_DISPATCHER_ENABLED = 'false'; // we drive ticks manually
process.env.RUN_DISPATCHER_PHASE = 'live';
process.env.RUN_REQUIRE_APPROVAL = 'true';
process.env.NODE_ENV = 'test';
delete process.env.BUSINESS_CRM_IS_PROD;

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const approval = await import(
  '../backend/services/agent-run-dispatcher/approval-gate.js'
);
const {
  generateApprovalCode,
  hashCode,
  timingSafeHashEqual,
  persistApprovalRequest,
  readApprovalState,
  recordAttempt,
  resolveApproval,
  awaitApproval,
  APPROVAL_OUTCOMES,
} = approval;

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
const SMOKE_TAG = 'smoke-adr0030-p5';

let pass = 0;
let fail = 0;
const insertedRowIds = []; // { table_id, id }
const stubFiles = [];
const e2eTicketIds = [];   // tickets that may have created workspaces

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

async function makeTicketAwaitingApproval({ overrideExpires = null } = {}) {
  const agentId = await insertRow(AGENTS_TABLE_ID, {
    name: 'Smoke Agent P5',
    system_prompt: 'Be brief.',
    smoke_tag: SMOKE_TAG,
  });
  const ticketId = await insertRow(TICKETS_TABLE_ID, {
    state: STATE_BACKLOG,
    assigned_to: String(agentId),
    title: 'P5 smoke ticket',
    what: 'P5 smoke ticket',
    smoke_tag: SMOKE_TAG,
    run_state: 'preparing',
    run_attempt: 1,
  });
  const { code, code_hash, expires_at, generated_at } = generateApprovalCode();
  const finalExpires = overrideExpires || expires_at;
  await persistApprovalRequest(ticketId, {
    code_hash,
    expires_at: finalExpires,
    generated_at,
  });
  return { agentId, ticketId, code, code_hash, expires_at: finalExpires };
}

async function writeStubScript(name, body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p5-stub-'));
  const file = path.join(dir, name);
  await fs.writeFile(file, body, { mode: 0o755 });
  await fs.chmod(file, 0o755);
  stubFiles.push(file);
  return file;
}

async function cleanup() {
  delete process.env.RUN_CLAUDE_SCRIPT_OVERRIDE;

  // Clean any workspaces we may have created.
  for (const id of e2eTicketIds) {
    try { await destroyWorkspace(id); } catch { /* best-effort */ }
  }

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

  for (const f of stubFiles) {
    try {
      await fs.rm(path.dirname(f), { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
}

async function main() {
  console.log('ADR-0030 Phase 5 smoke test (godcrm_test) — start');
  console.log(`  RUN_REQUIRE_APPROVAL=${process.env.RUN_REQUIRE_APPROVAL}`);
  console.log(`  RUN_DISPATCHER_PHASE=${process.env.RUN_DISPATCHER_PHASE}`);

  // Pre-flight scrub.
  await dbRun(
    `DELETE FROM table_rows WHERE data->>'smoke_tag' = $1`,
    [SMOKE_TAG]
  );

  // ── Case 1: generateApprovalCode shape
  console.log('\nCase 1: generateApprovalCode shape + hash');
  {
    const a = generateApprovalCode();
    assert('code is 6 digits', /^\d{6}$/.test(a.code), `got ${a.code}`);
    assert('code_hash is 64 hex chars', /^[0-9a-f]{64}$/.test(a.code_hash));
    assert('hash matches code', a.code_hash === hashCode(a.code));
    assert('expires_at parseable', !Number.isNaN(Date.parse(a.expires_at)));
    assert('generated_at parseable', !Number.isNaN(Date.parse(a.generated_at)));
    const ttlMs = Date.parse(a.expires_at) - Date.parse(a.generated_at);
    assert('ttl ~10 min', ttlMs > 9 * 60_000 && ttlMs < 11 * 60_000, `ttlMs=${ttlMs}`);
    // Sanity: two consecutive codes should almost always differ.
    const b = generateApprovalCode();
    assert('two consecutive codes differ', a.code !== b.code);
  }

  // ── Case 2: timingSafeHashEqual edge cases
  console.log('\nCase 2: timingSafeHashEqual edge cases');
  {
    const h = hashCode('123456');
    assert('equal hashes match', timingSafeHashEqual(h, h));
    assert('different hashes mismatch', !timingSafeHashEqual(h, hashCode('654321')));
    assert('non-hex returns false', !timingSafeHashEqual(h, 'z'.repeat(64)));
    assert('short string returns false', !timingSafeHashEqual(h, 'abc'));
    assert('null returns false', !timingSafeHashEqual(h, null));
    assert('non-string returns false', !timingSafeHashEqual(h, 12345));
  }

  // ── Case 3: persistApprovalRequest → readApprovalState round-trip
  console.log('\nCase 3: persist + read round-trip + run_state flip');
  {
    const { ticketId, code_hash, expires_at } = await makeTicketAwaitingApproval();
    const view = await readApprovalState(ticketId);
    assert('view present', view.present);
    assert('view.state === pending', view.state === 'pending');
    assert('view.attempts === 0', view.attempts === 0);
    assert('view.code_hash matches', view.code_hash === code_hash);
    assert('view.expires_at matches', view.expires_at === expires_at);
    assert('view.run_state === awaiting_approval',
           view.run_state === 'awaiting_approval', `got ${view.run_state}`);
    assert('view.expired === false', view.expired === false);

    const data = await getTicketData(ticketId);
    assert('ticket.run_state === awaiting_approval',
           data.run_state === 'awaiting_approval', `got ${data?.run_state}`);
    assert('ticket.run_approval object present', !!data.run_approval);
    assert('ticket.run_approval.code_hash redacted from logs (still on row)',
           data.run_approval.code_hash === code_hash);
  }

  // ── Case 4: resolveApproval('approved') → run_state='preparing'
  console.log('\nCase 4: resolveApproval(approved)');
  {
    const { ticketId } = await makeTicketAwaitingApproval();
    await resolveApproval(ticketId, { state: 'approved', resolved_by: 1 });
    const data = await getTicketData(ticketId);
    assert('run_state === preparing', data.run_state === 'preparing', `got ${data?.run_state}`);
    assert('run_approval.state === approved', data.run_approval?.state === 'approved');
    assert('run_approval.resolved_at set', !!data.run_approval?.resolved_at);
    assert('run_approval.resolved_by === 1', data.run_approval?.resolved_by === 1);
    assert('run_terminal_reason NOT set', !data.run_terminal_reason);
  }

  // ── Case 5: resolveApproval('denied') → run_state='failed', terminal='approval_denied'
  console.log('\nCase 5: resolveApproval(denied)');
  {
    const { ticketId } = await makeTicketAwaitingApproval();
    await resolveApproval(ticketId, { state: 'denied', resolved_by: 1, reason: 'explicit_deny' });
    const data = await getTicketData(ticketId);
    assert('run_state === failed', data.run_state === 'failed', `got ${data?.run_state}`);
    assert('run_terminal_reason === approval_denied',
           data.run_terminal_reason === 'approval_denied',
           `got ${data?.run_terminal_reason}`);
    assert('run_finished_at set', !!data.run_finished_at);
    assert('run_approval.state === denied', data.run_approval?.state === 'denied');
  }

  // ── Case 6: resolveApproval('expired') → run_state='failed', terminal='approval_timeout'
  console.log('\nCase 6: resolveApproval(expired)');
  {
    const { ticketId } = await makeTicketAwaitingApproval();
    await resolveApproval(ticketId, { state: 'expired', reason: 'ttl_elapsed' });
    const data = await getTicketData(ticketId);
    assert('run_state === failed', data.run_state === 'failed', `got ${data?.run_state}`);
    assert('run_terminal_reason === approval_timeout',
           data.run_terminal_reason === 'approval_timeout',
           `got ${data?.run_terminal_reason}`);
    assert('run_approval.state === expired', data.run_approval?.state === 'expired');
  }

  // ── Case 7: recordAttempt — 5 wrong attempts auto-deny
  console.log('\nCase 7: recordAttempt 5x wrong → auto-deny');
  {
    const { ticketId } = await makeTicketAwaitingApproval();
    let last;
    for (let i = 1; i <= 5; i++) {
      last = await recordAttempt(ticketId, false);
    }
    assert('attempts === 5', last.attempts === 5, JSON.stringify(last));
    assert('state === denied (auto)', last.state === 'denied', JSON.stringify(last));
    assert('attempts_remaining === 0', last.attempts_remaining === 0);
    const data = await getTicketData(ticketId);
    assert('run_state flipped to failed after auto-deny',
           data.run_state === 'failed', `got ${data?.run_state}`);
    assert('terminal_reason === approval_denied (auto)',
           data.run_terminal_reason === 'approval_denied');
  }

  // ── Case 8: awaitApproval — already-approved short-circuit
  console.log('\nCase 8: awaitApproval short-circuits on already-approved');
  {
    const { ticketId } = await makeTicketAwaitingApproval();
    await resolveApproval(ticketId, { state: 'approved', resolved_by: 1 });
    const t0 = Date.now();
    const result = await awaitApproval(ticketId, { pollMs: 500, timeoutMs: 30_000 });
    const elapsed = Date.now() - t0;
    assert('outcome === approved', result.outcome === APPROVAL_OUTCOMES.APPROVED);
    assert('returns within 1s (no poll wait)', elapsed < 1000, `elapsed=${elapsed}ms`);
  }

  // ── Case 9: awaitApproval — TTL elapsed → expired, state persisted
  console.log('\nCase 9: awaitApproval TTL elapsed → expired');
  {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const { ticketId } = await makeTicketAwaitingApproval({ overrideExpires: expiredAt });
    const t0 = Date.now();
    const result = await awaitApproval(ticketId, { pollMs: 500, timeoutMs: 30_000 });
    const elapsed = Date.now() - t0;
    assert('outcome === expired', result.outcome === APPROVAL_OUTCOMES.EXPIRED, JSON.stringify(result));
    assert('returns fast (TTL already past)', elapsed < 1500, `elapsed=${elapsed}ms`);
    const data = await getTicketData(ticketId);
    assert('run_approval.state persisted as expired',
           data.run_approval?.state === 'expired', `got ${data?.run_approval?.state}`);
    assert('run_state flipped to failed',
           data.run_state === 'failed', `got ${data?.run_state}`);
    assert('terminal_reason === approval_timeout',
           data.run_terminal_reason === 'approval_timeout');
  }

  // ── Case 10: end-to-end dispatcher tick with stub claude + in-flight approve
  console.log('\nCase 10: end-to-end tick — gate fires, in-flight approve, run completes');
  {
    const stub = await writeStubScript('stub-p5.sh', `#!/usr/bin/env bash
PROMPT=$(cat)
echo '{"type":"info","message":"p5_stub_started"}'
echo '{"type":"output","content":"P5 stub output content.","status":"success","exit":0}'
echo '{"type":"result","status":"success","exit":0}'
exit 0
`);
    process.env.RUN_CLAUDE_SCRIPT_OVERRIDE = stub;

    const agentId = await insertRow(AGENTS_TABLE_ID, {
      name: 'Smoke Agent P5 E2E',
      system_prompt: 'Be brief.',
      smoke_tag: SMOKE_TAG,
    });
    const ticketId = await insertRow(TICKETS_TABLE_ID, {
      state: STATE_BACKLOG,
      assigned_to: String(agentId),
      title: 'P5 e2e smoke ticket',
      what: 'P5 e2e smoke ticket',
      smoke_tag: SMOKE_TAG,
      run_state: 'idle',
    });
    e2eTicketIds.push(ticketId);

    // Kick the tick — runs in background; we'll resolve the gate from outside.
    const tickPromise = runTick({ source: 'smoke_p5_case_10' });

    // Poll until ticket reaches awaiting_approval (gate persisted).
    let gateSeen = false;
    const pollDeadline = Date.now() + 30_000;
    while (Date.now() < pollDeadline) {
      const view = await readApprovalState(ticketId);
      if (view.present && view.run_state === 'awaiting_approval') {
        gateSeen = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert('gate fired (run_state hit awaiting_approval)', gateSeen,
           'never observed awaiting_approval within 30s');

    if (gateSeen) {
      // Simulate operator approve (bypassing API since we already trust the
      // function — case 4 covers approve mechanics).
      await resolveApproval(ticketId, { state: 'approved', resolved_by: 1 });
    }

    // Now the tick should finish.
    const stats = await tickPromise;
    assert('tick reports awaiting_approval >= 1',
           stats.awaiting_approval >= 1, JSON.stringify(stats));
    assert('tick reports approval_approved >= 1',
           stats.approval_approved >= 1, JSON.stringify(stats));
    assert('tick reports live_succeeded >= 1',
           stats.live_succeeded >= 1, JSON.stringify(stats));

    const data = await getTicketData(ticketId);
    assert('final run_state === succeeded',
           data.run_state === 'succeeded', `got ${data?.run_state}`);
    assert('run_terminal_reason === completed',
           data.run_terminal_reason === 'completed', `got ${data?.run_terminal_reason}`);

    const audit = data.run_audit_log || [];
    const approvalReq = audit.find((e) => e.reason === 'approval_required');
    const approvalGranted = audit.find((e) => e.reason === 'approval_granted');
    const completed = audit.find((e) => e.reason === 'completed');
    assert('audit contains approval_required entry', !!approvalReq, JSON.stringify(audit));
    assert('audit contains approval_granted entry', !!approvalGranted, JSON.stringify(audit));
    assert('audit contains completed entry', !!completed, JSON.stringify(audit));

    // Spot-check the approval_required entry has expires_at, no plaintext code.
    if (approvalReq) {
      assert('approval_required carries expires_at', !!approvalReq.expires_at);
      assert('approval_required does NOT carry plaintext code',
             !('code' in approvalReq) && !approvalReq.code,
             JSON.stringify(approvalReq));
    }

    // Workspace must be cleaned up.
    let dirGone = false;
    try {
      await fs.access(`/root/workspaces/T-${ticketId}`);
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
