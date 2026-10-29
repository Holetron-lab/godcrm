// @vitest-environment node
/**
 * Staging channel — the full authenticated path, end to end, against the REAL
 * independent executor:
 *
 *   ops_staging_preflight (tool handler, env token) → POST /api/v3/ops/staging/preflight [listening here]
 *     → runStagingPreflight() → HMAC envelope over a Unix socket → executor.py (own process, own session)
 *     → preflight.py → signed report → run receipt + lease released
 *
 * The executor root is a root-owned copy of scripts/staging-executor pinned by
 * digest, exactly as an installation would be; its channel key is a private
 * temp file. Remote (ssh dev72) checks are disabled in the executor's OWN env —
 * a request can never choose that — so the suite touches no staging host. The
 * source repo is a throwaway git repository with one commit, so "exact SHA /
 * clean tree" is deterministic regardless of this worktree's state.
 *
 * Boot guard first (ADR-0009).
 */
import './../../test/setup.js';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

const REPO = fs.realpathSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..'));
const CLEAN_GIT = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

// ─── fixtures: executor install, key, source repo ───────────────────

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-channel-'));
const EXEC_ROOT = path.join(WORK, 'executor');
fs.mkdirSync(EXEC_ROOT);
for (const f of ['executor.py', 'preflight.py']) fs.copyFileSync(path.join(REPO, 'scripts/staging-executor', f), path.join(EXEC_ROOT, f));
execFileSync('chmod', ['-R', 'go-w', EXEC_ROOT]);
const KEY_FILE = path.join(WORK, 'channel.key');
fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600 });

const SRC = path.join(WORK, 'source');
fs.mkdirSync(path.join(SRC, 'scripts'), { recursive: true });
for (const f of ['scripts/deploy.local.env', 'scripts/staging-sync.exclude', 'scripts/dev-operation.sh', 'scripts/dev-refresh.sh', 'scripts/staging-lease.sh', 'Makefile']) {
  fs.writeFileSync(path.join(SRC, f), f === 'scripts/deploy.local.env' ? 'DEV_HOST=dev72\n' : `# ${f}\n`);
}
fs.writeFileSync(path.join(SRC, '.mcp.json'), '{}\n');
const git = (...args) => execFileSync('git', ['-C', SRC, ...args], { encoding: 'utf8', env: CLEAN_GIT }).trim();
git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'candidate');
const CANDIDATE = git('rev-parse', 'HEAD');
fs.writeFileSync(path.join(SRC, '.mcp.json'), '{"host":"local"}\n'); // host-owned exception must not dirty the check

const SOCK = path.join(WORK, 'executor.sock');
const SLOW_SOCK = path.join(WORK, 'slow.sock');
const STUB_BIN = path.join(WORK, 'bin');
fs.mkdirSync(STUB_BIN);
// A "remote" that never answers: makes preflight slow for revoke / timeout / broker-death cases.
fs.writeFileSync(path.join(STUB_BIN, 'ssh'), `#!/bin/bash\necho $$ > ${path.join(WORK, 'ssh.pid')}\nsleep 60\n`, { mode: 0o755 }); // preflight runs with a clean env: the path is baked in

process.env.OPS_STAGING_EXECUTOR_ROOT = EXEC_ROOT;
process.env.OPS_STAGING_CHANNEL_KEY_FILE = KEY_FILE;
process.env.OPS_STAGING_SOCKET = SOCK;
process.env.OPS_STAGING_SOURCE_REPO = SRC;

const { dbRun, dbGet, dbAll } = await import('../../database/connection.js');
const { createEphemeralWorkspace } = await import('../../tests/helpers/workspace-fixture.js');
const { up: migrate099 } = await import('../../database/migrations/knex/099_ops_staging_channel.js');
const {
  stagingExecutorDigest, verifyStagingExecutor, reapStagingChannel, STAGING_TARGET, STAGING_PROFILE,
  acquireStagingLease, releaseStagingLease, heartbeatStagingLease, liveStagingLease, canonicalJson, signBody,
} = await import('../../services/ops/stagingExecutionBroker.js');
const { buildOpsGateEnv, verifyOpsGateToken, signOpsGateToken, OPS_TOKEN_ENV, OPS_URL_ENV } = await import('../../services/ops/opsGate.js');
const { default: stagingAuthedRouter, stagingGateRouter } = await import('../../routes/v3/ops-staging.js');
const { opsToolHandlers } = await import('../../services/agent-tools/ops-tools.js');

process.env.OPS_STAGING_EXECUTOR_SHA256 = stagingExecutorDigest(EXEC_ROOT);

function startExecutor(sock, extraEnv = {}) {
  const child = spawn('/usr/bin/python3', [path.join(EXEC_ROOT, 'executor.py')], {
    env: {
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', STAGING_SOCKET: sock, STAGING_CHANNEL_KEY_FILE: KEY_FILE,
      STAGING_SOURCE_REPO: SRC, STAGING_PREFLIGHT_REMOTE: '0', STAGING_COORD_DB: process.env.POSTGRES_DB,
      STAGING_PREFLIGHT_TIMEOUT: '120', ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    child.stdout.once('data', () => resolve(child));
    child.once('exit', (code) => reject(new Error(`executor exited ${code}`)));
  });
}

let ws;
let gateServer;
let executor;
let slowExecutor;
let agentIds = [];
const savedPort = process.env.PORT;

async function insertAgent(slug, status = 'active') {
  const row = await dbGet(
    `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (1784, ?, ?::jsonb, 1) RETURNING id`,
    [`staging-test-${Math.random().toString(36).slice(2, 10)}`, JSON.stringify({ name: `Staging ${slug}`, slug, status })]
  );
  agentIds.push(row.id);
  return row.id;
}

function ownerApp(userId) {
  const app = express();
  app.use(express.json());
  app.use('/api/v3', (req, _res, next) => { req.user = { id: userId, role: 'user' }; next(); }, stagingAuthedRouter);
  return app;
}

const issue = (userId, body) => request(ownerApp(userId)).post('/api/v3/ops/staging/grants').send({ space_id: ws.spaceId, candidate_sha: CANDIDATE, ...body });

/** Put the agent's spawn-time env in place and call the real tool handler. */
async function asAgent(agentId, fn, { spaceId = ws.spaceId, token } = {}) {
  const env = token !== undefined
    ? { [OPS_TOKEN_ENV]: token, [OPS_URL_ENV]: `http://127.0.0.1:${process.env.PORT}/api/v3/ops` }
    : await buildOpsGateEnv({ agentId, spaceId, jobId: 'dispatch-1' });
  const saved = { [OPS_TOKEN_ENV]: process.env[OPS_TOKEN_ENV], [OPS_URL_ENV]: process.env[OPS_URL_ENV] };
  delete process.env[OPS_TOKEN_ENV]; delete process.env[OPS_URL_ENV];
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await migrate099({ raw: (sql) => dbRun(sql) });
  await migrate099({ raw: (sql) => dbRun(sql) }); // idempotent
  await dbRun(`DELETE FROM ops_staging_leases WHERE released_at IS NULL AND holder_pid = ?`, [process.pid]);
  gateServer = express().use('/api/v3/ops', stagingGateRouter).listen(0, '127.0.0.1');
  await new Promise((r) => gateServer.once('listening', r));
  process.env.PORT = String(gateServer.address().port);
  executor = await startExecutor(SOCK);
  slowExecutor = await startExecutor(SLOW_SOCK, { STAGING_PREFLIGHT_REMOTE: '1', PATH: `${STUB_BIN}:/usr/sbin:/usr/bin:/sbin:/bin`, STAGING_PREFLIGHT_TIMEOUT: '4' });
}, 30_000);

afterAll(async () => {
  if (savedPort === undefined) delete process.env.PORT; else process.env.PORT = savedPort;
  await new Promise((r) => gateServer.close(r));
  for (const p of [executor, slowExecutor]) if (p) p.kill('SIGKILL');
  fs.rmSync(WORK, { recursive: true, force: true });
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'staging-channel' });
  process.env.OPS_STAGING_SPACE_ID = String(ws.spaceId);
});

afterEach(async () => {
  await dbRun(`DELETE FROM ops_staging_leases WHERE space_id = ?`, [ws.spaceId]);
  await dbRun(`DELETE FROM ops_staging_runs WHERE space_id = ?`, [ws.spaceId]);
  await dbRun(`DELETE FROM ops_staging_grants WHERE space_id = ?`, [ws.spaceId]);
  if (agentIds.length) await dbRun(`DELETE FROM table_rows WHERE id = ANY(?)`, [agentIds]);
  agentIds = [];
  delete process.env.OPS_STAGING_SPACE_ID;
  await ws.cleanup();
});

// ─── grants ─────────────────────────────────────────────────────────

describe('grant issuance (owner of the staging space)', () => {
  it('binds sysadmin role, exact candidate, fixed target and the installed executor digest', async () => {
    const sysadmin = await insertAgent('sysadmin');
    const res = await issue(ws.userId, { agent_id: sysadmin, job_id: 'pilot-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const g = res.body.data.grant;
    expect(g).toMatchObject({ role: 'sysadmin', candidate_sha: CANDIDATE, repo: SRC, actions: STAGING_PROFILE.actions,
      target: STAGING_TARGET, executor_sha256: process.env.OPS_STAGING_EXECUTOR_SHA256 });
    expect(new Date(g.expires_at) - new Date(g.issued_at)).toBeLessThanOrEqual(3600 * 1000);
    expect(g.actions).toEqual(['staging.preflight']);
  });

  it('refuses other roles, inactive agents, strangers, another space, unknown candidates and extra fields', async () => {
    const dev = await insertAgent('developer-ralph');
    expect((await issue(ws.userId, { agent_id: dev, job_id: 'j' })).status).toBe(403);
    const sleeping = await insertAgent('sysadmin', 'inactive');
    expect((await issue(ws.userId, { agent_id: sleeping, job_id: 'j' })).status).toBe(409);
    const sysadmin = await insertAgent('sysadmin');
    const stranger = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'staging-stranger' });
    try {
      expect((await issue(stranger.userId, { agent_id: sysadmin, job_id: 'j' })).status).toBe(403);
      expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', space_id: stranger.spaceId })).status).toBe(403);
    } finally { await stranger.cleanup(); }
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', candidate_sha: 'f'.repeat(40) })).body.error.reason).toBe('candidate_unknown');
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', candidate_sha: 'HEAD' })).status).toBe(400);
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', actions: ['staging.deploy'] })).status).toBe(400);
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', repo: '/srv/godcrm/live' })).status).toBe(400);
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', ttl_seconds: 7200 })).status).toBe(400);
    expect(await dbGet(`SELECT count(*)::int AS n FROM ops_staging_grants WHERE space_id = ?`, [ws.spaceId])).toEqual({ n: 0 });
  });

  it('mints the gate token only while a live staging grant exists; revocation ends it', async () => {
    const sysadmin = await insertAgent('sysadmin');
    expect(await buildOpsGateEnv({ agentId: sysadmin, spaceId: ws.spaceId })).toEqual({});
    const { body } = await issue(ws.userId, { agent_id: sysadmin, job_id: 'pilot-1' });
    const env = await buildOpsGateEnv({ agentId: sysadmin, spaceId: ws.spaceId, jobId: 9 });
    expect(verifyOpsGateToken(env[OPS_TOKEN_ENV])).toMatchObject({ typ: 'ops_gate', agent_id: sysadmin, space_id: ws.spaceId, dispatch_job_id: '9' });
    const info = await asAgent(sysadmin, () => opsToolHandlers.ops_staging_grant_info());
    expect(info.grants[0]).toMatchObject({ job_id: 'pilot-1', candidate_sha: CANDIDATE, actions: ['staging.preflight'], target: STAGING_TARGET });
    expect((await request(ownerApp(ws.userId)).delete(`/api/v3/ops/staging/grants/${body.data.grant.id}`)).status).toBe(200);
    expect(await buildOpsGateEnv({ agentId: sysadmin, spaceId: ws.spaceId })).toEqual({});
  });
});

// ─── transport ──────────────────────────────────────────────────────

describe('agent transport: ops_staging_preflight → broker → independent executor', () => {
  let sysadmin;
  const base = () => ({ action: 'staging.preflight', job_id: 'pilot-1', candidate_sha: CANDIDATE });
  beforeEach(async () => {
    sysadmin = await insertAgent('sysadmin');
    const res = await issue(ws.userId, { agent_id: sysadmin, job_id: 'pilot-1' });
    expect(res.status).toBe(201);
  });

  it('runs three preflights for the pinned candidate; every run leaves a receipt and releases its lease', async () => {
    for (let i = 0; i < 3; i += 1) {
      const out = await asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()));
      expect(out.error, JSON.stringify(out)).toBeUndefined();
      expect(out).toMatchObject({ decision: 'allow', action: 'staging.preflight', job_id: 'pilot-1', agent_id: sysadmin, space_id: ws.spaceId,
        candidate_sha: CANDIDATE, executor_sha256: process.env.OPS_STAGING_EXECUTOR_SHA256, target: STAGING_TARGET, authorizes_release: false });
      expect(out.run_id).toEqual(expect.any(Number));
      expect(out.log_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(out.checks.source).toMatchObject({ ok: true, head: CANDIDATE, head_is_candidate: true, clean: true, candidate_exists: true, on_main: true });
      expect(out.checks.config_digests).toMatchObject({ ok: true, dev_host: 'dev72' });
      expect(out.checks.installed_code).toMatchObject({ ok: true, unprotected: [] });
      expect(out.checks.coordination).toMatchObject({ foreign_leases_live: 0, database: process.env.POSTGRES_DB });
      expect(out.checks.remote_identity).toBeUndefined(); // remote checks are the executor's decision, not the request's
      const allOk = Object.values(out.checks).every((c) => c.ok === true);
      expect(out.exit_code).toBe(allOk ? 0 : 1);
      expect(out.status).toBe(allOk ? 'finished' : 'preflight_failed');
      expect(JSON.stringify(out)).not.toMatch(/artifacts|stdout|stderr|POSTGRES_PASSWORD/);
    }
    const runs = await dbAll(`SELECT decision, status, exit_code, executor_sha256, log_sha256 FROM ops_staging_runs WHERE space_id = ? ORDER BY id`, [ws.spaceId]);
    expect(runs).toHaveLength(3);
    for (const r of runs) {
      expect(r.decision).toBe('allow');
      expect(['finished', 'failed']).toContain(r.status);
      expect(r.executor_sha256).toBe(process.env.OPS_STAGING_EXECUTOR_SHA256);
      expect(r.log_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const leases = await dbAll(`SELECT purpose, released_at, release_reason, run_id FROM ops_staging_leases WHERE space_id = ? ORDER BY id`, [ws.spaceId]);
    expect(leases).toHaveLength(3);
    expect(leases.every((l) => l.purpose === 'preflight' && l.released_at && l.release_reason === 'run_finished' && l.run_id)).toBe(true);
    // The owner sees receipts and leases; the holder token never leaves the broker.
    const audit = await request(ownerApp(ws.userId)).get(`/api/v3/ops/staging/runs?space_id=${ws.spaceId}`);
    expect(audit.body.data.runs).toHaveLength(3);
    const leaseView = await request(ownerApp(ws.userId)).get(`/api/v3/ops/staging/leases?space_id=${ws.spaceId}`);
    expect(leaseView.body.data.leases[0].holder_token).toBeUndefined();
  }, 60_000);

  it('denies every wrong identity / job / space / SHA / scope / action / field before opening the socket, with receipts', async () => {
    const run = (args, opts) => asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(args), opts);
    const expectDeny = async (args, reason, opts) => expect(await run(args, opts)).toMatchObject({ error: 'ops_denied', reason });
    await expectDeny({ ...base(), candidate_sha: 'f'.repeat(40) }, 'sha_mismatch');
    await expectDeny({ ...base(), candidate_sha: 'not-a-sha' }, 'invalid_sha');
    await expectDeny({ ...base(), action: 'staging.deploy' }, 'action_denied');
    await expectDeny({ ...base(), action: 'staging.restart' }, 'action_denied');
    await expectDeny({ ...base(), action: 'host.identity' }, 'action_denied');
    await expectDeny({ ...base(), job_id: 'someone-elses-job' }, 'no_live_grant');
    await expectDeny({ ...base(), suite_id: 'isolation' }, 'unexpected_field');
    await expectDeny({ ...base(), command: 'make dev' }, 'unexpected_field');
    await expectDeny({ ...base(), target: 'prod' }, 'unexpected_field');
    // Foreign identity: a well-formed token for another agent / another space.
    const other = await insertAgent('sysadmin');
    await expectDeny(base(), 'no_live_grant', { token: signOpsGateToken({ agentId: other, spaceId: ws.spaceId }) });
    await expectDeny(base(), 'space_denied', { token: signOpsGateToken({ agentId: sysadmin, spaceId: ws.spaceId + 1 }) });
    // Forged / foreign-typed / absent tokens never reach the broker logic.
    await expectDeny(base(), 'OPS_GATE_UNAUTHORIZED', { token: jwt.sign({ typ: 'ops_gate', agent_id: sysadmin, space_id: ws.spaceId }, 'wrong-secret') });
    await expectDeny(base(), 'OPS_GATE_UNAUTHORIZED', { token: jwt.sign({ typ: 'mcp_gate', connector_id: 1, agent_id: sysadmin, space_id: ws.spaceId }, process.env.JWT_SECRET) });
    await expectDeny(base(), 'no_gate_token', { token: '' });
    // Role drift and deactivation after issuance.
    await dbRun(`UPDATE table_rows SET data = data || '{"slug":"developer-ralph"}'::jsonb WHERE id = ?`, [sysadmin]);
    await expectDeny(base(), 'role_changed');
    await dbRun(`UPDATE table_rows SET data = data || '{"slug":"sysadmin","status":"inactive"}'::jsonb WHERE id = ?`, [sysadmin]);
    await expectDeny(base(), 'agent_inactive');
    await dbRun(`UPDATE table_rows SET data = data || '{"status":"active"}'::jsonb WHERE id = ?`, [sysadmin]);
    // The tool handler drops extra fields before the broker; a client that bypasses it is caught by the broker, with a receipt.
    const rawExtra = await request(`http://127.0.0.1:${process.env.PORT}`).post('/api/v3/ops/staging/preflight')
      .set('authorization', `Bearer ${signOpsGateToken({ agentId: sysadmin, spaceId: ws.spaceId })}`).send({ ...base(), command: 'make dev' });
    expect(rawExtra.status).toBe(400);
    expect(rawExtra.body.error.reason).toBe('unexpected_field');
    const receipts = await dbAll(`SELECT decision, status, reason, request FROM ops_staging_runs WHERE space_id = ? ORDER BY id`, [ws.spaceId]);
    expect(receipts.map((r) => r.reason)).toEqual(['sha_mismatch', 'invalid_sha', 'action_denied', 'action_denied', 'action_denied', 'no_live_grant',
      'no_live_grant', 'role_changed', 'agent_inactive', 'unexpected_field']);
    expect(receipts.every((r) => r.decision === 'deny' && r.status === 'denied')).toBe(true);
    expect(receipts.at(-1).request).toMatchObject({ command: '<rejected>', action: 'staging.preflight' });
    // The foreign-space attempt is receipted under the space the token named, not ours.
    expect(await dbGet(`SELECT reason FROM ops_staging_runs WHERE space_id = ? AND agent_id = ?`, [ws.spaceId + 1, sysadmin])).toEqual({ reason: 'space_denied' });
    await dbRun(`DELETE FROM ops_staging_runs WHERE space_id = ? AND agent_id = ?`, [ws.spaceId + 1, sysadmin]);
    expect(await dbGet(`SELECT count(*)::int AS n FROM ops_staging_runs WHERE space_id = ? AND decision = 'allow'`, [ws.spaceId])).toEqual({ n: 0 });
    expect(await dbGet(`SELECT count(*)::int AS n FROM ops_staging_leases WHERE space_id = ?`, [ws.spaceId])).toEqual({ n: 0 });
  });

  it('fails closed on expiry and revocation, and on a changed or unpinned executor', async () => {
    const grant = await dbGet(`SELECT id FROM ops_staging_grants WHERE space_id = ?`, [ws.spaceId]);
    const token = signOpsGateToken({ agentId: sysadmin, spaceId: ws.spaceId });
    await dbRun(`UPDATE ops_staging_grants SET issued_at = now() - interval '30 minutes', expires_at = now() - interval '1 second' WHERE id = ?`, [grant.id]);
    expect(await asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()), { token })).toMatchObject({ reason: 'no_live_grant' });
    await dbRun(`UPDATE ops_staging_grants SET expires_at = now() + interval '20 minutes', revoked_at = now() WHERE id = ?`, [grant.id]);
    expect(await asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()), { token })).toMatchObject({ reason: 'no_live_grant' });
    await dbRun(`UPDATE ops_staging_grants SET revoked_at = NULL WHERE id = ?`, [grant.id]);
    // Executor replaced after issuance: the grant's digest no longer matches the pinned installation.
    const pin = process.env.OPS_STAGING_EXECUTOR_SHA256;
    await dbRun(`UPDATE ops_staging_grants SET executor_sha256 = ? WHERE id = ?`, ['0'.repeat(64), grant.id]);
    expect(await asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()))).toMatchObject({ reason: 'executor_changed' });
    await dbRun(`UPDATE ops_staging_grants SET executor_sha256 = ? WHERE id = ?`, [pin, grant.id]);
    // Tampered installation / wrong pin / exposed key.
    const forged = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-forged-'));
    try {
      fs.cpSync(EXEC_ROOT, forged, { recursive: true });
      fs.appendFileSync(path.join(forged, 'executor.py'), "\nACTIONS = frozenset(('staging.preflight', 'staging.deploy'))\n");
      process.env.OPS_STAGING_EXECUTOR_ROOT = forged;
      expect(verifyStagingExecutor()).toMatchObject({ ok: false, reason: 'executor_digest_mismatch' });
      expect(await asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()))).toMatchObject({ reason: 'executor_digest_mismatch' });
      process.env.OPS_STAGING_EXECUTOR_ROOT = EXEC_ROOT;
      fs.chmodSync(path.join(EXEC_ROOT, 'preflight.py'), 0o666);
      expect(verifyStagingExecutor()).toMatchObject({ ok: false, reason: 'executor_not_root_owned', file: 'preflight.py' });
      fs.chmodSync(path.join(EXEC_ROOT, 'preflight.py'), 0o644);
      fs.chmodSync(KEY_FILE, 0o644);
      expect(verifyStagingExecutor()).toMatchObject({ ok: false, reason: 'channel_key_exposed' });
      fs.chmodSync(KEY_FILE, 0o600);
      delete process.env.OPS_STAGING_EXECUTOR_SHA256;
      expect(await asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()))).toMatchObject({ reason: 'executor_pin_missing' });
    } finally {
      process.env.OPS_STAGING_EXECUTOR_ROOT = EXEC_ROOT;
      process.env.OPS_STAGING_EXECUTOR_SHA256 = pin;
      fs.chmodSync(KEY_FILE, 0o600);
      fs.rmSync(forged, { recursive: true, force: true });
    }
    expect(verifyStagingExecutor().ok).toBe(true);
    const status = await request(ownerApp(ws.userId)).get(`/api/v3/ops/staging/executor?space_id=${ws.spaceId}`);
    expect(status.body.data).toMatchObject({ ok: true, digest: pin });
    expect(status.body.data.socket).toBeUndefined();
  });

  it('the executor itself rejects what the broker would never send: wrong key, replay, stale, extra keys, foreign action/target/repo/digest', async () => {
    const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
    const grant = await dbGet(`SELECT * FROM ops_staging_grants WHERE space_id = ?`, [ws.spaceId]);
    const body = (patch = {}) => ({
      v: 1, run_id: 424242, nonce: crypto.randomBytes(16).toString('hex'), issued_at: Math.floor(Date.now() / 1000), deadline_s: 120,
      action: 'staging.preflight', job_id: 'pilot-1', agent_id: sysadmin, space_id: ws.spaceId, role: 'sysadmin',
      candidate_sha: CANDIDATE, source_repo: SRC, expected_executor_sha256: grant.executor_sha256, target: { ...STAGING_TARGET }, ...patch,
    });
    const raw = (envelope) => new Promise((resolve) => {
      const sock = net.createConnection(SOCK);
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('connect', () => sock.write(JSON.stringify(envelope) + '\n'));
      sock.on('data', (d) => { buf += d; });
      sock.on('close', () => resolve(JSON.parse(buf.trim())));
    });
    const send = (b, k = key) => raw({ body: b, sig: signBody(k, b) });
    expect((await send(body(), 'x'.repeat(64))).body.denied).toBe('bad_signature');
    expect((await raw({ body: body(), sig: signBody(key, body()), extra: 1 })).body.denied).toBe('invalid_envelope');
    expect((await send(body({ shell: 'id' }))).body.denied).toBe('invalid_request');
    expect((await send(body({ issued_at: Math.floor(Date.now() / 1000) - 600 }))).body.denied).toBe('stale_request');
    expect((await send(body({ action: 'staging.deploy' }))).body.denied).toBe('action_denied');
    expect((await send(body({ role: 'developer-ralph' }))).body.denied).toBe('role_denied');
    expect((await send(body({ target: { ...STAGING_TARGET, database: 'godcrm_prod' } }))).body.denied).toBe('target_mismatch');
    expect((await send(body({ source_repo: REPO }))).body.denied).toBe('repo_mismatch');
    expect((await send(body({ expected_executor_sha256: '0'.repeat(64) }))).body.denied).toBe('executor_digest_mismatch');
    expect((await send(body({ deadline_s: 0 }))).body.denied).toBe('deadline_denied');
    const once = body();
    const first = await send(once);
    expect(first.body.denied).toBeUndefined();
    expect(first.sig).toBe(signBody(key, first.body)); // reply is signed with the shared key
    expect((await send(once)).body.denied).toBe('replay');
    expect(canonicalJson({ b: [1, { d: null, c: 'x' }], a: true })).toBe('{"a":true,"b":[1,{"c":"x","d":null}]}');
  }, 30_000);

  it('contention: a live lease held by someone else denies the run; a foreign token cannot release it', async () => {
    const grant = await dbGet(`SELECT * FROM ops_staging_grants WHERE space_id = ?`, [ws.spaceId]);
    const held = await acquireStagingLease({ grant, purpose: 'quiet-window', ttlSeconds: 600, writers: { cron: ['sync-uploads'] } });
    expect(held.holder_token).toMatch(/^[0-9a-f]{32}$/);
    expect(await asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()))).toMatchObject({ reason: 'lease_held' });
    expect(await dbGet(`SELECT status, reason FROM ops_staging_runs WHERE space_id = ? AND decision = 'allow'`, [ws.spaceId])).toEqual({ status: 'denied', reason: 'lease_held' });
    await expect(acquireStagingLease({ grant, purpose: 'preflight', ttlSeconds: 60 })).rejects.toMatchObject({ reason: 'lease_held' });
    expect(await releaseStagingLease(held.id, 'not-the-token', 'stolen')).toBeNull();
    expect((await liveStagingLease()).id).toBe(held.id);
    expect(await heartbeatStagingLease(held.id, held.holder_token)).toEqual({ id: held.id });
    expect(await heartbeatStagingLease(held.id, 'not-the-token')).toBeNull();
    expect(await releaseStagingLease(held.id, held.holder_token, 'done')).toEqual({ id: held.id });
    expect(await liveStagingLease()).toBeNull();
    const out = await asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()));
    expect(out.error, JSON.stringify(out)).toBeUndefined();
    // Lease TTL is capped by the schema as well as the broker.
    await expect(dbRun(`INSERT INTO ops_staging_leases (job_id, agent_id, space_id, purpose, holder_pid, holder_token, expires_at)
                        VALUES ('x', ?, ?, 'quiet-window', 1, 't', now() + interval '31 minutes')`, [sysadmin, ws.spaceId])).rejects.toThrow();
  }, 60_000);

  it('revoking the grant mid-run closes the channel: the executor kills preflight, the run is failed 124, the lease released', async () => {
    process.env.OPS_STAGING_SOCKET = SLOW_SOCK;
    const pidFile = path.join(WORK, 'ssh.pid');
    fs.rmSync(pidFile, { force: true });
    try {
      const grant = await dbGet(`SELECT id FROM ops_staging_grants WHERE space_id = ?`, [ws.spaceId]);
      const pending = asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()));
      await sleep(2500);
      expect((await liveStagingLease())?.purpose).toBe('preflight');
      const sshPid = Number(fs.readFileSync(pidFile, 'utf8'));
      expect(pidAlive(sshPid)).toBe(true);
      expect((await request(ownerApp(ws.userId)).delete(`/api/v3/ops/staging/grants/${grant.id}`)).status).toBe(200);
      const out = await pending;
      expect(out).toMatchObject({ error: 'ops_denied', reason: 'revoked' });
      await sleep(1500);
      expect(pidAlive(sshPid)).toBe(false);
      const run = await dbGet(`SELECT status, exit_code, reason FROM ops_staging_runs WHERE space_id = ? AND decision = 'allow'`, [ws.spaceId]);
      expect(run).toEqual({ status: 'failed', exit_code: 124, reason: 'revoked' });
      expect(await liveStagingLease()).toBeNull();
      expect(await dbGet(`SELECT release_reason FROM ops_staging_leases WHERE space_id = ?`, [ws.spaceId])).toEqual({ release_reason: 'revoked' });
    } finally { process.env.OPS_STAGING_SOCKET = SOCK; }
  }, 30_000);

  it('the executor deadline stops a hung preflight (timeout 124) without the broker doing anything', async () => {
    process.env.OPS_STAGING_SOCKET = SLOW_SOCK;
    const pidFile = path.join(WORK, 'ssh.pid');
    fs.rmSync(pidFile, { force: true });
    try {
      const out = await asAgent(sysadmin, () => opsToolHandlers.ops_staging_preflight(base()));
      expect(out.error, JSON.stringify(out)).toBeUndefined();
      expect(out).toMatchObject({ status: 'timeout', exit_code: 124, checks: null });
      await sleep(500);
      expect(pidAlive(Number(fs.readFileSync(pidFile, 'utf8')))).toBe(false);
      expect(await dbGet(`SELECT status, exit_code FROM ops_staging_runs WHERE space_id = ? AND decision = 'allow'`, [ws.spaceId])).toEqual({ status: 'failed', exit_code: 124 });
      expect(await liveStagingLease()).toBeNull();
    } finally { process.env.OPS_STAGING_SOCKET = SOCK; }
  }, 30_000);

  it('a broker that dies (socket closes) makes the executor stop its own preflight and accept the next run', async () => {
    const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
    const pidFile = path.join(WORK, 'ssh.pid');
    fs.rmSync(pidFile, { force: true });
    const body = {
      v: 1, run_id: 777, nonce: crypto.randomBytes(16).toString('hex'), issued_at: Math.floor(Date.now() / 1000), deadline_s: 4,
      action: 'staging.preflight', job_id: 'pilot-1', agent_id: sysadmin, space_id: ws.spaceId, role: 'sysadmin',
      candidate_sha: CANDIDATE, source_repo: SRC, expected_executor_sha256: process.env.OPS_STAGING_EXECUTOR_SHA256, target: { ...STAGING_TARGET },
    };
    const sock = net.createConnection(SLOW_SOCK);
    await new Promise((r) => sock.on('connect', r));
    sock.write(JSON.stringify({ body, sig: signBody(key, body) }) + '\n');
    await sleep(2000);
    const sshPid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(pidAlive(sshPid)).toBe(true);
    sock.destroy(); // the broker is gone
    await sleep(1500);
    expect(pidAlive(sshPid)).toBe(false);
    // The run slot is free again: the next request is not `busy`.
    const next = { ...body, nonce: crypto.randomBytes(16).toString('hex'), issued_at: Math.floor(Date.now() / 1000), deadline_s: 1 };
    const reply = await new Promise((resolve) => {
      const s = net.createConnection(SLOW_SOCK);
      let buf = '';
      s.setEncoding('utf8');
      s.on('connect', () => s.write(JSON.stringify({ body: next, sig: signBody(key, next) }) + '\n'));
      s.on('data', (d) => { buf += d; });
      s.on('close', () => resolve(JSON.parse(buf.trim())));
    });
    expect(reply.body.denied).toBeUndefined();
    expect(reply.body.status).toBe('timeout');
  }, 30_000);

  it('reaps receipts and leases a dead broker left behind', async () => {
    const grant = await dbGet(`SELECT * FROM ops_staging_grants WHERE space_id = ?`, [ws.spaceId]);
    await dbRun(`INSERT INTO ops_staging_runs (grant_id, agent_id, space_id, job_id, action, request, decision, status, broker_pid)
                 VALUES (?, ?, ?, 'pilot-1', 'staging.preflight', '{}'::jsonb, 'allow', 'running', 999999)`, [grant.id, sysadmin, ws.spaceId]);
    await dbRun(`INSERT INTO ops_staging_leases (grant_id, job_id, agent_id, space_id, purpose, holder_pid, holder_token, expires_at)
                 VALUES (?, 'pilot-1', ?, ?, 'quiet-window', 999999, 'dead', now() + interval '10 minutes')`, [grant.id, sysadmin, ws.spaceId]);
    const summary = await reapStagingChannel();
    expect(summary.runs_reaped).toBeGreaterThanOrEqual(1);
    expect(summary.leases_released).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'broker_dead' })]));
    expect(await dbGet(`SELECT status, reason FROM ops_staging_runs WHERE grant_id = ?`, [grant.id])).toEqual({ status: 'reaped', reason: 'broker_dead' });
    expect(await liveStagingLease()).toBeNull();
    // A live lease this very process heartbeats is never touched.
    const mine = await acquireStagingLease({ grant, purpose: 'quiet-window', ttlSeconds: 300 });
    expect((await reapStagingChannel()).leases_released).toEqual([]);
    await releaseStagingLease(mine.id, mine.holder_token, 'test_done');
    // Reap via the owner API too.
    expect((await request(ownerApp(ws.userId)).post('/api/v3/ops/staging/reap').send({ space_id: ws.spaceId })).status).toBe(200);
  });
});
