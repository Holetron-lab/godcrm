#!/usr/bin/env node
/**
 * Smoke test for ADR-0030 Phase 3 — workspace_manager + dispatcher
 * `RUN_DISPATCHER_PHASE='workspace_only'` integration.
 *
 * Runs against the LOCAL godcrm_test DB (per ADR-0009 isolation rules).
 * Does NOT hit PROD or DEV remote.
 *
 * Cases:
 *   1. createWorkspace(99991) returns valid path; dir + branch exist.
 *   2. Calling createWorkspace(99991) twice — same result, no error.
 *   3. listWorkspaces() includes ticket 99991.
 *   4. destroyWorkspace(99991) removes worktree + branch.
 *   5. Repeat destroyWorkspace(99991) → { removed: false, reason: 'not_found' }.
 *   6. Parallel createWorkspace(99992 + 99993) — both succeed.
 *   7. Cleanup: destroy 99992, 99993.
 *   8. End-to-end: dispatcher tick with RUN_DISPATCHER_PHASE='workspace_only'
 *      flips test ticket → canceled with phase3_workspace_only +
 *      run_workspace_path set + workspace dir on disk.
 *
 * Cleanup: workspaces destroyed in finally; test ticket(s) deleted.
 */

// ─── Force test DB + workspace_only phase BEFORE any module import ─
process.env.POSTGRES_HOST = 'localhost';
process.env.POSTGRES_DB = 'godcrm_test';
process.env.POSTGRES_USER = 'godcrm';
process.env.POSTGRES_PASSWORD = 'godcrm_dev_2026';
process.env.POSTGRES_PORT = '5432';
process.env.AGENT_RUN_DISPATCHER_ENABLED = 'false'; // we drive ticks manually
process.env.RUN_DISPATCHER_PHASE = 'workspace_only';
process.env.NODE_ENV = 'test';
// `BUSINESS_CRM_IS_PROD` may be set on the host shell — explicitly clear it
// so the boot guard (if anything pulls in backend/test/setup.js indirectly)
// does not abort us. We otherwise mimic p2 smoke and don't import setup.js.
delete process.env.BUSINESS_CRM_IS_PROD;

import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const {
  createWorkspace,
  destroyWorkspace,
  listWorkspaces,
  workspaceHealth,
  WORKSPACE_ROOT,
  SOURCE_REPO,
} = await import('../backend/services/agent-run-dispatcher/workspace-manager.js');

const {
  runTick,
} = await import('../backend/services/agent-run-dispatcher/index.js');

const { dbGet, dbRun } = await import('../backend/database/connection.js');

const TICKETS_TABLE_ID = 1708;
const STATE_BACKLOG = 24275;
const SMOKE_TAG = 'smoke-adr0030-p3';
const ASSIGNED_TO = 'developer-ralph';

// Reserved test workspace IDs (99990–99999).
const TEST_IDS = {
  primary: 99991,
  parallelA: 99992,
  parallelB: 99993,
};

let pass = 0;
let fail = 0;
const createdTicketIds = [];
const createdWorkspaceIds = new Set();

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
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function createTestTicket() {
  const data = {
    state: STATE_BACKLOG,
    assigned_to: ASSIGNED_TO,
    what: SMOKE_TAG,
    created_by: 'manual-test',
    smoke_tag: SMOKE_TAG,
    run_state: 'idle',
  };
  const row = await dbGet(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING id`,
    [TICKETS_TABLE_ID, genBaseId(), JSON.stringify(data)]
  );
  createdTicketIds.push(row.id);
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

async function gitBranchExists(branch) {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: SOURCE_REPO,
    });
    return true;
  } catch {
    return false;
  }
}

async function dirExists(p) {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function cleanup() {
  // Destroy any workspaces we created (best-effort).
  for (const id of createdWorkspaceIds) {
    try {
      await destroyWorkspace(id);
    } catch (err) {
      console.error(`  cleanup: failed destroying workspace T-${id}:`, err.message);
    }
  }
  // Delete any tickets we created + any with our smoke tag (catches orphans).
  if (createdTicketIds.length > 0) {
    await dbRun(
      `DELETE FROM table_rows WHERE table_id = $1 AND id = ANY($2::int[])`,
      [TICKETS_TABLE_ID, createdTicketIds]
    );
  }
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = $1 AND data->>'smoke_tag' = $2`,
    [TICKETS_TABLE_ID, SMOKE_TAG]
  );
}

async function main() {
  console.log('ADR-0030 Phase 3 smoke test (godcrm_test) — start');
  console.log(`  WORKSPACE_ROOT=${WORKSPACE_ROOT}  RUN_DISPATCHER_PHASE=${process.env.RUN_DISPATCHER_PHASE}\n`);

  // Pre-flight: scrub anything left behind by prior interrupted runs.
  for (const id of Object.values(TEST_IDS)) {
    try { await destroyWorkspace(id); } catch { /* best-effort */ }
  }
  await dbRun(
    `DELETE FROM table_rows WHERE table_id = $1 AND data->>'smoke_tag' = $2`,
    [TICKETS_TABLE_ID, SMOKE_TAG]
  );

  // ── Case 1: createWorkspace returns valid path; dir + branch exist
  console.log('Case 1: createWorkspace(99991) creates worktree + branch');
  {
    const id = TEST_IDS.primary;
    const ws = await createWorkspace(id);
    createdWorkspaceIds.add(id);
    assert('returns path', typeof ws.path === 'string' && ws.path.length > 0, JSON.stringify(ws));
    assert('returns branch', ws.branch === `run/T-${id}`, `got ${ws.branch}`);
    assert('returns createdAt', !!ws.createdAt);
    assert('path is /root/workspaces/T-99991', ws.path === `/root/workspaces/T-${id}`, ws.path);
    assert('dir exists on disk', await dirExists(ws.path));
    assert('branch exists in git', await gitBranchExists(`run/T-${id}`));
  }

  // ── Case 2: Idempotent — second call returns same result
  console.log('\nCase 2: second createWorkspace(99991) returns same workspace (idempotent)');
  {
    const id = TEST_IDS.primary;
    const ws = await createWorkspace(id);
    assert('same path on second call', ws.path === `/root/workspaces/T-${id}`, ws.path);
    assert('same branch on second call', ws.branch === `run/T-${id}`);
    assert('reused flag set', ws.reused === true, `reused=${ws.reused}`);
  }

  // ── Case 3: listWorkspaces includes our workspace
  console.log('\nCase 3: listWorkspaces() includes ticket 99991');
  {
    const list = await listWorkspaces();
    assert('list is array', Array.isArray(list));
    const found = list.find((w) => w.ticketId === TEST_IDS.primary);
    assert('found T-99991 in list', !!found, `list ids=${list.map(w => w.ticketId).join(',')}`);
    if (found) {
      assert('list entry has correct branch', found.branch === `run/T-${TEST_IDS.primary}`, found.branch);
      assert('list entry has correct path', found.path === `/root/workspaces/T-${TEST_IDS.primary}`);
    }
  }

  // ── Case 4: destroyWorkspace removes worktree + branch
  console.log('\nCase 4: destroyWorkspace(99991) removes worktree + branch');
  {
    const id = TEST_IDS.primary;
    const res = await destroyWorkspace(id);
    createdWorkspaceIds.delete(id);
    assert('returns removed=true', res.removed === true, JSON.stringify(res));
    assert('dir gone from disk', !(await dirExists(`/root/workspaces/T-${id}`)));
    assert('branch gone from git', !(await gitBranchExists(`run/T-${id}`)));
    const list = await listWorkspaces();
    assert('list no longer contains 99991', !list.find((w) => w.ticketId === id));
  }

  // ── Case 5: Idempotent destroy
  console.log('\nCase 5: second destroyWorkspace(99991) returns not_found');
  {
    const id = TEST_IDS.primary;
    const res = await destroyWorkspace(id);
    assert('removed=false', res.removed === false, JSON.stringify(res));
    assert('reason=not_found', res.reason === 'not_found', JSON.stringify(res));
  }

  // ── Case 6: parallel creates
  console.log('\nCase 6: parallel createWorkspace(99992 + 99993)');
  {
    const [a, b] = await Promise.all([
      createWorkspace(TEST_IDS.parallelA),
      createWorkspace(TEST_IDS.parallelB),
    ]);
    createdWorkspaceIds.add(TEST_IDS.parallelA);
    createdWorkspaceIds.add(TEST_IDS.parallelB);
    assert('A path correct', a.path === `/root/workspaces/T-${TEST_IDS.parallelA}`, a.path);
    assert('B path correct', b.path === `/root/workspaces/T-${TEST_IDS.parallelB}`, b.path);
    assert('A branch correct', a.branch === `run/T-${TEST_IDS.parallelA}`);
    assert('B branch correct', b.branch === `run/T-${TEST_IDS.parallelB}`);
    assert('A dir exists', await dirExists(a.path));
    assert('B dir exists', await dirExists(b.path));
    assert('paths distinct', a.path !== b.path);
  }

  // ── Case 7: cleanup of parallel pair
  console.log('\nCase 7: destroy parallel pair');
  {
    const ra = await destroyWorkspace(TEST_IDS.parallelA);
    const rb = await destroyWorkspace(TEST_IDS.parallelB);
    createdWorkspaceIds.delete(TEST_IDS.parallelA);
    createdWorkspaceIds.delete(TEST_IDS.parallelB);
    assert('A removed=true', ra.removed === true, JSON.stringify(ra));
    assert('B removed=true', rb.removed === true, JSON.stringify(rb));
    assert('A dir gone', !(await dirExists(`/root/workspaces/T-${TEST_IDS.parallelA}`)));
    assert('B dir gone', !(await dirExists(`/root/workspaces/T-${TEST_IDS.parallelB}`)));
  }

  // ── Case 8: dispatcher end-to-end with workspace_only phase
  console.log('\nCase 8: dispatcher tick → workspace materialized + ticket canceled');
  {
    const ticketId = await createTestTicket();
    const stats = await runTick({ source: 'smoke_p3_case_8' });
    assert('tick picked >= 1', stats.picked >= 1, JSON.stringify(stats));
    assert('tick reports workspaces_created >= 1', stats.workspaces_created >= 1, JSON.stringify(stats));
    assert('tick reports canceled_workspace_only >= 1', stats.canceled_workspace_only >= 1, JSON.stringify(stats));

    const data = await getTicketRunData(ticketId);
    assert('ticket run_state == canceled', data.run_state === 'canceled', `got ${data.run_state}`);
    assert(
      'ticket terminal_reason == phase3_workspace_only',
      data.run_terminal_reason === 'phase3_workspace_only',
      `got ${data.run_terminal_reason}`
    );
    assert('ticket has run_workspace_path', !!data.run_workspace_path, `got ${data.run_workspace_path}`);
    assert(
      'workspace path matches expected pattern',
      data.run_workspace_path && data.run_workspace_path.startsWith(`/root/workspaces/T-`),
      data.run_workspace_path
    );
    assert('workspace dir exists on disk', await dirExists(data.run_workspace_path));

    // Audit log should record both transitions w/ workspace info on the cancel entry.
    const audit = data.run_audit_log || [];
    assert('audit log has >= 2 entries', audit.length >= 2, `got ${audit.length}`);
    const cancelEntry = audit.find((e) => e.reason === 'phase3_workspace_only');
    assert('audit log includes phase3_workspace_only reason', !!cancelEntry);
    if (cancelEntry) {
      assert('cancel audit entry carries workspace_path', !!cancelEntry.workspace_path);
      assert('cancel audit entry carries branch', !!cancelEntry.branch);
    }

    // Cleanup: the dispatcher does NOT remove the workspace in P3 (Phase 4
    // owns lifecycle). We track it here for the finally block to nuke.
    if (data.run_workspace_path) {
      const m = data.run_workspace_path.match(/T-(\d+)$/);
      if (m) createdWorkspaceIds.add(Number(m[1]));
    }
  }

  // ── workspaceHealth sanity
  console.log('\nBonus: workspaceHealth() reports root + counts');
  {
    const h = await workspaceHealth();
    assert('health.ok == true', h.ok === true, JSON.stringify(h));
    assert('health.workspaceRoot set', h.workspaceRoot === '/root/workspaces', h.workspaceRoot);
    assert('health.count is numeric', typeof h.count === 'number');
    assert('health.orphaned is array', Array.isArray(h.orphaned));
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
    try {
      await cleanup();
    } catch (err) {
      console.error('cleanup error:', err);
    }
    process.exit(fail === 0 ? 0 : 1);
  });
