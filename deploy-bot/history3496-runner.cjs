// Owner-installed detached worker. FD 3 stays open in this worker AND the CLI.
const fs = require('node:fs');
const { networkInterfaces } = require('node:os');
const { spawn } = require('node:child_process');
const { z } = require('zod');
const c = require('./history3496.cjs');
const GUARDS = ['backend/services/chat/historical-access.js', 'backend/services/chat/conversation-read-access.js',
  'backend/routes/v3/chat/index.js', 'backend/routes/v3/tables/index.js', 'backend/services/agent-tools/executor.js', 'backend/middleware/fileGuard.js', 'dist/index.html'];
const readinessSchema = z.object({
  operator: z.string().min(1), authorization: z.string().min(1), checked_at: z.string().datetime(),
  deployed_sha: c.sha, channel_sha: c.sha, http_acl_verified: z.literal(true), uploads_acl_verified: z.literal(true),
  backup: c.proofSchema, backup_at: z.string().datetime(), restored_backup_sha256: c.hash, restore_verified_at: z.string().datetime(),
  gate1: c.proofSchema, staging_smoke: c.proofSchema, test_cycle: c.proofSchema,
  http_acl: c.proofSchema, uploads_acl: c.proofSchema, restore: c.proofSchema, guards: z.record(c.hash),
}).strict();
function validateReadiness(input, manifest, now = Date.now()) {
  const r = readinessSchema.parse(input);
  if (r.deployed_sha !== manifest.deployed_app_sha || r.channel_sha !== manifest.channel_commit_sha || r.backup.sha256 !== r.restored_backup_sha256) throw new Error('PRECONDITION_RECEIPTS');
  for (const field of ['checked_at', 'backup_at', 'restore_verified_at']) {
    if (now - Date.parse(r[field]) > 86400000 || Date.parse(r[field]) > now) throw new Error('PRECONDITION_RECEIPTS');
  }
  if (Date.parse(r.restore_verified_at) < Date.parse(r.backup_at) || GUARDS.some(file => !r.guards[file])) throw new Error('PRECONDITION_RECEIPTS');
  return r;
}
async function checkReadiness(manifest, action, run) {
  const r = validateReadiness(c.readJson('/etc/godcrm/history3496-readiness.json'), manifest);
  if (fs.readFileSync(c.trusted('/srv/godcrm/live/.promoted-sha'), 'utf8').split(/\s+/)[0] !== r.deployed_sha) throw new Error('PRECONDITION_DEPLOYED_SHA');
  for (const file of GUARDS) if (await c.digest(`/srv/godcrm/live/${file}`) !== r.guards[file]) throw new Error('PRECONDITION_GUARDS');
  for (const key of ['backup', 'restore', 'gate1', 'staging_smoke', 'test_cycle', 'http_acl', 'uploads_acl']) {
    if (await c.digest(r[key].path) !== r[key].sha256) throw new Error('PRECONDITION_RECEIPTS');
  }
  c.trusted(c.UPLOADS, { directory: true });
  const disk = fs.statfsSync(c.UPLOADS);
  if (action === 'apply' && disk.bavail * disk.bsize < 8 * 1024 ** 3) throw new Error('PRECONDITION_SPACE');
  c.durableJson(`${run}/operator-evidence.json`, { ...r, backup: r.backup.path });
}
function classifyExit(action, code, stderr) {
  if (code === 0) return 'SUCCEEDED';
  if (stderr.includes('Install scripts/historical-chat-parent-index.sql')) return 'PRECONDITION_INDEX';
  if (stderr.includes('Destination database mismatch')) return 'PRECONDITION_DATABASE';
  if (stderr.includes('Owner identity not verified')) return 'PRECONDITION_OWNER';
  if (action === 'rollback' && /changed; review required|verification failed|mismatch/.test(stderr)) return 'BLOCKED_CHANGED';
  return ['apply', 'rollback'].includes(action) ? 'OUTCOME_UNKNOWN' : 'FAILED';
}
function summarizeReport(action, raw) {
  const report = z.object({ messages: z.literal(6061), files: z.literal(334), missing: z.array(z.string()).length(21),
    source_sha256: z.literal(c.DIGEST), related_sha256:z.literal(c.RELATED), related:z.object({rows:z.literal(50)}).passthrough(), destination:z.object({id:z.literal(44),name:z.literal('Играемся')}), conversation_id: z.number().int().positive().optional(), space_id: z.literal(44).optional(),
    url: z.string().regex(/^https:\/\/app\.godcrm\.ai\/spaces\/44\?chat=\d+$/).nullable().optional(),
    verified: z.boolean().optional(), rolled_back: z.boolean().optional(),
  }).passthrough().parse(raw);
  if (action === 'rollback' ? !report.rolled_back : action !== 'dry-run' && (!report.verified || !report.conversation_id || !report.space_id || !report.url)) throw new Error('OUTCOME_UNKNOWN');
  return { conversation_id: report.conversation_id, space_id: report.space_id, url: action === 'rollback' ? undefined : report.url,
    messages: report.messages, files: report.files, missing: report.missing.length };
}
function runChild(executable, argv, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { ...options, shell: false, stdio: ['ignore', 'ignore', 'pipe', 3] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stderr }));
  });
}
async function runHistory3496(runId) {
  z.string().regex(/^8601600288-423753027-[1-9]\d*$/).parse(runId);
  const run = `${c.STATE}/runs/${runId}`;
  c.trusted(run, { directory: true, privateFile: true });
  const intent = z.object({ run_id: z.literal(runId), action: z.enum(['dry-run', 'apply', 'verify', 'rollback']),
    accepted_at: z.number().positive(), channel_commit_sha: c.sha, deployed_app_sha: c.sha }).strict().parse(c.readJson(`${run}/intent.json`));
  let spawned = false;
  try {
    const lock = fs.fstatSync(3), diskLock = fs.lstatSync(c.trusted(c.LOCK, { privateFile: true }));
    if (lock.ino !== diskLock.ino || lock.dev !== diskLock.dev) throw new Error('PRECONDITION_LOCK');
    // flock on the inherited open-file description: lock survives both this
    // helper's exit and a bot restart. The importer inherits the same FD.
    const locked = await runChild('/usr/bin/flock', ['-n', '-E', '75', '3'], { env: c.cleanEnv });
    if (locked.code !== 0) throw new Error('BUSY');
    if (fs.existsSync(`${run}/started.json`) || fs.existsSync(`${run}/result.json`)) return;
    c.durableJson(`${run}/started.json`, { started_at: Date.now(), pid: process.pid });
    const m = c.installation();
    if (m.channel_commit_sha !== intent.channel_commit_sha || m.deployed_app_sha !== intent.deployed_app_sha || __dirname !== `${m.artifact}/deploy-bot`) throw new Error('PRECONDITION_SHA');
    if (!Object.values(networkInterfaces()).flat().some(n => n?.address === '<PROD_IP>')) throw new Error('PRECONDITION_HOST');
    await c.checkInventory(m);
    if (['apply', 'rollback'].includes(intent.action) && c.needsVerify(c.previousRuns(), runId)) throw new Error('VERIFY_REQUIRED');
    const env = c.safeEnv(intent.action, intent.action === 'dry-run' ? undefined : c.readJson('/etc/godcrm/history3496-db.json'));
    if (intent.action !== 'dry-run') await checkReadiness(m, intent.action, run);
    // Check report creation before the CLI can commit. A new private directory
    // plus wx writes prevents report clobbering. A later disk failure is UNKNOWN.
    c.durableJson(`${run}/report-write-probe.json`, { ok: true });
    spawned = true;
    const result = await runChild('/usr/bin/node', c.cliArgs(intent.action, m.artifact, run), { cwd: m.artifact, env });
    const status = classifyExit(intent.action, result.code, result.stderr);
    if (status !== 'SUCCEEDED') throw new Error(status);
    const summary = summarizeReport(intent.action, c.readJson(`${run}/report.json`));
    c.durableJson(`${run}/result.json`, { action: intent.action, run_id: runId, status, finished_at: Date.now(),
      ...summary, report_sha256: await c.digest(`${run}/report.json`) });
  } catch (e) {
    const safe = /^(PRECONDITION_[A-Z_]+|BUSY|VERIFY_REQUIRED|OUTCOME_UNKNOWN|FAILED|BLOCKED_CHANGED|DISABLED)$/;
    const status = safe.test(e.message) ? e.message : spawned && ['apply', 'rollback'].includes(intent.action) ? 'OUTCOME_UNKNOWN' : 'PRECONDITION_FAILED';
    if (!fs.existsSync(`${run}/result.json`)) c.durableJson(`${run}/result.json`, { action: intent.action, run_id: runId, status, finished_at: Date.now() });
  }
}
if (require.main === module) runHistory3496(process.argv[2]).catch(() => { process.exitCode = 1; });
module.exports = { GUARDS, validateReadiness, checkReadiness, classifyExit, summarizeReport, runChild, runHistory3496 };
