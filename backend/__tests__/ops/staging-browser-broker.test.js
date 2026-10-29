// @vitest-environment node
import crypto from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn(), transaction: vi.fn(), identity: vi.fn(), install: vi.fn(), exchange: vi.fn(), git: vi.fn(), realpath: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ dbGet: mocks.get, dbAll: mocks.all, dbRun: mocks.run, withTransactionAsync: mocks.transaction }));
vi.mock('../../services/ops/opsBroker.js', () => ({ loadAgentIdentity: mocks.identity, OpsDenied: class extends Error { constructor(reason, status = 403) { super(reason); this.reason = reason; this.status = status; } } }));
vi.mock('../../services/ops/stagingExecutionBroker.js', () => ({ canonicalJson: value => JSON.stringify(value) }));
vi.mock('../../services/ops/stagingBrowserChannel.js', () => ({ browserInstallation: mocks.install, browserExchange: mocks.exchange }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.git }));
vi.mock('node:fs', () => ({ default: { realpathSync: mocks.realpath } }));
import { browserPreflight, browserPreflightSummary, runBrowserSuite, reapBrowserRuns, readBrowserArtifact } from '../../services/ops/stagingBrowserBroker.js';

const sha = 'a'.repeat(40);
const pins = { executor: 'b'.repeat(64), image: `sha256:${'b'.repeat(64)}`, dependencies: 'b'.repeat(64), seccomp: 'b'.repeat(64), egress: 'b'.repeat(64), suites: 'b'.repeat(64), installation: 'b'.repeat(64) };
const caps = { sandbox: true, non_root: true, tls_verified: true, network_enforced: true, durable_reaper: true, computed_styles: true, axe: true, trace_metrics: true, isolated_clipboard: true, sanitized_artifacts: true, cleanup_ms: 10000 };
const claims = { agent_id: 31113, space_id: 11, dispatch_job_id: '22049' };
const body = { suite_id: 'computed-contrast-v1' };
let grant;
let report;
let capability;
let job;
let clean;
let running;
beforeEach(() => {
  vi.clearAllMocks();
  grant = { id: 1, job_id: '22049', agent_id: 31113, space_id: 11, role: 'developer-ralph', repo: '/root/wt-browser', candidate_sha: sha, suite_ids: [body.suite_id], pins, deadline_seconds: 180, expires_at: new Date(Date.now() + 600000), revoked_at: null };
  report = { passed: true, checks: [{ kind: 'contrast', passed: true, value: 6.7 }], artifacts: [] };
  capability = { pins, capabilities: { ...caps }, candidate_sha: sha, database: 'godcrm_test' };
  job = { id: 22049 }; clean = true; running = null;
  mocks.identity.mockResolvedValue({ slug: 'developer-ralph', status: 'active' });
  mocks.realpath.mockImplementation(p => p);
  mocks.git.mockImplementation((_bin, args) => args.includes('HEAD') ? sha : grant.repo);
  mocks.get.mockImplementation(async sql => sql.includes('count(*)') ? { n: 0 } : sql.includes('agent_jobs') ? job : grant);
  mocks.all.mockResolvedValue([]); mocks.run.mockResolvedValue({});
  mocks.transaction.mockImplementation(fn => fn({ get: mocks.get, run: mocks.run }));
  mocks.install.mockReturnValue({ pins, key: 'secret', socket: '/private' });
  mocks.exchange.mockImplementation(async (_installation, payload) => {
    if (payload.op === 'preflight') return capability;
    if (payload.op === 'cleanup') return { run_id: payload.run_id, worker_id: payload.worker_id, cleaned: clean };
    running = payload;
    return { run_id: payload.run_id, worker_id: payload.worker_id, report };
  });
});
afterEach(() => vi.useRealTimers());

describe('server-bound preflight', () => {
  it('resolves job/grant/pins and returns no secrets or paths', async () => {
    const p = await browserPreflight({ claims, body });
    expect(browserPreflightSummary(p)).toMatchObject({ decision: 'ALLOW', job_id: '22049', candidate_sha: sha });
    expect(JSON.stringify(browserPreflightSummary(p))).not.toMatch(/secret|\/private|wt-browser/);
    expect(mocks.exchange.mock.calls.map(c => c[1].op)).toEqual(['preflight']);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([
    ['no job claim', () => ({ ...claims, dispatch_job_id: undefined }), 'identity_job_required'],
    ['foreign space', () => ({ ...claims, space_id: 12 }), 'identity_job_required'],
    ['foreign agent', () => ({ ...claims, agent_id: 999 }), 'binding_mismatch'],
    ['foreign job', () => ({ ...claims, dispatch_job_id: '999' }), 'binding_mismatch'],
  ])('denies %s before transport', async (_name, change, reason) => {
    await expect(browserPreflight({ claims: change(), body })).rejects.toMatchObject({ reason });
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it.each([
    ['grant missing', () => { grant = null; }, 'no_browser_grant'],
    ['job ended', () => { job = null; }, 'job_inactive'],
    ['expired grant', () => { grant.expires_at = new Date(0); }, 'binding_mismatch'],
    ['revoked grant', () => { grant.revoked_at = new Date(); }, 'invalid_browser_grant'],
    ['role changed', () => { grant.role = 'frontend-qa'; }, 'binding_mismatch'],
    ['suite not granted', () => { grant.suite_ids = ['axe-v1']; }, 'suite_denied'],
    ['deadline 301', () => { grant.deadline_seconds = 301; }, 'invalid_browser_grant'],
    ['untrusted repo', () => { grant.repo = '/srv/godcrm/live'; }, 'invalid_browser_grant'],
    ['wrong candidate', () => { mocks.git.mockReturnValue('wrong'); }, 'candidate_mismatch'],
    ['symlink', () => { mocks.realpath.mockReturnValue('/root/other'); }, 'candidate_mismatch'],
    ['pins changed', () => { mocks.install.mockReturnValue({ pins: { ...pins, egress: 'c'.repeat(64) } }); }, 'pins_changed'],
  ])('fails closed: %s', async (_name, change, reason) => {
    change();
    await expect(browserPreflight({ claims, body })).rejects.toMatchObject({ reason });
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it.each(['sandbox','non_root','tls_verified','network_enforced','durable_reaper','computed_styles','axe','trace_metrics','isolated_clipboard','sanitized_artifacts'])('blocks missing %s capability', async key => {
    capability.capabilities[key] = false;
    await expect(runBrowserSuite({ claims, body })).rejects.toMatchObject({ reason: 'capability_unavailable' });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(['godcrm_prod','godcrm_edit'])('blocks wrong database %s', async db => {
    capability.database = db;
    await expect(runBrowserSuite({ claims, body })).rejects.toMatchObject({ reason: 'capability_unavailable' });
  });
});

describe('registered lifecycle', () => {
  it('persists worker identity before execute and confirms exact cleanup', async () => {
    const out = await runBrowserSuite({ claims, body });
    expect(out).toMatchObject({ decision: 'PASS', cleaned: true });
    const insert = mocks.run.mock.calls.findIndex(c => c[0].includes('INSERT'));
    const execute = mocks.exchange.mock.calls.findIndex(c => c[1].op === 'run');
    expect(mocks.run.mock.invocationCallOrder[insert]).toBeLessThan(mocks.exchange.mock.invocationCallOrder[execute]);
    expect(running).toMatchObject({ worker_id: `godcrm-browser-${out.run_id}`, writes: false, repo: grant.repo, candidate_sha: sha });
    expect(running.deadline_at - Date.now()).toBeLessThanOrEqual(180000);
    expect(mocks.exchange.mock.calls.at(-1)[1]).toMatchObject({ op: 'cleanup', worker_id: running.worker_id });
  });
  it('does not execute when unique per-job reservation fails', async () => {
    mocks.transaction.mockRejectedValue({ code: '23505' });
    await expect(runBrowserSuite({ claims, body })).rejects.toMatchObject({ reason: 'job_busy' });
    expect(mocks.exchange.mock.calls.map(c => c[1].op)).toEqual(['preflight']);
  });
  it('retains cleanup_pending when worker cleanup is unconfirmed', async () => {
    clean = false;
    await expect(runBrowserSuite({ claims, body })).rejects.toMatchObject({ reason: 'cleanup_unconfirmed' });
    expect(mocks.run.mock.calls.at(-1)[1][0]).toBe('cleanup_pending');
  });
  it('rejects a secret-bearing report and still cleans up', async () => {
    report.headers = { authorization: 'supersecret' };
    await expect(runBrowserSuite({ claims, body })).rejects.toMatchObject({ reason: 'invalid_worker_report' });
    expect(JSON.stringify(mocks.run.mock.calls)).not.toContain('supersecret');
    expect(mocks.exchange.mock.calls.at(-1)[1].op).toBe('cleanup');
  });
  it('returns FAIL for failed checks', async () => {
    report.passed = false;
    expect(await runBrowserSuite({ claims, body })).toMatchObject({ decision: 'FAIL' });
  });
  it.each(['cancel','revoke','deadline','job ends'])('bounds %s and cleans only its worker', async mode => {
    vi.useFakeTimers();
    const controller = new AbortController();
    mocks.exchange.mockImplementation(async (_install, p, options) => {
      if (p.op === 'preflight') return capability;
      if (p.op === 'cleanup') return { run_id: p.run_id, worker_id: p.worker_id, cleaned: true };
      running = p;
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    });
    const promise = runBrowserSuite({ claims, body, signal: controller.signal });
    const rejected = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    expect(running).not.toBeNull();
    if (mode === 'cancel') controller.abort();
    if (mode === 'revoke') grant = null;
    if (mode === 'job ends') job = null;
    await vi.advanceTimersByTimeAsync(mode === 'deadline' ? 180001 : 501);
    await rejected;
    expect(mocks.exchange.mock.calls.at(-1)[1]).toMatchObject({ op: 'cleanup', worker_id: running.worker_id });
  });
  it('reaps only recorded expired workers', async () => {
    const id = '2c9a3c8c-c8c4-4a96-9c31-4b4de017ab83';
    mocks.all.mockResolvedValue([{ id, worker_id: `godcrm-browser-${id}` }]);
    await reapBrowserRuns(mocks.install());
    expect(mocks.exchange.mock.calls[0][1]).toEqual({ op: 'cleanup', run_id: id, worker_id: `godcrm-browser-${id}` });
    expect(mocks.run.mock.calls[0][1]).toEqual([id]);
  });
});

describe('false-positive and quota regression', () => {
  it('rejects empty PASS without the suite evidence', async () => {
    report.checks = [];
    await expect(runBrowserSuite({ claims, body })).rejects.toMatchObject({ reason: 'invalid_worker_report' });
  });
  it('rejects PASS contradicting a failed check', async () => {
    report.checks[0].passed = false;
    await expect(runBrowserSuite({ claims, body })).rejects.toMatchObject({ reason: 'invalid_worker_report' });
  });
  it('does not start after the grant expires during capability inspection', async () => {
    mocks.exchange.mockImplementation(async () => {
      grant.expires_at = new Date(0);
      return capability;
    });
    await expect(runBrowserSuite({ claims, body })).rejects.toThrow();
    expect(mocks.run.mock.calls.some(c => c[0].includes('INSERT'))).toBe(false);
  });
});


describe('bounded authorized artifacts', () => {
  const artifact = { kind: 'axe', checks: [{ target: 'schema_drawer', rule: 'axe', passed: true, count: 0 }], trace: [] };
  const id = '2c9a3c8c-c8c4-4a96-9c31-4b4de017ab83';
  const bytes = Buffer.from(JSON.stringify(artifact));
  const descriptor = { id, kind: 'axe', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sanitized: true };
  const input = { claims, body: { run_id: id, artifact_id: id } };
  let run;
  beforeEach(() => {
    run = { id, worker_id: `godcrm-browser-${id}`, grant_id: 1, job_id: '22049', pins, result: { report: { artifacts: [{ ...descriptor }] } } };
    const previous = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(sql => sql.includes('SELECT * FROM ops_browser_runs') ? run : previous(sql));
    mocks.exchange.mockResolvedValue(artifact);
  });
  it('returns only validated digest-matched data', async () => {
    expect(await readBrowserArtifact(input)).toMatchObject({ artifact, sha256: descriptor.sha256 });
  });
  it.each(['foreign_job','foreign_grant','missing','path','secret','digest','pins'])('denies %s', async mode => {
    const request = structuredClone(input);
    if (mode === 'foreign_job') run.job_id = '22';
    if (mode === 'foreign_grant') run.grant_id = 2;
    if (mode === 'missing') run.result.report.artifacts = [];
    if (mode === 'path') request.body.path = '/etc/shadow';
    if (mode === 'secret') mocks.exchange.mockResolvedValue({ ...artifact, cookie: 'secret' });
    if (mode === 'digest') run.result.report.artifacts[0].sha256 = 'c'.repeat(64);
    if (mode === 'pins') run.pins = { ...pins, image: `sha256:${'c'.repeat(64)}` };
    await expect(readBrowserArtifact(request)).rejects.toThrow();
  });
});

it('counts preflight time inside the overall suite deadline', async () => {
  vi.useFakeTimers();
  const started = Date.now();
  const previous = mocks.exchange.getMockImplementation();
  mocks.exchange.mockImplementation(async (installation, payload, options) => {
    if (payload.op === 'preflight') vi.setSystemTime(Date.now() + 3000);
    return previous(installation, payload, options);
  });
  await runBrowserSuite({ claims, body });
  expect(running.deadline_at).toBe(started + 180000);
});
