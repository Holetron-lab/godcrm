import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { dbGet, dbAll, dbRun, withTransactionAsync } from '../../database/connection.js';
import { OpsDenied, loadAgentIdentity } from './opsBroker.js';
import { canonicalJson } from './stagingExecutionBroker.js';
import { browserInstallation, browserExchange } from './stagingBrowserChannel.js';
import { browserRequestSchema, browserBindingSchema, browserCapabilitiesSchema, browserReportSchema, browserPinsSchema, browserArtifactRequestSchema, browserArtifactSchema } from './stagingBrowserContract.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'staging_browser' });
const claimsSchema = z.object({ agent_id: z.number().int().positive(), space_id: z.literal(11), dispatch_job_id: z.string().regex(/^[1-9][0-9]*$/) });
const cleanEnv = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

async function resolveBinding(claims) {
  const parsed = claimsSchema.safeParse(claims);
  if (!parsed.success) throw new OpsDenied('identity_job_required');
  const c = parsed.data;
  const identity = await loadAgentIdentity(c.agent_id);
  if (identity?.status !== 'active') throw new OpsDenied('agent_inactive');
  const job = await dbGet(`SELECT j.id FROM agent_jobs j JOIN conversations c ON c.id = j.conversation_id
    WHERE j.id = ? AND j.agent_row_id = ? AND c.space_id = ? AND j.status = 'running'`,
  [Number(c.dispatch_job_id), c.agent_id, c.space_id]);
  if (!job) throw new OpsDenied('job_inactive');
  const row = await dbGet(`SELECT * FROM ops_browser_grants WHERE job_id = ? AND agent_id = ? AND space_id = ?
    AND revoked_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`, [c.dispatch_job_id, c.agent_id, c.space_id]);
  if (!row) throw new OpsDenied('no_browser_grant');
  const binding = browserBindingSchema.safeParse(row);
  if (!binding.success) throw new OpsDenied('invalid_browser_grant');
  const g = binding.data;
  if (g.agent_id !== c.agent_id || g.space_id !== c.space_id || g.job_id !== c.dispatch_job_id || g.role !== identity.slug || g.expires_at.getTime() <= Date.now()) throw new OpsDenied('binding_mismatch');
  return g;
}

function verifyCandidate(grant) {
  try {
    if (fs.realpathSync(grant.repo) !== grant.repo) throw new Error('symlink');
    const git = (...args) => execFileSync('/usr/bin/git', ['-C', grant.repo, ...args], { env: cleanEnv, encoding: 'utf8', timeout: 2000, maxBuffer: 65536 }).trim();
    if (git('rev-parse', '--show-toplevel') !== grant.repo || git('rev-parse', 'HEAD') !== grant.candidate_sha) throw new Error('sha');
  } catch { throw new OpsDenied('candidate_mismatch'); }
}

export async function browserPreflight({ claims, body, signal }) {
  const request = browserRequestSchema.safeParse(body);
  if (!request.success) throw new OpsDenied('invalid_browser_request', 400);
  const grant = await resolveBinding(claims);
  if (!grant.suite_ids.includes(request.data.suite_id)) throw new OpsDenied('suite_denied');
  verifyCandidate(grant);
  const installation = browserInstallation();
  if (canonicalJson(installation.pins) !== canonicalJson(grant.pins)) throw new OpsDenied('pins_changed', 503);
  const result = await browserExchange(installation, {
    op: 'preflight', pins: grant.pins, suite_id: request.data.suite_id,
    candidate_sha: grant.candidate_sha, job_id: grant.job_id,
  }, { signal });
  const capabilities = z.object({ pins: browserPinsSchema, capabilities: browserCapabilitiesSchema,
    candidate_sha: z.literal(grant.candidate_sha), database: z.literal('godcrm_test'),
  }).strict().safeParse(result);
  if (!capabilities.success || canonicalJson(result.pins) !== canonicalJson(grant.pins)) throw new OpsDenied('capability_unavailable', 503);
  const current = await resolveBinding(claims);
  if (canonicalJson(current) !== canonicalJson(grant) || current.expires_at.getTime() !== grant.expires_at.getTime()) throw new OpsDenied('grant_changed');
  return { grant, installation, suite_id: request.data.suite_id, capabilities: capabilities.data.capabilities };
}

export function browserPreflightSummary(p) {
  return { decision: 'ALLOW', profile: 'staging-browser', suite_id: p.suite_id, job_id: p.grant.job_id,
    candidate_sha: p.grant.candidate_sha, pins: p.grant.pins, capabilities: p.capabilities,
    deadline_seconds: p.grant.deadline_seconds, expires_at: p.grant.expires_at };
}

async function cleanupWorker(installation, run) {
  try {
    const reply = await browserExchange(installation, { op: 'cleanup', run_id: run.id, worker_id: run.worker_id }, { timeoutMs: 10000 });
    return z.object({ run_id: z.literal(run.id), worker_id: z.literal(run.worker_id), cleaned: z.literal(true) }).strict().safeParse(reply).success;
  } catch { return false; }
}

/** Independent worker also reaps its durable ledger on EOF/deadline/service boot. */
export async function reapBrowserRuns(installation) {
  const stale = await dbAll(`SELECT id, worker_id FROM ops_browser_runs WHERE
    status IN ('registered','running','cleanup_pending') AND
    (deadline_at <= now() OR heartbeat_at < now() - interval '10 seconds') LIMIT 20`);
  await Promise.all(stale.map(async run => {
    if (await cleanupWorker(installation, run)) await dbRun(`UPDATE ops_browser_runs SET status = 'reaped', finished_at = now() WHERE id = ?`, [run.id]);
  }));
}

export async function runBrowserSuite({ claims, body, signal }) {
  const started = Date.now();
  const p = await browserPreflight({ claims, body, signal });
  await reapBrowserRuns(p.installation);
  if (signal?.aborted) throw new OpsDenied('cancelled', 409);
  const fresh = await resolveBinding(claims);
  if (canonicalJson(fresh) !== canonicalJson(p.grant) || fresh.expires_at.getTime() !== p.grant.expires_at.getTime()) throw new OpsDenied('grant_changed');
  verifyCandidate(fresh);
  const id = crypto.randomUUID();
  const worker_id = `godcrm-browser-${id}`;
  const deadline = Math.min(started + p.grant.deadline_seconds * 1000, p.grant.expires_at.getTime());
  if (deadline <= Date.now()) throw new OpsDenied('worker_deadline', 409);
  // Registered before any execute RPC. The partial unique index serializes jobs
  // across brokers, including failed cleanup; revocation is rechecked under lock.
  try {
    await withTransactionAsync(async trx => {
      const live = await trx.get(`SELECT * FROM ops_browser_grants WHERE id = ? AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`, [p.grant.id]);
      if (!live || canonicalJson(browserBindingSchema.parse(live)) !== canonicalJson(p.grant)) throw new OpsDenied('grant_revoked');
      const quota = await trx.get(`SELECT count(*)::int AS n FROM ops_browser_runs WHERE job_id = ?`, [p.grant.job_id]);
      if (!quota || quota.n >= 20) throw new OpsDenied('job_run_quota', 429);
      await trx.run(`INSERT INTO ops_browser_runs
        (id, worker_id, grant_id, job_id, suite_id, candidate_sha, pins, status, deadline_at)
        VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, 'registered', ?)`,
      [id, worker_id, p.grant.id, p.grant.job_id, p.suite_id, p.grant.candidate_sha, JSON.stringify(p.grant.pins), new Date(deadline)]);
    });
  } catch (err) {
    if (err.code === '23505') throw new OpsDenied('job_busy', 409);
    throw err;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, Math.max(1, deadline - Date.now()));
  let polling = false;
  const poll = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const current = await resolveBinding(claims);
      if (canonicalJson(current) !== canonicalJson(p.grant)) return cancel();
      await dbRun(`UPDATE ops_browser_runs SET heartbeat_at = now() WHERE id = ?`, [id]);
    } catch { cancel(); } finally { polling = false; }
  }, 500);
  let report;
  let failure;
  let cleaned;
  try {
    await dbRun(`UPDATE ops_browser_runs SET status = 'running' WHERE id = ?`, [id]);
    const result = await browserExchange(p.installation, {
      op: 'run', run_id: id, worker_id, job_id: p.grant.job_id, agent_id: p.grant.agent_id,
      space_id: p.grant.space_id, role: p.grant.role, repo: p.grant.repo,
      candidate_sha: p.grant.candidate_sha, pins: p.grant.pins, suite_id: p.suite_id,
      deadline_at: deadline, cleanup_ms: 10000, writes: false,
    }, { signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now()) });
    const parsed = z.object({ run_id: z.literal(id), worker_id: z.literal(worker_id), report: browserReportSchema }).strict().safeParse(result);
    if (!parsed.success) throw new OpsDenied('invalid_worker_report', 503);
    report = parsed.data.report;
    const required = { 'computed-contrast-v1': ['contrast'], 'axe-v1': ['axe'], 'trace-metrics-v1': ['lcp','inp','cls'], 'clipboard-v1': ['clipboard'] }[p.suite_id];
    if (report.passed && (report.checks.some(c => !c.passed) || required.some(kind => !report.checks.some(c => c.kind === kind)))) throw new OpsDenied('invalid_worker_report', 503);
    if (controller.signal.aborted) throw new OpsDenied('cancelled', 409);
    const current = await resolveBinding(claims);
    if (canonicalJson(current) !== canonicalJson(p.grant)) throw new OpsDenied('grant_changed');
  } catch (err) { failure = err; }
  finally {
    clearTimeout(timer); clearInterval(poll); signal?.removeEventListener('abort', cancel);
    cleaned = await cleanupWorker(p.installation, { id, worker_id });
    await dbRun(`UPDATE ops_browser_runs SET status = ?, result = ?::jsonb, finished_at = now() WHERE id = ?`,
      [cleaned ? (failure || !report?.passed ? 'failed' : 'finished') : 'cleanup_pending',
        JSON.stringify({ cleaned, ...(failure ? { reason: failure instanceof OpsDenied ? failure.reason : 'internal' } : { report }) }), id]);
  }
  log.info({ run_id: id, cleaned, passed: !failure && report?.passed }, 'staging browser settled');
  if (!cleaned) throw new OpsDenied('cleanup_unconfirmed', 503);
  if (failure) throw failure;
  return { decision: report.passed ? 'PASS' : 'FAIL', run_id: id, candidate_sha: p.grant.candidate_sha, pins: p.grant.pins, report, cleaned };
}

/** Exact owner/job binding and live grant are rechecked on every artifact read. */
export async function readBrowserArtifact({ claims, body, signal }) {
  const request = browserArtifactRequestSchema.safeParse(body);
  if (!request.success) throw new OpsDenied('invalid_artifact_request', 400);
  const grant = await resolveBinding(claims);
  const run = await dbGet(`SELECT * FROM ops_browser_runs WHERE id = ? AND grant_id = ? AND job_id = ?
    AND status IN ('finished','failed')`, [request.data.run_id, grant.id, grant.job_id]);
  if (!run || run.grant_id !== grant.id || run.job_id !== grant.job_id) throw new OpsDenied('artifact_denied');
  const descriptor = run.result?.report?.artifacts?.find(a => a.id === request.data.artifact_id);
  if (!descriptor || !descriptor.sanitized) throw new OpsDenied('artifact_denied');
  const installation = browserInstallation();
  if (canonicalJson(installation.pins) !== canonicalJson(grant.pins) || canonicalJson(run.pins) !== canonicalJson(grant.pins)) throw new OpsDenied('pins_changed', 503);
  const result = await browserExchange(installation, {
    op: 'artifact', run_id: run.id, worker_id: run.worker_id, artifact_id: descriptor.id,
    job_id: grant.job_id, pins: grant.pins,
  }, { signal });
  const parsed = browserArtifactSchema.safeParse(result);
  if (!parsed.success) throw new OpsDenied('artifact_invalid', 503);
  const bytes = Buffer.from(canonicalJson(parsed.data));
  if (bytes.length !== descriptor.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256 || parsed.data.kind !== descriptor.kind) throw new OpsDenied('artifact_digest', 503);
  const current = await resolveBinding(claims);
  if (current.id !== grant.id || current.expires_at.getTime() <= Date.now()) throw new OpsDenied('grant_changed');
  return { run_id: run.id, artifact_id: descriptor.id, sha256: descriptor.sha256, artifact: parsed.data };
}
