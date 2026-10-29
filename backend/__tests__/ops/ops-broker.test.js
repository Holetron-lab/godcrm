// @vitest-environment node
/**
 * Ops profiles broker — the full agent transport, end to end:
 *
 *   ops_run_check (tool handler, env token) → POST /api/v3/ops/run [listening here]
 *     → runCheck() → python3 <root>/ops-runner/broker-entry.py → profiles.run_check
 *
 * The executor root is a root-owned copy of scripts/ops-runner* pinned by
 * digest, exactly as an installation would be. Diagnostics run for real
 * (host.identity / disk.status are offline). local-qa runs the real Docker
 * image pinned on this box; those cases skip when the image is absent.
 *
 * Boot guard first (ADR-0009): direct `vitest run <file>` must still abort on a
 * non-test database.
 */
import './../../test/setup.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const HEAD = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const NODE_IMAGE = 'sha256:3423d524d23e3c11992d3c1d614ac7759b83d7d3454480505c9d49e01c7e4294';
const MODULES = fs.realpathSync(path.join(REPO, 'node_modules'));

function dockerHas(image) {
  try { execFileSync('/usr/bin/docker', ['image', 'inspect', image], { stdio: 'ignore' }); return true; } catch { return false; }
}
const DOCKER = dockerHas(NODE_IMAGE);

// Install a trusted copy of the executor: root-owned, no group/world write.
const EXEC_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-exec-'));
fs.copyFileSync(path.join(REPO, 'scripts/ops-runner.py'), path.join(EXEC_ROOT, 'ops-runner.py'));
fs.cpSync(path.join(REPO, 'scripts/ops-runner'), path.join(EXEC_ROOT, 'ops-runner'), { recursive: true });
fs.rmSync(path.join(EXEC_ROOT, 'ops-runner/__pycache__'), { recursive: true, force: true });
execFileSync('chmod', ['-R', 'go-w', EXEC_ROOT]);
process.env.OPS_EXECUTOR_ROOT = EXEC_ROOT;
process.env.OPS_QA_IMAGE = NODE_IMAGE;
process.env.OPS_QA_MODULES = MODULES;

const { dbRun, dbGet, dbAll } = await import('../../database/connection.js');
const { createEphemeralWorkspace } = await import('../../tests/helpers/workspace-fixture.js');
const { up: migrate098 } = await import('../../database/migrations/knex/098_ops_grants.js');
const { executorDigest, verifyExecutor, reapOpsWorkers, PROFILES } = await import('../../services/ops/opsBroker.js');
const { buildOpsGateEnv, verifyOpsGateToken, signOpsGateToken, OPS_TOKEN_ENV, OPS_URL_ENV } = await import('../../services/ops/opsGate.js');
const { default: opsAuthedRouter, opsGateRouter } = await import('../../routes/v3/ops.js');
const { opsToolHandlers } = await import('../../services/agent-tools/ops-tools.js');

process.env.OPS_EXECUTOR_SHA256 = executorDigest(EXEC_ROOT);

let ws;          // owner user + space
let gateServer;
let agentIds = [];
const savedPort = process.env.PORT;

async function insertAgent(slug, status = 'active') {
  const row = await dbGet(
    `INSERT INTO table_rows (table_id, base_id, data, created_by)
     VALUES (1784, ?, ?::jsonb, 1) RETURNING id`,
    [`ops-test-${Math.random().toString(36).slice(2, 10)}`, JSON.stringify({ name: `Ops ${slug}`, slug, status })]
  );
  agentIds.push(row.id);
  return row.id;
}

function ownerApp(userId) {
  const app = express();
  app.use(express.json());
  app.use('/api/v3', (req, _res, next) => { req.user = { id: userId, role: 'user' }; next(); }, opsAuthedRouter);
  return app;
}

async function issue(userId, body) {
  return request(ownerApp(userId)).post('/api/v3/ops/grants').send({ space_id: ws.spaceId, repo: REPO, ...body });
}

/** Put the agent's spawn-time env in place and call the real tool handler. */
async function asAgent(agentId, fn, { spaceId = ws.spaceId, token } = {}) {
  const env = token !== undefined
    ? { [OPS_TOKEN_ENV]: token, [OPS_URL_ENV]: `http://127.0.0.1:${process.env.PORT}/api/v3/ops` }
    : await buildOpsGateEnv({ agentId, spaceId, jobId: 'dispatch-1' });
  const saved = { [OPS_TOKEN_ENV]: process.env[OPS_TOKEN_ENV], [OPS_URL_ENV]: process.env[OPS_URL_ENV] };
  delete process.env[OPS_TOKEN_ENV]; delete process.env[OPS_URL_ENV];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const containerExists = (name) => execFileSync('/usr/bin/docker', ['ps', '-a', '-q', '--filter', `name=^${name}$`], { encoding: 'utf8' }).trim() !== '';

beforeAll(async () => {
  await migrate098({ raw: (sql) => dbRun(sql) });
  await migrate098({ raw: (sql) => dbRun(sql) }); // idempotent
  gateServer = express().use('/api/v3/ops', opsGateRouter).listen(0, '127.0.0.1');
  await new Promise((r) => gateServer.once('listening', r));
  process.env.PORT = String(gateServer.address().port);
});

afterAll(async () => {
  if (savedPort === undefined) delete process.env.PORT; else process.env.PORT = savedPort;
  await new Promise((r) => gateServer.close(r));
  fs.rmSync(EXEC_ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'ops-broker' });
});

afterEach(async () => {
  const runs = await dbAll(`SELECT artifacts FROM ops_runs WHERE space_id = ?`, [ws.spaceId]);
  for (const r of runs) if (r.artifacts?.startsWith('/tmp/godcrm-profile-')) fs.rmSync(r.artifacts, { recursive: true, force: true });
  await dbRun(`DELETE FROM ops_grants WHERE space_id = ?`, [ws.spaceId]); // cascades to ops_runs
  if (agentIds.length) await dbRun(`DELETE FROM table_rows WHERE id = ANY(?)`, [agentIds]);
  agentIds = [];
  await ws.cleanup();
});

describe('grant issuance (space owner / admin)', () => {
  it('resolves role, HEAD and actions from server state; the body only names the target', async () => {
    const sysadmin = await insertAgent('sysadmin');
    const res = await issue(ws.userId, { agent_id: sysadmin, job_id: 'pilot-1', profile: 'diagnostics' });
    expect(res.status).toBe(201);
    const g = res.body.data.grant;
    expect(g.role).toBe('sysadmin');
    expect(g.candidate_sha).toBe(HEAD);
    expect(g.repo).toBe(fs.realpathSync(REPO));
    expect(g.actions).toEqual(PROFILES.diagnostics.actions);
    expect(new Date(g.expires_at) - new Date(g.issued_at)).toBeLessThanOrEqual(3600 * 1000);
  });

  it('refuses a role outside the profile, an inactive agent, a stranger, and extra fields', async () => {
    const qa = await insertAgent('frontend-qa');
    expect((await issue(ws.userId, { agent_id: qa, job_id: 'j', profile: 'diagnostics' })).status).toBe(403);
    const sleeping = await insertAgent('sysadmin', 'inactive');
    expect((await issue(ws.userId, { agent_id: sleeping, job_id: 'j', profile: 'diagnostics' })).status).toBe(409);
    const sysadmin = await insertAgent('sysadmin');
    const stranger = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'ops-stranger' });
    try {
      expect((await issue(stranger.userId, { agent_id: sysadmin, job_id: 'j', profile: 'diagnostics' })).status).toBe(403);
    } finally { await stranger.cleanup(); }
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', profile: 'diagnostics', callback: 'http://x' })).status).toBe(400);
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', profile: 'diagnostics', actions: ['schema.status'] })).status).toBe(400);
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', profile: 'diagnostics', repo: '/srv/godcrm/live' })).status).toBe(400);
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', profile: 'local-qa', suite_ids: ['not-registered'] })).status).toBe(400);
    expect((await issue(ws.userId, { agent_id: sysadmin, job_id: 'j', profile: 'local-qa', suite_ids: ['isolation', 'browser-isolation'] })).status).toBe(400);
  });

  it('mints a gate token only while a live grant exists; revocation ends it', async () => {
    const sysadmin = await insertAgent('sysadmin');
    expect(await buildOpsGateEnv({ agentId: sysadmin, spaceId: ws.spaceId })).toEqual({});
    const { body } = await issue(ws.userId, { agent_id: sysadmin, job_id: 'pilot-1', profile: 'diagnostics' });
    const env = await buildOpsGateEnv({ agentId: sysadmin, spaceId: ws.spaceId, jobId: 7 });
    const claims = verifyOpsGateToken(env[OPS_TOKEN_ENV]);
    expect(claims).toMatchObject({ typ: 'ops_gate', agent_id: sysadmin, space_id: ws.spaceId, dispatch_job_id: '7' });
    const revoked = await request(ownerApp(ws.userId)).delete(`/api/v3/ops/grants/${body.data.grant.id}`);
    expect(revoked.status).toBe(200);
    expect(await buildOpsGateEnv({ agentId: sysadmin, spaceId: ws.spaceId })).toEqual({});
  });
});

describe('agent transport: ops_run_check → broker → executor', () => {
  let sysadmin;
  beforeEach(async () => {
    sysadmin = await insertAgent('sysadmin');
    await issue(ws.userId, { agent_id: sysadmin, job_id: 'pilot-1', profile: 'diagnostics' });
  });

  it('runs three diagnostics per action through the real path and records every run', async () => {
    for (const action of ['host.identity', 'disk.status']) {
      for (let i = 0; i < 3; i += 1) {
        const out = await asAgent(sysadmin, () => opsToolHandlers.ops_run_check({ action, job_id: 'pilot-1', candidate_sha: HEAD }));
        expect(out.error).toBeUndefined();
        expect(out.exit_code).toBe(0);
        expect(out.executor_sha256).toBe(process.env.OPS_EXECUTOR_SHA256);
        expect(out.artifacts).toBeUndefined();
        if (action === 'host.identity') expect(out.checks).toMatchObject({ host: '<PROD_IP>', expected_host: expect.any(Boolean) });
        else expect(out.checks.target).toBe('/srv/godcrm');
      }
    }
    const runs = await dbAll(`SELECT action, status, exit_code, executor_sha256 FROM ops_runs WHERE space_id = ?`, [ws.spaceId]);
    expect(runs).toHaveLength(6);
    expect(runs.every((r) => r.status === 'finished' && r.exit_code === 0 && r.executor_sha256 === process.env.OPS_EXECUTOR_SHA256)).toBe(true);
    const info = await asAgent(sysadmin, () => opsToolHandlers.ops_grant_info());
    expect(info.grants[0]).toMatchObject({ job_id: 'pilot-1', profile: 'diagnostics', candidate_sha: HEAD });
  });

  it('denies every foreign or malformed request before spawning anything', async () => {
    const run = (args, opts) => asAgent(sysadmin, () => opsToolHandlers.ops_run_check(args), opts);
    const base = { action: 'host.identity', job_id: 'pilot-1', candidate_sha: HEAD };
    expect(await run({ ...base, candidate_sha: 'f'.repeat(40) })).toMatchObject({ error: 'ops_denied', reason: 'sha_mismatch' });
    expect(await run({ ...base, action: 'node-test' })).toMatchObject({ reason: 'action_denied' });
    expect(await run({ ...base, action: 'schema.status' })).toMatchObject({ reason: 'action_denied' });
    expect(await run({ ...base, job_id: 'someone-elses-job' })).toMatchObject({ reason: 'no_live_grant' });
    expect(await run({ ...base, suite_id: 'isolation' })).toMatchObject({ reason: 'unexpected_suite' });
    expect(await run({ ...base, shell: 'id' })).toMatchObject({ reason: 'unexpected_field' });
    expect(await run({ ...base, candidate_sha: 'not-a-sha' })).toMatchObject({ reason: 'invalid_sha' });
    // Foreign identity: a well-formed token for another agent, and for another space.
    const other = await insertAgent('sysadmin');
    expect(await run(base, { token: signOpsGateToken({ agentId: other, spaceId: ws.spaceId }) })).toMatchObject({ reason: 'no_live_grant' });
    expect(await run(base, { token: signOpsGateToken({ agentId: sysadmin, spaceId: ws.spaceId + 1 }) })).toMatchObject({ reason: 'no_live_grant' });
    // Forged / foreign-typed tokens never reach the broker logic.
    expect(await run(base, { token: jwt.sign({ typ: 'ops_gate', agent_id: sysadmin, space_id: ws.spaceId }, 'wrong-secret') })).toMatchObject({ reason: 'OPS_GATE_UNAUTHORIZED' });
    expect(await run(base, { token: jwt.sign({ typ: 'mcp_gate', connector_id: 1, agent_id: sysadmin, space_id: ws.spaceId }, process.env.JWT_SECRET) })).toMatchObject({ reason: 'OPS_GATE_UNAUTHORIZED' });
    // No token at all (agent without a grant at spawn time).
    expect(await run(base, { token: '' })).toMatchObject({ reason: 'no_gate_token' });
    // Role drift: the agent row stopped being what the grant was issued for.
    await dbRun(`UPDATE table_rows SET data = data || '{"slug":"frontend-qa"}'::jsonb WHERE id = ?`, [sysadmin]);
    expect(await run(base)).toMatchObject({ reason: 'role_changed' });
    await dbRun(`UPDATE table_rows SET data = data || '{"slug":"sysadmin","status":"inactive"}'::jsonb WHERE id = ?`, [sysadmin]);
    expect(await run(base)).toMatchObject({ reason: 'agent_inactive' });
    expect(await dbGet(`SELECT count(*)::int AS n FROM ops_runs WHERE space_id = ?`, [ws.spaceId])).toEqual({ n: 0 });
  });

  it('fails closed on expiry, revocation and the concurrency quota', async () => {
    const base = { action: 'host.identity', job_id: 'pilot-1', candidate_sha: HEAD };
    const grant = await dbGet(`SELECT id FROM ops_grants WHERE space_id = ?`, [ws.spaceId]);
    await dbRun(`INSERT INTO ops_runs (grant_id, agent_id, space_id, job_id, action, request, status, broker_pid)
                 VALUES (?, ?, ?, 'pilot-1', 'host.identity', '{}'::jsonb, 'running', ?)`, [grant.id, sysadmin, ws.spaceId, process.pid]);
    expect(await asAgent(sysadmin, () => opsToolHandlers.ops_run_check(base))).toMatchObject({ reason: 'concurrency_quota' });
    await dbRun(`UPDATE ops_runs SET status = 'finished' WHERE grant_id = ?`, [grant.id]);
    await dbRun(`UPDATE ops_grants SET issued_at = now() - interval '30 minutes', expires_at = now() - interval '1 second' WHERE id = ?`, [grant.id]);
    expect(await asAgent(sysadmin, () => opsToolHandlers.ops_run_check(base), { token: signOpsGateToken({ agentId: sysadmin, spaceId: ws.spaceId }) })).toMatchObject({ reason: 'no_live_grant' });
    await dbRun(`UPDATE ops_grants SET expires_at = now() + interval '20 minutes', revoked_at = now() WHERE id = ?`, [grant.id]);
    expect(await asAgent(sysadmin, () => opsToolHandlers.ops_run_check(base), { token: signOpsGateToken({ agentId: sysadmin, spaceId: ws.spaceId }) })).toMatchObject({ reason: 'no_live_grant' });
  });

  it('never runs a substituted, tampered or unpinned executor', async () => {
    const base = { action: 'host.identity', job_id: 'pilot-1', candidate_sha: HEAD };
    const root = process.env.OPS_EXECUTOR_ROOT;
    const pin = process.env.OPS_EXECUTOR_SHA256;
    const forged = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-forged-'));
    try {
      fs.cpSync(root, forged, { recursive: true });
      fs.appendFileSync(path.join(forged, 'ops-runner/profiles.py'), '\nROLES["diagnostics"].add("frontend-qa")\n');
      process.env.OPS_EXECUTOR_ROOT = forged;
      expect(verifyExecutor()).toMatchObject({ ok: false, reason: 'executor_digest_mismatch' });
      expect(await asAgent(sysadmin, () => opsToolHandlers.ops_run_check(base))).toMatchObject({ reason: 'executor_digest_mismatch' });
      process.env.OPS_EXECUTOR_ROOT = root;
      fs.chmodSync(path.join(root, 'ops-runner/diagnostics.py'), 0o666);
      expect(verifyExecutor()).toMatchObject({ ok: false, reason: 'executor_not_root_owned', file: 'ops-runner/diagnostics.py' });
      fs.chmodSync(path.join(root, 'ops-runner/diagnostics.py'), 0o644);
      delete process.env.OPS_EXECUTOR_SHA256;
      expect(await asAgent(sysadmin, () => opsToolHandlers.ops_run_check(base))).toMatchObject({ reason: 'executor_pin_missing' });
    } finally {
      process.env.OPS_EXECUTOR_ROOT = root;
      process.env.OPS_EXECUTOR_SHA256 = pin;
      fs.rmSync(forged, { recursive: true, force: true });
    }
    expect(verifyExecutor().ok).toBe(true);
    // The owner sees the same verdict; the entry path stays server-side.
    const status = await request(ownerApp(ws.userId)).get(`/api/v3/ops/executor?space_id=${ws.spaceId}`);
    expect(status.body.data).toMatchObject({ ok: true, digest: pin });
    expect(status.body.data.entry).toBeUndefined();
  });

  it('reaps runs a dead broker left behind', async () => {
    const grant = await dbGet(`SELECT id FROM ops_grants WHERE space_id = ?`, [ws.spaceId]);
    await dbRun(`INSERT INTO ops_runs (grant_id, agent_id, space_id, job_id, action, request, status, broker_pid)
                 VALUES (?, ?, ?, 'pilot-1', 'build', '{}'::jsonb, 'running', 999999)`, [grant.id, sysadmin, ws.spaceId]);
    const summary = await reapOpsWorkers();
    expect(summary.runs_reaped).toBeGreaterThanOrEqual(1);
    expect(await dbGet(`SELECT status FROM ops_runs WHERE grant_id = ?`, [grant.id])).toEqual({ status: 'reaped' });
  });
});

describe.runIf(DOCKER)('local-qa in the isolated container', () => {
  let dev;
  beforeEach(async () => { dev = await insertAgent('developer-ralph'); });

  it('runs the registered node-test suite; the agent gets exit code and log hash, the owner gets the bounded log', async () => {
    const issued = await issue(ws.userId, { agent_id: dev, job_id: 'qa-1', profile: 'local-qa', suite_ids: ['isolation'] });
    expect(issued.status).toBe(201);
    expect(issued.body.data.grant.image).toBe(NODE_IMAGE);
    expect(issued.body.data.grant.actions).toEqual(['node-test']); // only what the suite needs
    const out = await asAgent(dev, () => opsToolHandlers.ops_run_check({ action: 'node-test', job_id: 'qa-1', candidate_sha: HEAD, suite_id: 'isolation' }));
    expect(out.error).toBeUndefined();
    expect(out.exit_code).toBe(0);
    expect(out.container).toMatch(/^godcrm-profile-[0-9a-f]{32}$/);
    expect(out.image).toBe(NODE_IMAGE);
    expect(out.log_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.artifacts).toBeUndefined();
    expect(containerExists(out.container)).toBe(false);
    const row = await dbGet(`SELECT id, status, artifacts FROM ops_runs WHERE id = ?`, [out.run_id]);
    expect(row.status).toBe('finished');
    const log = await request(ownerApp(ws.userId)).get(`/api/v3/ops/runs/${row.id}/log`);
    expect(log.status).toBe(200);
    expect(log.body.data.text).toMatch(/pass 3/);
    // Wrong suite for the action, and a suite the grant does not carry.
    expect(await asAgent(dev, () => opsToolHandlers.ops_run_check({ action: 'vitest', job_id: 'qa-1', candidate_sha: HEAD, suite_id: 'isolation' }))).toMatchObject({ reason: 'action_denied' });
    expect(await asAgent(dev, () => opsToolHandlers.ops_run_check({ action: 'node-test', job_id: 'qa-1', candidate_sha: HEAD, suite_id: 'build' }))).toMatchObject({ reason: 'suite_denied' });
  }, 120_000);

  it('revoking the grant stops a running worker and removes its container', async () => {
    const issued = await issue(ws.userId, { agent_id: dev, job_id: 'qa-2', profile: 'local-qa', suite_ids: ['build'] });
    const grantId = issued.body.data.grant.id;
    const pending = asAgent(dev, () => opsToolHandlers.ops_run_check({ action: 'build', job_id: 'qa-2', candidate_sha: HEAD, suite_id: 'build' }));
    await new Promise((r) => setTimeout(r, 6000));
    expect((await request(ownerApp(ws.userId)).delete(`/api/v3/ops/grants/${grantId}`)).status).toBe(200);
    const out = await pending;
    expect(out.exit_code).toBe(124);
    expect(containerExists(out.container)).toBe(false);
    expect(await dbGet(`SELECT status, exit_code FROM ops_runs WHERE id = ?`, [out.run_id])).toEqual({ status: 'failed', exit_code: 124 });
  }, 120_000);

  it('a broker that dies (stdin closes) makes the entrypoint stop its own container', async () => {
    const now = Date.now() / 1000;
    const context = { job_id: 'qa-3', agent_id: dev, space_id: ws.spaceId, role: 'developer-ralph', repo: fs.realpathSync(REPO), candidate_sha: HEAD };
    const grant = { ...context, profile: 'local-qa', issued_at: now, expires_at: now + 1800, actions: ['build'],
      image: NODE_IMAGE, modules: MODULES, suites: { build: { action: 'build', files: [] } }, revoked: false };
    const child = spawn('/usr/bin/python3', [path.join(EXEC_ROOT, 'ops-runner/broker-entry.py')],
      { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.write(JSON.stringify({ request: { action: 'build', job_id: 'qa-3', candidate_sha: HEAD, suite_id: 'build' }, grant, context }) + '\n');
    await new Promise((r) => setTimeout(r, 6000));
    child.stdin.end(); // the broker is gone
    await new Promise((r) => child.on('close', r));
    const report = JSON.parse(out.trim());
    expect(report.exit_code).toBe(124);
    expect(containerExists(report.container)).toBe(false);
    fs.rmSync(report.artifacts, { recursive: true, force: true });
  }, 120_000);
});
