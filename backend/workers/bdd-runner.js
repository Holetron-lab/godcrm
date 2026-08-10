#!/usr/bin/env node
/**
 * ADR-156 Phase 5A: BDD test runner worker
 *
 * Responsibilities:
 *   1. LISTEN on Postgres channels `bdd.test_run.queued` and
 *      `bdd.criterion.claim_requested`. Any notification triggers a poll pass.
 *   2. Poll `bdd_test_runs` logical rows where data.status='queued', claim
 *      one, execute its parent `bdd_tests.command` in a strict sandbox with a
 *      30-second timeout.
 *   3. POST the result back to /api/v3/bdd/tests/:id/runs with an internal
 *      JWT so the normal server-side state machine (claim/fail/disable)
 *      takes over.
 *
 * This is a SCAFFOLD (ADR-156 Phase 5A). It is intentionally conservative:
 *   - command must match an allowlist regex (npm|npx|curl|pytest|mcp|claude)
 *   - child runs with shell:false, scrubbed env, cwd=/tmp
 *   - if the process starts as root, drop to uid/gid 'nobody'
 *   - stdout/stderr are tailed to the last 4KB
 *   - timeout kills the process tree
 */

import { config } from '../config.js';

import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import jwt from 'jsonwebtoken';
import pg from 'pg';

import { dbGet, dbAll, dbRun, sqlNow, getAdapter } from '../database/connection.js';
import { generateBaseId } from '../utils/baseId.js';
import { logger } from '../utils/logger.js';
import { gateBash, gateSql, gateMcp } from './bdd-gates.js';

const log = logger.child({ worker: 'bdd-runner' });

const PORT = config.PORT || 5000;
const SELF_BASE_URL = process.env.BDD_WORKER_BASE_URL || `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || config.JWT_SECRET;
const INTERNAL_USER_ID = parseInt(process.env.BDD_WORKER_USER_ID || '1', 10);
const POLL_INTERVAL_MS = parseInt(process.env.BDD_WORKER_POLL_MS || '15000', 10);
const EXEC_TIMEOUT_MS = parseInt(process.env.BDD_WORKER_EXEC_MS || '30000', 10);
const TAIL_BYTES = 4096;
const BDD_SPACE_ID = 11;

// ADR-156 Appendix C §2.1 — per-runner gates live in ./bdd-gates.js. The old
// single-binary prefix allowlist is superseded but preserved here as a last-
// ditch fallback when a test has no runner kind recorded (legacy rows from
// iteration 1). New rows MUST set data.runner to bash|sql|mcp|http.
const LEGACY_COMMAND_ALLOWLIST = /^(npm|npx|curl|pytest|mcp|claude)( |$)/;

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Table-id resolution (same approach as backend/routes/v3/bdd.js)
// ---------------------------------------------------------------------------
const tableIdCache = new Map();
async function getBddTableId(name) {
  if (tableIdCache.has(name)) return tableIdCache.get(name);
  const row = await dbGet(`
    SELECT ut.id
    FROM universal_tables ut
    JOIN projects p ON ut.project_id = p.id
    WHERE p.space_id = ? AND ut.name = ?
    ORDER BY ut.id ASC
    LIMIT 1
  `, [BDD_SPACE_ID, name]);
  if (row?.id) {
    tableIdCache.set(name, row.id);
    return row.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// JWT for self-POST
// ---------------------------------------------------------------------------
function issueInternalJwt() {
  return jwt.sign(
    { id: INTERNAL_USER_ID, email: 'bdd-runner@internal', role: 'system' },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
}

// ---------------------------------------------------------------------------
// Sandbox exec
// ---------------------------------------------------------------------------

/**
 * Parse a command string into [bin, ...args] without a shell.
 * NOTE: This is a naive whitespace split; commands requiring quotes/pipes are
 * rejected by the allowlist + the presence of shell metacharacters.
 */
function splitCommand(cmd) {
  const SHELL_METACHARS = /[|&;`$(){}<>\\]/;
  if (SHELL_METACHARS.test(cmd)) {
    throw new Error('command contains shell metacharacters');
  }
  const parts = cmd.trim().split(/\s+/);
  if (parts.length === 0) throw new Error('empty command');
  return parts;
}

function tailBuffer(buf, n = TAIL_BYTES) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(String(buf || ''), 'utf8');
  if (buf.length <= n) return buf.toString('utf8');
  return buf.subarray(buf.length - n).toString('utf8');
}

/**
 * Apply the per-runner security gate (ADR-156 Appendix C §2.1). Returns null
 * if the command is allowed, or an error result if it is not.
 *
 * `test` here is the shape returned by getTestCommand().
 */
function applyRunnerGate(test, command) {
  const runner = (test && test.runner) || 'bash';
  const cfg = (test && test.runner_config) || {};

  let gate;
  switch (runner) {
    case 'bash':
      gate = gateBash(command, cfg.allow || []);
      break;
    case 'sql':
      gate = gateSql(command);
      break;
    case 'mcp': {
      // MCP command format: `tool_name {json_args}`. Extract leading token.
      const toolName = String(command).trim().split(/\s+/, 1)[0] || '';
      gate = gateMcp(toolName, cfg.tools || []);
      break;
    }
    case 'http':
      // No gate yet for http runner — built-in probe validates URL itself.
      return null;
    default:
      // Legacy rows with no runner kind → fall back to the old prefix allowlist
      // so we don't strand iteration-1 fixtures.
      if (!LEGACY_COMMAND_ALLOWLIST.test(String(command).trim())) {
        return {
          status: 'error', exit_code: null, duration_ms: 0,
          stdout_tail: '',
          stderr_tail: `unknown runner "${runner}" and legacy allowlist miss: ${String(command).slice(0, 120)}`,
        };
      }
      return null;
  }
  if (gate && gate.ok === false) {
    return {
      status: 'error', exit_code: null, duration_ms: 0,
      stdout_tail: '',
      stderr_tail: `gate ${runner}: ${gate.reason}`,
    };
  }
  return null;
}

/**
 * Execute a SELECT-only SQL statement against the dedicated read-only role
 * (ADR-156 Appendix C §2.1 "sql runner"). Uses DATABASE_URL_RO if set, else
 * falls back to the worker's POSTGRES_* env with user=bdd_readonly.
 *
 * The gate has already validated the statement is SELECT/WITH-SELECT shaped.
 */
async function executeSql(sql) {
  const started = Date.now();
  const { Client } = pg;
  const connConfig = process.env.DATABASE_URL_RO
    ? { connectionString: process.env.DATABASE_URL_RO }
    : {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'godcrm_prod',
        user: process.env.BDD_RO_USER || 'bdd_readonly',
        password: process.env.BDD_RO_PASSWORD || process.env.POSTGRES_PASSWORD,
      };
  const client = new Client(connConfig);
  try {
    await client.connect();
    // Enforce statement timeout even if the gate missed something long-running.
    await client.query("SET statement_timeout = '5000ms'");
    const res = await client.query(sql);
    const rowsJson = JSON.stringify(res.rows || []);
    return {
      status: 'passed', exit_code: 0,
      duration_ms: Date.now() - started,
      stdout_tail: rowsJson.length > TAIL_BYTES ? rowsJson.slice(-TAIL_BYTES) : rowsJson,
      stderr_tail: '',
    };
  } catch (e) {
    return {
      status: 'failed', exit_code: null,
      duration_ms: Date.now() - started,
      stdout_tail: '',
      stderr_tail: `sql: ${e.message}`.slice(-TAIL_BYTES),
    };
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

/**
 * Execute an HTTP probe (ADR-156 Phase 5A §2.1 "http runner").
 *
 * Contract:
 *   - Fetch test.target with test.method/headers/body and a timeout.
 *   - Read the response body as text (we trim both sides for equals checks;
 *     this is deliberate so upstream whitespace/trailing-newline drift between
 *     servers doesn't flake an otherwise-correct body match).
 *   - If test.expected_signal.equals is set → strict string equality check
 *     (after .trim() on BOTH sides). Records {expected, actual, matched} in
 *     assertion_result.
 *   - If test.expected_signal.status is set (number) → exact HTTP status match;
 *     otherwise the default "OK range" is 200-299.
 *   - status='passed' iff (equals check matched OR no equals provided) AND
 *     HTTP status is in the expected range.
 *   - On failure, assertion_result is still populated so consumers can debug.
 */
async function executeHttp(test) {
  const started = Date.now();
  const target = typeof test.target === 'string' ? test.target.trim() : '';
  if (!target) {
    return {
      status: 'error', exit_code: null, duration_ms: 0,
      stdout_tail: '', stderr_tail: 'http runner: missing target URL',
      assertion_result: { expected: null, actual: null, matched: false },
    };
  }

  const method = (test.method || 'GET').toString().toUpperCase();
  const headers = (test.headers && typeof test.headers === 'object') ? test.headers : {};
  const body = test.body ?? undefined;
  const expectedSignal = test.expected_signal && typeof test.expected_signal === 'object'
    ? test.expected_signal : null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXEC_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(target, {
      method,
      headers,
      body: (method === 'GET' || method === 'HEAD') ? undefined : body,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const duration_ms = Date.now() - started;
    const aborted = e.name === 'AbortError' || /abort/i.test(e.message || '');
    return {
      status: aborted ? 'timeout' : 'error',
      exit_code: null,
      duration_ms,
      stdout_tail: '',
      stderr_tail: `http: ${e.message || String(e)}`.slice(-TAIL_BYTES),
      assertion_result: { expected: expectedSignal, actual: null, matched: false },
    };
  }
  clearTimeout(timer);

  let text = '';
  try { text = await resp.text(); } catch { /* ignore */ }

  const duration_ms = Date.now() - started;
  const httpStatus = resp.status;

  // Status range check (default 2xx; override with expected_signal.status).
  let statusOk;
  if (expectedSignal && typeof expectedSignal.status === 'number') {
    statusOk = httpStatus === expectedSignal.status;
  } else {
    statusOk = httpStatus >= 200 && httpStatus <= 299;
  }

  // Equals check (trim both sides — see contract above).
  let equalsMatched = true; // no equals provided ⇒ vacuously true
  let expected = null;
  let actual = text;
  if (expectedSignal && typeof expectedSignal.equals === 'string') {
    expected = expectedSignal.equals;
    const a = (text || '').trim();
    const e = expected.trim();
    equalsMatched = a === e;
    actual = text;
  }

  const matched = equalsMatched && statusOk;

  const assertion_result = {
    expected: expectedSignal ?? null,
    actual: {
      http_status: httpStatus,
      body: text.length > TAIL_BYTES ? text.slice(0, TAIL_BYTES) : text,
    },
    matched,
  };

  const stdout_tail = text.length > TAIL_BYTES ? text.slice(-TAIL_BYTES) : text;
  const stderr_tail = matched ? '' :
    `http status=${httpStatus} statusOk=${statusOk} equalsMatched=${equalsMatched}`;

  return {
    status: matched ? 'passed' : 'failed',
    exit_code: matched ? 0 : 1,
    duration_ms,
    stdout_tail,
    stderr_tail,
    assertion_result,
  };
}

/**
 * Execute a sandboxed command. Returns { status, exit_code, duration_ms,
 * stdout_tail, stderr_tail }.
 */
async function executeSandboxed(test) {
  // HTTP runner — validate target & expected_signal, fetch, assert.
  // Must be checked BEFORE the command emptiness guard since http tests
  // have no `command` field — they have `target`/`method`/`expected_signal`.
  if (test && test.runner === 'http') {
    return await executeHttp(test);
  }

  const command = test && test.command;
  if (typeof command !== 'string' || command.trim() === '') {
    return {
      status: 'error', exit_code: null, duration_ms: 0,
      stdout_tail: '', stderr_tail: 'empty command',
    };
  }

  const denied = applyRunnerGate(test, command);
  if (denied) return denied;

  // SQL runner — execute via the dedicated read-only Postgres role. Keeps the
  // process isolation for bash intact but avoids forking psql inside a
  // sandboxed shell context.
  if (test.runner === 'sql') {
    return await executeSql(command);
  }

  let argv;
  try {
    argv = splitCommand(command);
  } catch (e) {
    return {
      status: 'error', exit_code: null, duration_ms: 0,
      stdout_tail: '', stderr_tail: e.message,
    };
  }

  const [bin, ...args] = argv;

  const spawnOpts = {
    shell: false,
    cwd: '/tmp',
    env: {
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
    detached: true, // put child in its own process group so we can kill the tree
  };

  // If running as root, try to drop privileges to 'nobody'.
  if (process.getuid && process.getuid() === 0) {
    try {
      const { stdout } = await execFileP('id', ['-u', 'nobody'], { timeout: 2000 });
      const uid = parseInt(stdout.trim(), 10);
      const { stdout: gOut } = await execFileP('id', ['-g', 'nobody'], { timeout: 2000 });
      const gid = parseInt(gOut.trim(), 10);
      if (Number.isFinite(uid) && Number.isFinite(gid)) {
        spawnOpts.uid = uid;
        spawnOpts.gid = gid;
      }
    } catch (e) {
      log.warn({ err: e.message }, 'bdd-runner: could not resolve nobody uid/gid, running as current user');
    }
  }

  const started = Date.now();
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, spawnOpts);
    } catch (e) {
      return resolve({
        status: 'error', exit_code: null, duration_ms: Date.now() - started,
        stdout_tail: '', stderr_tail: `spawn failed: ${e.message}`,
      });
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutLen = 0, stderrLen = 0;
    const MAX_BUFFER = 1024 * 1024; // 1MB hard cap per stream

    child.stdout.on('data', d => {
      if (stdoutLen < MAX_BUFFER) { stdoutChunks.push(d); stdoutLen += d.length; }
    });
    child.stderr.on('data', d => {
      if (stderrLen < MAX_BUFFER) { stderrChunks.push(d); stderrLen += d.length; }
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        // Kill the whole process group. `detached:true` above made child the leader.
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch { /* ignore */ }
    }, EXEC_TIMEOUT_MS);

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({
        status: 'error', exit_code: null, duration_ms: Date.now() - started,
        stdout_tail: tailBuffer(Buffer.concat(stdoutChunks)),
        stderr_tail: tailBuffer(Buffer.concat(stderrChunks)) || e.message,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const duration_ms = Date.now() - started;
      const stdout_tail = tailBuffer(Buffer.concat(stdoutChunks));
      const stderr_tail = tailBuffer(Buffer.concat(stderrChunks));
      if (timedOut) {
        return resolve({ status: 'timeout', exit_code: null, duration_ms, stdout_tail, stderr_tail });
      }
      if (code === 0) {
        return resolve({ status: 'passed', exit_code: 0, duration_ms, stdout_tail, stderr_tail });
      }
      return resolve({
        status: 'failed',
        exit_code: typeof code === 'number' ? code : null,
        duration_ms, stdout_tail, stderr_tail,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Poll & dispatch
// ---------------------------------------------------------------------------

/**
 * Atomically claim one queued run: flip its data.status from 'queued' to
 * 'running' and return the row. Returns null if nothing to do.
 */
async function claimOneQueuedRun() {
  const runsTableId = await getBddTableId('bdd_test_runs');
  if (!runsTableId) return null;

  // UPDATE ... RETURNING the first queued row.
  const adapter = await getAdapter();
  const res = await adapter.query(`
    UPDATE table_rows
    SET data = data || jsonb_build_object('status','running','claimed_at', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM table_rows
      WHERE table_id = $1 AND data->>'status' = 'queued'
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, base_id, data
  `, [runsTableId]);
  if (!res.rows || res.rows.length === 0) return null;
  const row = res.rows[0];
  row.data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  return row;
}

async function getTestCommand(testRowId) {
  const testsTableId = await getBddTableId('bdd_tests');
  if (!testsTableId) return null;
  const row = await dbGet(`
    SELECT id, data FROM table_rows WHERE table_id = ? AND id = ?
  `, [testsTableId, testRowId]);
  if (!row) return null;
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  if (data.disabled === true || data.disabled === 'true') return null;
  // ADR-156 Appendix C §1.4: runner kind drives which security gate we apply.
  // Legacy rows (pre-iteration-2) may have a `kind` value like 'curl' instead
  // of a runner kind — fall back to bash in that case.
  const runner = (data.runner || data.kind || 'bash').toString().toLowerCase();
  const runner_config = data.runner_config && typeof data.runner_config === 'object'
    ? data.runner_config : {};
  return {
    id: row.id,
    command: data.command,
    runner,
    runner_config,
    review_status: data.review_status || 'pending',
    is_blocking: !!data.is_blocking,
    // HTTP-runner fields (ADR-156 Phase 5A §2.1 http runner). Ignored by other runners.
    target: data.target || null,
    method: data.method || 'GET',
    headers: data.headers && typeof data.headers === 'object' ? data.headers : null,
    body: data.body ?? null,
    expected_signal: data.expected_signal && typeof data.expected_signal === 'object'
      ? data.expected_signal : null,
  };
}

async function postRunResult(testRowId, result, triggered_by_id) {
  const token = issueInternalJwt();
  const body = {
    status: result.status,
    exit_code: result.exit_code,
    duration_ms: result.duration_ms,
    stdout_tail: result.stdout_tail,
    stderr_tail: result.stderr_tail,
    assertion_result: result.assertion_result ?? null,
    triggered_by: 'worker',
    triggered_by_id: triggered_by_id || 'bdd-runner',
  };
  const resp = await fetch(`${SELF_BASE_URL}/api/v3/bdd/tests/${testRowId}/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`self-POST ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

/**
 * After the sandbox has produced a result, finalise the *queued* run row by
 * merging the real status + captured tails into its data column. This is the
 * row we claimed at the start — we update it in-place rather than creating a
 * new one so consumers can pair queue + result by id. We ALSO self-POST so
 * the criterion state-machine in routes/v3/bdd.js fires.
 */
async function finaliseQueuedRunRow(runRow, testRowId, result) {
  const runsTableId = await getBddTableId('bdd_test_runs');
  if (!runsTableId) return;
  const patch = {
    status: result.status,
    exit_code: result.exit_code,
    duration_ms: result.duration_ms,
    stdout_tail: result.stdout_tail,
    stderr_tail: result.stderr_tail,
    finished_at: new Date().toISOString(),
  };
  if (result.assertion_result !== undefined) {
    patch.assertion_result = result.assertion_result;
  }
  await dbRun(`
    UPDATE table_rows
    SET data = COALESCE(data,'{}'::jsonb) || ?::jsonb,
        updated_at = ${sqlNow()}
    WHERE id = ?
  `, [JSON.stringify(patch), runRow.id]);
}

let pollInFlight = false;
async function pollOnce() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    // Drain: process queued rows until none remain.
    for (;;) {
      const runRow = await claimOneQueuedRun();
      if (!runRow) break;

      const testRowId = parseInt(runRow.data?.test_id, 10);
      if (!Number.isFinite(testRowId)) {
        await finaliseQueuedRunRow(runRow, null, {
          status: 'error', exit_code: null, duration_ms: 0,
          stdout_tail: '', stderr_tail: 'invalid test_id on queued row',
        });
        continue;
      }

      const test = await getTestCommand(testRowId);
      // http runner has no `command` — it uses `target`. Only reject when BOTH
      // are absent, or when the test row itself is missing/disabled.
      const hasWork = test && (test.command || (test.runner === 'http' && test.target));
      if (!hasWork) {
        await finaliseQueuedRunRow(runRow, testRowId, {
          status: 'error', exit_code: null, duration_ms: 0,
          stdout_tail: '', stderr_tail: 'test not found or disabled',
        });
        continue;
      }

      log.info({
        testRowId, runRowId: runRow.id,
        runner: test.runner,
        cmd: String(test.command || test.target || '').slice(0, 120),
      }, 'bdd-runner: executing');
      const result = await executeSandboxed(test);

      await finaliseQueuedRunRow(runRow, testRowId, result);

      try {
        await postRunResult(testRowId, result, runRow.data?.triggered_by_id);
      } catch (e) {
        log.warn({ err: e.message, testRowId, runRowId: runRow.id },
          'bdd-runner: self-POST failed (row was finalised directly in DB)');
      }
    }
  } catch (e) {
    log.error({ err: e.message }, 'bdd-runner: poll pass failed');
  } finally {
    pollInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// LISTEN/NOTIFY bootstrap
// ---------------------------------------------------------------------------
async function startListener() {
  const { Client } = pg;
  const connString = process.env.POSTGRES_URL;
  const connectionConfig = connString
    ? { connectionString: connString }
    : {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'godcrm_prod',
        user: process.env.POSTGRES_USER || 'godcrm',
        password: process.env.POSTGRES_PASSWORD,
      };

  const client = new pg.Client(connectionConfig);
  client.on('error', (err) => log.error({ err: err.message }, 'bdd-runner LISTEN client error'));
  client.on('notification', (msg) => {
    log.info({ channel: msg.channel, payload: msg.payload?.slice?.(0, 200) }, 'bdd-runner: NOTIFY');
    // Any signal = kick the poll.
    pollOnce().catch(() => {});
  });

  await client.connect();
  await client.query('LISTEN "bdd.test_run.queued"');
  await client.query('LISTEN "bdd.criterion.claim_requested"');
  log.info('bdd-runner: LISTEN active on bdd.test_run.queued, bdd.criterion.claim_requested');
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------
async function main() {
  log.info({
    pollInterval: POLL_INTERVAL_MS,
    execTimeout: EXEC_TIMEOUT_MS,
    baseUrl: SELF_BASE_URL,
  }, 'bdd-runner: starting');

  try {
    await startListener();
  } catch (e) {
    log.error({ err: e.message }, 'bdd-runner: failed to start LISTEN (will continue with polling only)');
  }

  // Immediate catch-up pass, then periodic safety-net poll.
  await pollOnce().catch(() => {});
  setInterval(() => { pollOnce().catch(() => {}); }, POLL_INTERVAL_MS);
}

main().catch((e) => {
  log.error({ err: e.message, stack: e.stack }, 'bdd-runner: fatal');
  process.exit(1);
});
