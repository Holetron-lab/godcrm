/**
 * Staging execution broker — authenticated delivery from a CRM identity to the
 * INDEPENDENT staging executor (scripts/staging-executor/, a root-owned systemd
 * service outside the godcrm / godcrm-edit process trees).
 *
 *   ops_staging_preflight (agent MCP) ─▶ POST /api/v3/ops/staging/preflight (gate token)
 *     ─▶ runStagingPreflight(): agent row + grant + exact SHA + executor digest
 *     ─▶ run receipt + preflight lease
 *     ─▶ HMAC-signed envelope over the executor's Unix socket
 *     ─▶ executor re-validates everything, runs preflight.py, signs the report
 *
 * Server-owned, never taken from the agent: identity (gate token claims minted
 * at spawn), role (agent row slug), grant, candidate SHA, target, source repo,
 * executor root/digest, channel key, socket path. The agent supplies exactly
 * {action, job_id, candidate_sha}; anything else is refused before any socket
 * is opened. The only action that exists is `staging.preflight`; deploy,
 * restart, repair, production and Ring 1 have no code path here.
 *
 * Fail closed: the grant is re-read every second while the executor works and
 * the socket is closed the moment it is gone (the executor kills its child on
 * EOF); the preflight lease is heartbeated on the same tick and released in
 * `finally`, owned-token only. Dead-broker leftovers are reaped by
 * reapStagingChannel() at boot and by the external watchdog timer.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import { OpsDenied, loadAgentIdentity } from './opsBroker.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'staging_broker' });

export const STAGING_PROFILE = Object.freeze({ roles: ['sysadmin'], actions: ['staging.preflight'] });
export const STAGING_TARGET = Object.freeze({
  host_alias: 'dev72', host: '<DEV_IP>', domain: 'dev.godcrm.ai', database: 'godcrm_test',
});
export const MAX_GRANT_TTL_SECONDS = 3600;
export const MAX_LEASE_TTL_SECONDS = 1800;
export const PREFLIGHT_CAP_SECONDS = 120;
const PREFLIGHT_LEASE_TTL_SECONDS = 180;
const CHANNEL_GRACE_MS = 15_000; // executor's own deadline is PREFLIGHT_CAP_SECONDS
export const EXECUTOR_FILES = ['executor.py', 'preflight.py'];
const SHA_RE = /^[0-9a-f]{40}$/;
const JOB_RE = /^[A-Za-z0-9._-]{1,64}$/;
const CLEAN_ENV = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

export function stagingConfig() {
  return {
    executorRoot: process.env.OPS_STAGING_EXECUTOR_ROOT || '/opt/godcrm-staging-executor/current',
    pin: process.env.OPS_STAGING_EXECUTOR_SHA256 || '',
    socket: process.env.OPS_STAGING_SOCKET || '/run/godcrm-staging-executor/executor.sock',
    keyFile: process.env.OPS_STAGING_CHANNEL_KEY_FILE || '/etc/godcrm-staging-executor/channel.key',
    sourceRepo: process.env.OPS_STAGING_SOURCE_REPO || '/root/production/business-crm',
    spaceId: Number(process.env.OPS_STAGING_SPACE_ID || 11),
  };
}

// ─── Executor trust ─────────────────────────────────────────────────

/** Same formula as executor.py executor_digest(): sha256(name\0bytes\0 …). */
export function stagingExecutorDigest(root) {
  const h = crypto.createHash('sha256');
  for (const rel of EXECUTOR_FILES) {
    h.update(path.basename(rel)); h.update(Buffer.from([0]));
    h.update(fs.readFileSync(path.join(root, rel))); h.update(Buffer.from([0]));
  }
  return h.digest('hex');
}

function rootOwnedUnwritable(file) {
  const st = fs.statSync(file);
  return st.uid === 0 && (st.mode & 0o022) === 0;
}

/**
 * Trusted only when installed where the server says, root-owned, writable by
 * nobody else, hashing to the pin, with a private channel key beside it.
 */
export function verifyStagingExecutor() {
  const cfg = stagingConfig();
  if (!/^[0-9a-f]{64}$/.test(cfg.pin)) return { ok: false, reason: 'executor_pin_missing', root: cfg.executorRoot };
  try {
    const real = fs.realpathSync(cfg.executorRoot);
    for (const rel of ['', ...EXECUTOR_FILES]) {
      if (!rootOwnedUnwritable(path.join(real, rel))) return { ok: false, reason: 'executor_not_root_owned', root: cfg.executorRoot, file: rel };
    }
    const digest = stagingExecutorDigest(real);
    if (digest !== cfg.pin) return { ok: false, reason: 'executor_digest_mismatch', root: cfg.executorRoot, digest };
    const key = fs.statSync(cfg.keyFile);
    if (key.uid !== 0 || (key.mode & 0o077) !== 0) return { ok: false, reason: 'channel_key_exposed', root: cfg.executorRoot };
    return { ok: true, root: real, digest, socket: cfg.socket, target: STAGING_TARGET };
  } catch (err) {
    return { ok: false, reason: 'executor_unreadable', root: cfg.executorRoot, error: err.code || err.message };
  }
}

function readChannelKey() {
  try {
    const key = fs.readFileSync(stagingConfig().keyFile, 'utf8').trim();
    if (key.length < 32) throw new Error('short');
    return key;
  } catch {
    throw new OpsDenied('channel_key_missing', 503);
  }
}

// ─── Signed envelope (mirror of executor.py canonical/sign) ─────────

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signBody(key, body) {
  return crypto.createHmac('sha256', key).update(canonicalJson(body)).digest('hex');
}

function signatureValid(key, body, sig) {
  const expected = Buffer.from(signBody(key, body), 'hex');
  const given = Buffer.from(String(sig || ''), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// ─── Grants ─────────────────────────────────────────────────────────

function candidateExists(repo, sha) {
  try {
    const real = fs.realpathSync(repo);
    execFileSync('/usr/bin/git', ['-C', real, 'cat-file', '-e', `${sha}^{commit}`],
      { env: CLEAN_ENV, timeout: 10_000, stdio: 'ignore' });
    return real;
  } catch {
    return null;
  }
}

/**
 * Issue a staging grant: sysadmin agent, the staging space, an exact candidate
 * that exists in the canonical repo, and the executor digest installed now.
 */
export async function issueStagingGrant({ actorUserId, spaceId, agentId, jobId, candidateSha, ttlSeconds }) {
  const cfg = stagingConfig();
  if (typeof jobId !== 'string' || !JOB_RE.test(jobId)) throw new OpsDenied('invalid_job_id', 400);
  if (!SHA_RE.test(String(candidateSha || ''))) throw new OpsDenied('invalid_sha', 400);
  const ttl = Math.min(Number(ttlSeconds) || MAX_GRANT_TTL_SECONDS, MAX_GRANT_TTL_SECONDS);
  if (!(ttl > 0)) throw new OpsDenied('invalid_ttl', 400);
  if (Number(spaceId) !== cfg.spaceId) throw new OpsDenied('space_denied', 403);

  const identity = await loadAgentIdentity(agentId);
  if (!identity) throw new OpsDenied('agent_not_found', 404);
  if (identity.status !== 'active') throw new OpsDenied('agent_inactive', 409);
  if (!STAGING_PROFILE.roles.includes(identity.slug)) throw new OpsDenied('role_denied', 403);

  const repo = candidateExists(cfg.sourceRepo, candidateSha);
  if (!repo) throw new OpsDenied('candidate_unknown', 400);

  const executor = verifyStagingExecutor();
  if (!executor.ok) throw new OpsDenied(executor.reason, 503);

  const row = await dbGet(
    `INSERT INTO ops_staging_grants (job_id, agent_id, space_id, role, actions, target, repo, candidate_sha,
                                     executor_sha256, issued_by, expires_at)
     VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, now() + make_interval(secs => ?))
     RETURNING *`,
    [jobId, Number(agentId), cfg.spaceId, identity.slug, JSON.stringify(STAGING_PROFILE.actions),
      JSON.stringify(STAGING_TARGET), repo, candidateSha, executor.digest, Number(actorUserId), ttl]
  );
  log.info({ grant_id: row.id, agent_id: agentId, job_id: jobId, candidate_sha: candidateSha, actor: actorUserId }, 'staging grant issued');
  return row;
}

export async function revokeStagingGrant(id, actorUserId) {
  return dbGet(
    `UPDATE ops_staging_grants SET revoked_at = now(), revoked_by = ? WHERE id = ? AND revoked_at IS NULL RETURNING *`,
    [Number(actorUserId), Number(id)]
  );
}

export async function findLiveStagingGrant({ agentId, spaceId, jobId }) {
  return dbGet(
    `SELECT * FROM ops_staging_grants
      WHERE agent_id = ? AND space_id = ? AND job_id = ? AND revoked_at IS NULL AND expires_at > now()
      ORDER BY id DESC LIMIT 1`,
    [Number(agentId), Number(spaceId), String(jobId)]
  );
}

export async function hasLiveStagingGrant({ agentId, spaceId }) {
  return Boolean(await dbGet(
    `SELECT 1 AS ok FROM ops_staging_grants
      WHERE agent_id = ? AND space_id = ? AND revoked_at IS NULL AND expires_at > now() LIMIT 1`,
    [Number(agentId), Number(spaceId)]
  ));
}

export function stagingGrantSummary(row) {
  return {
    grant_id: row.id, job_id: row.job_id, actions: row.actions, target: row.target,
    candidate_sha: row.candidate_sha, executor_sha256: row.executor_sha256,
    expires_at: row.expires_at, revoked: row.revoked_at != null,
  };
}

// ─── Lease (preflight run / quiet window) ───────────────────────────

/** One live lease per target; contention is a denial, never a wait. */
export async function acquireStagingLease({ grant, runId = null, purpose, ttlSeconds, writers = {} }) {
  const ttl = Math.min(Number(ttlSeconds) || MAX_LEASE_TTL_SECONDS, MAX_LEASE_TTL_SECONDS);
  const token = crypto.randomBytes(16).toString('hex');
  try {
    return await dbGet(
      `INSERT INTO ops_staging_leases (grant_id, run_id, job_id, agent_id, space_id, purpose, holder_pid, holder_token, writers, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, now() + make_interval(secs => ?)) RETURNING *`,
      [grant.id, runId, grant.job_id, grant.agent_id, grant.space_id, purpose, process.pid, token, JSON.stringify(writers), ttl]
    );
  } catch (err) {
    if (err?.code === '23505') throw new OpsDenied('lease_held', 409);
    throw err;
  }
}

/** Heartbeat succeeds only for the owner, while the lease AND its grant are live. */
export async function heartbeatStagingLease(id, token) {
  return dbGet(
    `UPDATE ops_staging_leases l SET heartbeat_at = now()
      WHERE l.id = ? AND l.holder_token = ? AND l.released_at IS NULL AND l.expires_at > now()
        AND EXISTS (SELECT 1 FROM ops_staging_grants g WHERE g.id = l.grant_id AND g.revoked_at IS NULL AND g.expires_at > now())
      RETURNING l.id`,
    [Number(id), String(token)]
  );
}

/** Release only what this holder owns; a foreign token releases nothing. */
export async function releaseStagingLease(id, token, reason) {
  return dbGet(
    `UPDATE ops_staging_leases SET released_at = now(), release_reason = ?
      WHERE id = ? AND holder_token = ? AND released_at IS NULL RETURNING id`,
    [String(reason), Number(id), String(token)]
  );
}

export async function liveStagingLease() {
  return dbGet(`SELECT * FROM ops_staging_leases WHERE released_at IS NULL AND expires_at > now() LIMIT 1`);
}

// ─── Run ────────────────────────────────────────────────────────────

const REQUEST_KEYS = new Set(['action', 'job_id', 'candidate_sha']);

/** Strict request shape; the executor validates again. */
export function normalizeStagingRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OpsDenied('invalid_request', 400);
  for (const key of Object.keys(body)) if (!REQUEST_KEYS.has(key)) throw new OpsDenied('unexpected_field', 400);
  for (const key of REQUEST_KEYS) {
    if (typeof body[key] !== 'string' || !body[key]) throw new OpsDenied('invalid_request', 400);
  }
  if (!SHA_RE.test(body.candidate_sha)) throw new OpsDenied('invalid_sha', 400);
  if (!JOB_RE.test(body.job_id)) throw new OpsDenied('invalid_job_id', 400);
  return { action: body.action, job_id: body.job_id, candidate_sha: body.candidate_sha };
}

async function recordDenial({ claims, body, grant, reason }) {
  const safe = (v) => (typeof v === 'string' && v.length <= 64 ? v : null);
  await dbRun(
    `INSERT INTO ops_staging_runs (grant_id, agent_id, space_id, job_id, action, request, decision, reason, status,
                                   candidate_sha, broker_pid, finished_at)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, 'deny', ?, 'denied', ?, ?, now())`,
    [grant?.id ?? null, Number(claims.agent_id), Number(claims.space_id),
      safe(body?.job_id), safe(body?.action), JSON.stringify(sanitizeRequest(body)), reason,
      SHA_RE.test(String(body?.candidate_sha || '')) ? body.candidate_sha : null, process.pid]
  );
}

function sanitizeRequest(body) {
  if (!body || typeof body !== 'object') return { invalid: true };
  const out = {};
  for (const key of Object.keys(body).slice(0, 16)) {
    out[key.slice(0, 32)] = REQUEST_KEYS.has(key) && typeof body[key] === 'string' ? body[key].slice(0, 64) : '<rejected>';
  }
  return out;
}

/**
 * One signed request/response over the executor socket. Resolves to the
 * verified report body, or {error} — never throws. Authorization lasts while
 * the grant stays live: the poll closes the socket on revocation, and the
 * lease heartbeat stops with it.
 */
function callExecutor({ socketPath, key, body, grantId, lease }) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    const sock = net.createConnection(socketPath);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(poll); clearTimeout(hardCap);
      sock.destroy();
      resolve(result);
    };
    const poll = setInterval(async () => {
      try {
        const live = await dbGet(
          `SELECT 1 AS ok FROM ops_staging_grants WHERE id = ? AND revoked_at IS NULL AND expires_at > now()`, [grantId]);
        const beat = live ? await heartbeatStagingLease(lease.id, lease.holder_token) : null;
        if (!live || !beat) finish({ error: live ? 'lease_lost' : 'revoked', exit_code: 124 });
      } catch {
        finish({ error: 'revoked', exit_code: 124 }); // unreadable grant is not a live grant
      }
    }, 1000);
    const hardCap = setTimeout(() => finish({ error: 'timeout', exit_code: 124 }), body.deadline_s * 1000 + CHANNEL_GRACE_MS);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(JSON.stringify({ body, sig: signBody(key, body) }) + '\n'));
    sock.on('error', (e) => finish({ error: 'executor_unavailable', detail: e.code || 'socket' }));
    sock.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 256 * 1024) return finish({ error: 'executor_failed', detail: 'oversized' });
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      let reply;
      try { reply = JSON.parse(buffer.slice(0, nl)); } catch { return finish({ error: 'executor_failed', detail: 'not_json' }); }
      if (!reply || typeof reply.body !== 'object' || !signatureValid(key, reply.body, reply.sig)) {
        return finish({ error: 'bad_signature' });
      }
      if (reply.body.denied) return finish({ denied: String(reply.body.denied) });
      if (reply.body.run_id !== body.run_id || reply.body.nonce !== body.nonce) return finish({ error: 'bad_signature' });
      finish(reply.body);
    });
    sock.on('close', () => finish({ error: 'executor_failed', detail: 'closed' }));
  });
}

async function settleRun(runId, status, patch) {
  await dbRun(
    `UPDATE ops_staging_runs SET status = ?, exit_code = ?, executor_sha256 = COALESCE(?, executor_sha256),
                                 log_sha256 = ?, result = ?::jsonb, reason = ?, finished_at = now() WHERE id = ?`,
    [status, patch.exit_code ?? null, patch.executor_sha256 ?? null, patch.log_sha256 ?? null,
      JSON.stringify(patch.result ?? null), patch.reason ?? null, runId]
  );
}

/**
 * The broker entry for one authenticated call. `claims` come from the verified
 * gate token; `body` is the raw agent request. Every denial after the identity
 * is known leaves a receipt.
 */
export async function runStagingPreflight({ claims, body }) {
  const cfg = stagingConfig();
  let request;
  let grant = null;
  let executor;
  let key;
  try {
    request = normalizeStagingRequest(body);
    const identity = await loadAgentIdentity(claims.agent_id);
    if (!identity || identity.status !== 'active') throw new OpsDenied('agent_inactive');
    if (Number(claims.space_id) !== cfg.spaceId) throw new OpsDenied('space_denied');
    grant = await findLiveStagingGrant({ agentId: claims.agent_id, spaceId: claims.space_id, jobId: request.job_id });
    if (!grant) throw new OpsDenied('no_live_grant');
    if (grant.role !== identity.slug) throw new OpsDenied('role_changed');
    if (request.candidate_sha !== grant.candidate_sha) throw new OpsDenied('sha_mismatch');
    if (!STAGING_PROFILE.actions.includes(request.action) || !grant.actions.includes(request.action)) throw new OpsDenied('action_denied');
    executor = verifyStagingExecutor();
    if (!executor.ok) { log.error(executor, 'staging executor not trusted'); throw new OpsDenied(executor.reason, 503); }
    if (executor.digest !== grant.executor_sha256) throw new OpsDenied('executor_changed', 503);
    key = readChannelKey();
  } catch (err) {
    if (err instanceof OpsDenied) await recordDenial({ claims, body, grant, reason: err.reason });
    throw err;
  }

  const run = await dbGet(
    `INSERT INTO ops_staging_runs (grant_id, agent_id, space_id, job_id, action, request, decision, status,
                                   candidate_sha, executor_sha256, broker_pid)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, 'allow', 'running', ?, ?, ?) RETURNING id, started_at`,
    [grant.id, grant.agent_id, grant.space_id, grant.job_id, request.action, JSON.stringify(request),
      grant.candidate_sha, executor.digest, process.pid]
  );

  let lease;
  try {
    lease = await acquireStagingLease({ grant, runId: run.id, purpose: 'preflight', ttlSeconds: PREFLIGHT_LEASE_TTL_SECONDS });
  } catch (err) {
    await settleRun(run.id, 'denied', { reason: err instanceof OpsDenied ? err.reason : 'lease_error' });
    throw err;
  }

  const envelope = {
    v: 1, run_id: run.id, nonce: crypto.randomBytes(16).toString('hex'),
    issued_at: Math.floor(Date.now() / 1000), deadline_s: PREFLIGHT_CAP_SECONDS,
    action: request.action, job_id: grant.job_id, agent_id: grant.agent_id, space_id: grant.space_id, role: grant.role,
    candidate_sha: grant.candidate_sha, source_repo: grant.repo, expected_executor_sha256: grant.executor_sha256,
    target: STAGING_TARGET,
  };
  let report;
  try {
    report = await callExecutor({ socketPath: executor.socket, key, body: envelope, grantId: grant.id, lease });
  } finally {
    await releaseStagingLease(lease.id, lease.holder_token, report?.error ? report.error : 'run_finished');
  }

  if (report.denied) {
    await settleRun(run.id, 'denied', { reason: String(report.denied), result: { denied: report.denied } });
    throw new OpsDenied(String(report.denied));
  }
  if (report.error) {
    await settleRun(run.id, 'failed', { exit_code: report.exit_code ?? null, reason: report.error, result: { error: report.error, detail: report.detail ?? null } });
    throw new OpsDenied(report.error, report.exit_code === 124 ? 408 : 502);
  }

  const visible = {
    run_id: run.id, decision: 'allow', action: request.action, job_id: grant.job_id,
    agent_id: grant.agent_id, space_id: grant.space_id, role: grant.role,
    candidate_sha: grant.candidate_sha, executor_sha256: report.executor_sha256, target: STAGING_TARGET,
    lease_id: lease.id, started_at: report.started_at, finished_at: report.finished_at,
    status: report.status, exit_code: report.exit_code, checks: report.checks ?? null, log_sha256: report.log_sha256 ?? null,
    authorizes_release: false,
  };
  await settleRun(run.id, report.exit_code === 0 ? 'finished' : 'failed', {
    exit_code: report.exit_code, executor_sha256: report.executor_sha256, log_sha256: report.log_sha256,
    result: visible, reason: report.exit_code === 0 ? null : (report.status || 'preflight_failed'),
  });
  return visible;
}

// ─── Reaper / watchdog (in-process half) ────────────────────────────

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * Broker-death recovery for this channel: `running` receipts whose broker pid
 * is gone become `reaped`; live leases that expired, stopped heartbeating or
 * belong to a dead pid are released with the reason recorded. Never touches
 * a lease a live broker still heartbeats. The executor itself needs no reaping
 * here: it kills its own child when the socket closes.
 */
export async function reapStagingChannel({ staleHeartbeatSeconds = 120 } = {}) {
  const summary = { runs_reaped: 0, leases_released: [] };
  const running = await dbAll(`SELECT id, broker_pid FROM ops_staging_runs WHERE status = 'running'`);
  const orphans = running.filter((r) => !r.broker_pid || !pidAlive(r.broker_pid)).map((r) => r.id);
  if (orphans.length) {
    await dbRun(`UPDATE ops_staging_runs SET status = 'reaped', reason = 'broker_dead', finished_at = now() WHERE id = ANY(?)`, [orphans]);
    summary.runs_reaped = orphans.length;
  }
  const leases = await dbAll(
    `SELECT id, holder_pid, expires_at <= now() AS expired, heartbeat_at < now() - make_interval(secs => ?) AS stale
       FROM ops_staging_leases WHERE released_at IS NULL`, [Number(staleHeartbeatSeconds)]);
  for (const l of leases) {
    const reason = l.expired ? 'expired' : l.stale ? 'heartbeat_lost' : (!pidAlive(l.holder_pid) ? 'broker_dead' : null);
    if (!reason) continue;
    await dbRun(`UPDATE ops_staging_leases SET released_at = now(), release_reason = ? WHERE id = ? AND released_at IS NULL`, [reason, l.id]);
    summary.leases_released.push({ id: l.id, reason });
  }
  if (summary.runs_reaped || summary.leases_released.length) log.warn(summary, 'staging channel reaper cleaned up');
  return summary;
}
