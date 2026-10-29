/**
 * Ops-profile broker — the trusted launcher between an authenticated agent
 * tool call and the installed executor (scripts/ops-runner, INTEGRATION.md).
 *
 *   ops_run_check (agent MCP) ─▶ POST /api/v3/ops/run (gate token)
 *     ─▶ runCheck(): re-read agent row + grant, quotas, executor pin
 *     ─▶ python3 <OPS_EXECUTOR_ROOT>/ops-runner/broker-entry.py  (stdin envelope)
 *     ─▶ profiles.run_check(request, grant, context, still_authorized)
 *
 * Server-owned, never taken from the agent: identity (token claims minted at
 * spawn), role (agent row slug), grant, suites, repo, candidate SHA, image and
 * dependency pins, executor path. The agent supplies exactly
 * {action, job_id, candidate_sha, suite_id?}; anything else is refused before
 * the executor is spawned.
 *
 * still_authorized() for the executor is the stdin pipe: while a job runs the
 * broker polls the grant every second and writes `revoke` when it is gone;
 * if this process dies the pipe closes and the executor stops the container
 * itself. Workers a dead broker could not stop are reaped by reapOpsWorkers()
 * at boot (containers are named godcrm-profile-*, recorded per run).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dbGet, dbAll, dbRun, safeJsonParse } from '../../database/connection.js';
import { getAgentTableIds } from '../agentTableResolver.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'ops_broker' });
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirror of scripts/ops-runner/profiles.py ROLES / LOCAL / diagnostics.ACTIONS.
// The executor re-validates; this copy lets issuance refuse early.
export const PROFILES = Object.freeze({
  diagnostics: {
    roles: ['sysadmin'],
    actions: ['host.identity', 'disk.status', 'runtime.status',
      'ring0.health', 'ring0.release', 'staging.health', 'staging.release'],
  },
  'local-qa': {
    roles: ['sysadmin', 'developer', 'developer-ralph', 'frontend-developer', 'frontend-qa'],
    actions: ['node-test', 'vitest', 'build', 'browser-test'],
  },
});
export const MAX_TTL_SECONDS = 3600;
const RUN_HARD_CAP_MS = 16 * 60 * 1000; // executor's own deadline is 15 min
const CLEAN_ENV = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const SHA_RE = /^[0-9a-f]{40}$/;
const CONTAINER_PREFIX = 'godcrm-profile-';

export class OpsDenied extends Error {
  constructor(reason, status = 403) { super(reason); this.reason = reason; this.status = status; }
}

// ─── Suite registry (server-owned) ──────────────────────────────────

let suitesCache;
export function loadSuites() {
  if (!suitesCache) {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/ops-suites.json'), 'utf8'));
    delete raw._comment;
    suitesCache = raw;
  }
  return suitesCache;
}

// ─── Executor trust ─────────────────────────────────────────────────

export const EXECUTOR_FILES = ['ops-runner.py', 'ops-runner/profiles.py', 'ops-runner/diagnostics.py',
  'ops-runner/pm2-status.cjs', 'ops-runner/browser-seccomp.json'];
const ENTRY = 'ops-runner/broker-entry.py';

export function executorRoot() {
  return process.env.OPS_EXECUTOR_ROOT || '/opt/godcrm-ops/current';
}

/** Same formula as profiles.executor_digest(): sha256(name\0bytes\0 …) over the pinned files. */
export function executorDigest(root) {
  const h = crypto.createHash('sha256');
  for (const rel of EXECUTOR_FILES) {
    h.update(path.basename(rel)); h.update(Buffer.from([0]));
    h.update(fs.readFileSync(path.join(root, rel))); h.update(Buffer.from([0]));
  }
  return h.digest('hex');
}

/**
 * The executor is trusted only when it lives where the server says, is owned by
 * root, is writable by nobody else and hashes to the pinned digest. A modified
 * copy in a worktree can never be selected: the path is not an input.
 */
export function verifyExecutor() {
  const root = executorRoot();
  const pin = process.env.OPS_EXECUTOR_SHA256 || '';
  if (!/^[0-9a-f]{64}$/.test(pin)) return { ok: false, reason: 'executor_pin_missing', root };
  try {
    const real = fs.realpathSync(root);
    for (const rel of ['', 'ops-runner', ...EXECUTOR_FILES, ENTRY]) {
      const st = fs.statSync(path.join(real, rel));
      if (st.uid !== 0 || (st.mode & 0o022) !== 0) return { ok: false, reason: 'executor_not_root_owned', root, file: rel };
    }
    const digest = executorDigest(real);
    if (digest !== pin) return { ok: false, reason: 'executor_digest_mismatch', root, digest };
    return { ok: true, root: real, digest, entry: path.join(real, ENTRY) };
  } catch (err) {
    return { ok: false, reason: 'executor_unreadable', root, error: err.code || err.message };
  }
}

// ─── Identity ───────────────────────────────────────────────────────

/** Agent row → { slug, status }, read from the agent-config tables only. */
export async function loadAgentIdentity(agentId) {
  const tableIds = await getAgentTableIds();
  if (!tableIds.length) return null;
  const row = await dbGet(
    `SELECT data FROM table_rows WHERE id = ? AND table_id = ANY(?)`,
    [Number(agentId), tableIds]
  );
  if (!row) return null;
  const data = safeJsonParse(row.data, {});
  return { slug: data.slug || data.agent_slug || null, status: data.status || null };
}

// ─── Grants ─────────────────────────────────────────────────────────

function gitHead(repo) {
  const real = fs.realpathSync(repo);
  const top = execFileSync('/usr/bin/git', ['-C', real, 'rev-parse', '--show-toplevel'],
    { env: CLEAN_ENV, encoding: 'utf8', timeout: 10_000 }).trim();
  if (fs.realpathSync(top) !== real) throw new OpsDenied('repo_not_toplevel', 400);
  const sha = execFileSync('/usr/bin/git', ['-C', real, 'rev-parse', 'HEAD'],
    { env: CLEAN_ENV, encoding: 'utf8', timeout: 10_000 }).trim();
  if (!SHA_RE.test(sha)) throw new OpsDenied('repo_head_unreadable', 400);
  return { repo: real, sha };
}

/**
 * Issue a grant. Everything the executor will later trust is resolved here from
 * server state: role from the agent row, HEAD from the repo, image/modules from
 * env pins, suites from the registry.
 */
export async function issueGrant({ actorUserId, spaceId, agentId, jobId, profile, actions, suiteIds = [], repo, ttlSeconds }) {
  const spec = PROFILES[profile];
  if (!spec) throw new OpsDenied('unknown_profile', 400);
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(jobId)) throw new OpsDenied('invalid_job_id', 400);
  const ttl = Math.min(Number(ttlSeconds) || MAX_TTL_SECONDS, MAX_TTL_SECONDS);
  if (!(ttl > 0)) throw new OpsDenied('invalid_ttl', 400);

  const identity = await loadAgentIdentity(agentId);
  if (!identity) throw new OpsDenied('agent_not_found', 404);
  if (identity.status !== 'active') throw new OpsDenied('agent_inactive', 409);
  if (!spec.roles.includes(identity.slug)) throw new OpsDenied('role_denied', 403);

  let repoInfo;
  try {
    repoInfo = gitHead(repo);
  } catch (err) {
    if (err instanceof OpsDenied) throw err;
    throw new OpsDenied('repo_invalid', 400);
  }

  // Least privilege by default: diagnostics → the profile's actions, local-qa →
  // exactly the actions its registered suites need. An explicit list narrows.
  let suites = {};
  let image = null;
  let modules = null;
  if (profile === 'local-qa') {
    const registry = loadSuites();
    if (!Array.isArray(suiteIds) || !suiteIds.length) throw new OpsDenied('suites_required', 400);
    for (const id of suiteIds) {
      if (!registry[id]) throw new OpsDenied('unknown_suite', 400);
      suites[id] = registry[id];
    }
  }
  const defaults = profile === 'local-qa' ? [...new Set(Object.values(suites).map((s) => s.action))] : spec.actions;
  const wanted = Array.isArray(actions) && actions.length ? actions : defaults;
  if (wanted.some((a) => !spec.actions.includes(a))) throw new OpsDenied('action_not_in_profile', 400);
  if (Object.values(suites).some((s) => !wanted.includes(s.action))) throw new OpsDenied('suite_action_not_granted', 400);
  if (profile === 'local-qa') {
    const browser = Object.values(suites).some((s) => s.action === 'browser-test');
    const mixed = Object.values(suites).some((s) => s.action !== 'browser-test');
    if (browser && mixed) throw new OpsDenied('one_image_per_grant', 400);
    image = browser ? process.env.OPS_QA_BROWSER_IMAGE : process.env.OPS_QA_IMAGE;
    modules = process.env.OPS_QA_MODULES;
    if (!/^sha256:[0-9a-f]{64}$/.test(image || '')) throw new OpsDenied('image_not_pinned', 503);
    if (!modules || !fs.existsSync(modules)) throw new OpsDenied('modules_not_configured', 503);
  }

  const row = await dbGet(
    `INSERT INTO ops_grants (job_id, agent_id, space_id, role, profile, actions, suites, repo, candidate_sha,
                             image, modules, issued_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, now() + make_interval(secs => ?))
     RETURNING *`,
    [jobId, Number(agentId), Number(spaceId), identity.slug, profile, JSON.stringify(wanted),
      JSON.stringify(suites), repoInfo.repo, repoInfo.sha, image, modules, Number(actorUserId), ttl]
  );
  log.info({ grant_id: row.id, agent_id: agentId, profile, job_id: jobId, actor: actorUserId }, 'ops grant issued');
  return row;
}

export async function revokeGrant(id, actorUserId) {
  return dbGet(
    `UPDATE ops_grants SET revoked_at = now(), revoked_by = ? WHERE id = ? AND revoked_at IS NULL RETURNING *`,
    [Number(actorUserId), Number(id)]
  );
}

export async function findLiveGrant({ agentId, spaceId, jobId }) {
  return dbGet(
    `SELECT * FROM ops_grants
      WHERE agent_id = ? AND space_id = ? AND job_id = ? AND revoked_at IS NULL AND expires_at > now()
      ORDER BY id DESC LIMIT 1`,
    [Number(agentId), Number(spaceId), String(jobId)]
  );
}

/** What the holder is allowed to see about its own grants. */
export function grantSummary(row) {
  return {
    grant_id: row.id, job_id: row.job_id, profile: row.profile, actions: row.actions,
    suite_ids: Object.keys(row.suites || {}), candidate_sha: row.candidate_sha,
    expires_at: row.expires_at, revoked: row.revoked_at != null,
  };
}

// ─── Run ────────────────────────────────────────────────────────────

const REQUEST_KEYS = new Set(['action', 'job_id', 'candidate_sha', 'suite_id']);

/** Strict request shape; the executor validates again. */
export function normalizeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OpsDenied('invalid_request', 400);
  for (const key of Object.keys(body)) if (!REQUEST_KEYS.has(key)) throw new OpsDenied('unexpected_field', 400);
  for (const key of ['action', 'job_id', 'candidate_sha']) {
    if (typeof body[key] !== 'string' || !body[key]) throw new OpsDenied('invalid_request', 400);
  }
  if ('suite_id' in body && typeof body.suite_id !== 'string') throw new OpsDenied('invalid_request', 400);
  if (!SHA_RE.test(body.candidate_sha)) throw new OpsDenied('invalid_sha', 400);
  return body;
}

const epoch = (ts) => new Date(ts).getTime() / 1000;

function grantForExecutor(row) {
  return {
    job_id: row.job_id, agent_id: row.agent_id, space_id: row.space_id, role: row.role,
    repo: row.repo, candidate_sha: row.candidate_sha, profile: row.profile,
    issued_at: epoch(row.issued_at), expires_at: epoch(row.expires_at),
    actions: row.actions, suites: row.suites || {},
    ...(row.image ? { image: row.image } : {}), ...(row.modules ? { modules: row.modules } : {}),
    revoked: row.revoked_at != null,
  };
}

/**
 * Spawn the trusted entrypoint and keep it authorized only while the grant
 * stays live. Resolves to { denied } or the executor report.
 */
function spawnExecutor(entry, envelope, grantId) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/python3', [entry], { env: CLEAN_ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { if (err.length < 4096) err += d; });

    const revoke = () => { try { child.stdin.write('revoke\n'); } catch { /* pipe gone */ } };
    const poll = setInterval(async () => {
      try {
        const live = await dbGet(`SELECT 1 AS ok FROM ops_grants WHERE id = ? AND revoked_at IS NULL AND expires_at > now()`, [grantId]);
        if (!live) revoke();
      } catch (e) {
        revoke(); // fail closed: an unreadable grant is not a live grant
      }
    }, 1000);
    const hardCap = setTimeout(() => { revoke(); setTimeout(() => child.kill('SIGKILL'), 30_000); }, RUN_HARD_CAP_MS);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(poll); clearTimeout(hardCap);
      resolve(result);
    };
    child.on('error', (e) => finish({ error: 'spawn_failed', detail: e.code || e.message }));
    child.on('close', (code) => {
      let parsed = null;
      try { parsed = JSON.parse(out.trim().split('\n').pop() || 'null'); } catch { /* not JSON */ }
      if (parsed && typeof parsed === 'object') return finish(parsed);
      log.error({ code, stderr: err.slice(0, 1000) }, 'ops executor produced no report');
      finish({ error: 'executor_failed', code });
    });
    child.stdin.write(JSON.stringify(envelope) + '\n');
  });
}

/**
 * The broker entry for one authenticated call. `claims` come from the verified
 * gate token; `body` is the raw agent request.
 */
export async function runCheck({ claims, body }) {
  const request = normalizeRequest(body);

  // Identity is re-derived per call: the row must still be an active agent
  // whose slug equals the role the grant was issued for.
  const identity = await loadAgentIdentity(claims.agent_id);
  if (!identity || identity.status !== 'active') throw new OpsDenied('agent_inactive');
  const grant = await findLiveGrant({ agentId: claims.agent_id, spaceId: claims.space_id, jobId: request.job_id });
  if (!grant) throw new OpsDenied('no_live_grant');
  if (grant.role !== identity.slug) throw new OpsDenied('role_changed');
  if (request.candidate_sha !== grant.candidate_sha) throw new OpsDenied('sha_mismatch');
  if (!grant.actions.includes(request.action)) throw new OpsDenied('action_denied');
  if (grant.profile === 'diagnostics' && request.suite_id !== undefined) throw new OpsDenied('unexpected_suite');
  if (grant.profile === 'local-qa' && !grant.suites?.[request.suite_id]) throw new OpsDenied('suite_denied');

  const executor = verifyExecutor();
  if (!executor.ok) {
    log.error(executor, 'ops executor not trusted');
    throw new OpsDenied(executor.reason, 503);
  }

  const run = await dbGet(
    `INSERT INTO ops_runs (grant_id, agent_id, space_id, job_id, action, suite_id, request, status, broker_pid, executor_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'running', ?, ?) RETURNING id`,
    [grant.id, grant.agent_id, grant.space_id, grant.job_id, request.action, request.suite_id ?? null,
      JSON.stringify(request), process.pid, executor.digest]
  );
  const running = await dbGet(`SELECT count(*)::int AS n FROM ops_runs WHERE grant_id = ? AND status = 'running'`, [grant.id]);
  if (running.n > grant.max_concurrent) {
    await dbRun(`UPDATE ops_runs SET status = 'denied', result = ?::jsonb, finished_at = now() WHERE id = ?`,
      [JSON.stringify({ denied: 'concurrency_quota' }), run.id]);
    throw new OpsDenied('concurrency_quota', 429);
  }

  const context = { job_id: grant.job_id, agent_id: grant.agent_id, space_id: grant.space_id,
    role: grant.role, repo: grant.repo, candidate_sha: grant.candidate_sha };
  const report = await spawnExecutor(executor.entry, { request, grant: grantForExecutor(grant), context }, grant.id);

  if (report.denied) {
    await dbRun(`UPDATE ops_runs SET status = 'denied', result = ?::jsonb, finished_at = now() WHERE id = ?`,
      [JSON.stringify(report), run.id]);
    throw new OpsDenied(String(report.denied));
  }
  if (report.error && report.exit_code == null) {
    await dbRun(`UPDATE ops_runs SET status = 'failed', result = ?::jsonb, finished_at = now() WHERE id = ?`,
      [JSON.stringify(report), run.id]);
    throw new OpsDenied(report.error, 502);
  }

  const status = report.exit_code === 0 ? 'finished' : 'failed';
  const { artifacts, ...visible } = report;
  await dbRun(
    `UPDATE ops_runs SET status = ?, exit_code = ?, container = ?, artifacts = ?, executor_sha256 = ?,
                         result = ?::jsonb, finished_at = now() WHERE id = ?`,
    [status, report.exit_code, report.container ?? null, artifacts ?? null, report.executor_sha256 ?? executor.digest,
      JSON.stringify(visible), run.id]
  );
  // Never the artifact path, never raw logs: the owner reads those via /ops/runs/:id/log.
  return { run_id: run.id, ...visible };
}

// ─── Reaper ─────────────────────────────────────────────────────────

function docker(args, timeout = 30_000) {
  return execFileSync('/usr/bin/docker', args, { env: CLEAN_ENV, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * Broker-death recovery. Two brokers may share this Docker daemon (godcrm and
 * godcrm-edit on .128) and PM2 may run several workers, so nothing here trusts
 * "not mine" alone: a container is an orphan only once it is older than the
 * executor's own 15-minute deadline (a live broker would have stopped it);
 * a `running` row is an orphan only when its broker pid is gone. Artifact
 * directories older than a day are deleted.
 */
export async function reapOpsWorkers({ artifactMaxAgeHours = 24, orphanAfterMinutes = 16 } = {}) {
  const summary = { containers_removed: [], runs_reaped: 0, artifacts_pruned: 0 };
  if (!fs.existsSync(executorRoot())) return summary;
  try {
    const names = docker(['ps', '-a', '--filter', `name=^${CONTAINER_PREFIX}`, '--format', '{{.Names}}'])
      .split('\n').map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      try {
        const created = Date.parse(docker(['inspect', '--format', '{{.Created}}', name]).trim());
        if (Date.now() - created < orphanAfterMinutes * 60_000) continue;
        docker(['rm', '-f', name]);
        summary.containers_removed.push(name);
      } catch (e) { log.warn({ name, err: e.message }, 'reap: container check failed'); }
    }
  } catch (e) {
    log.warn({ err: e.message }, 'reap: docker unavailable');
  }
  const running = await dbAll(`SELECT id, broker_pid FROM ops_runs WHERE status = 'running'`);
  const orphans = running.filter((r) => !r.broker_pid || !pidAlive(r.broker_pid)).map((r) => r.id);
  if (orphans.length) {
    await dbRun(`UPDATE ops_runs SET status = 'reaped', finished_at = now() WHERE id = ANY(?)`, [orphans]);
  }
  summary.runs_reaped = orphans.length;
  const stale = await dbAll(
    `SELECT id, artifacts FROM ops_runs
      WHERE artifacts IS NOT NULL AND finished_at < now() - make_interval(hours => ?)`,
    [Number(artifactMaxAgeHours)]
  );
  for (const row of stale) {
    if (row.artifacts && row.artifacts.startsWith(path.join(fs.realpathSync('/tmp'), CONTAINER_PREFIX))) {
      fs.rmSync(row.artifacts, { recursive: true, force: true });
    }
    await dbRun(`UPDATE ops_runs SET artifacts = NULL WHERE id = ?`, [row.id]);
    summary.artifacts_pruned += 1;
  }
  if (summary.containers_removed.length || summary.runs_reaped) log.warn(summary, 'ops reaper cleaned up');
  return summary;
}

/** Bounded log for the owner; never returned to the agent tool. */
export function readRunLog(artifacts, limit = 256 * 1024) {
  if (!artifacts) return null;
  const file = path.join(artifacts, 'output.log');
  if (!fs.existsSync(file)) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - limit);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return { bytes: size, truncated: start > 0, text: buf.toString('utf8') };
  } finally {
    fs.closeSync(fd);
  }
}
