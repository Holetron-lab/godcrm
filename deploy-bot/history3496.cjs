// Fixed owner transport. No generic command, path or environment input from Telegram.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { z } = require('zod');
const ROOT = '/opt/godcrm-history3496';
const STATE = '/var/lib/godcrm-history3496';
const MANIFEST = '/etc/godcrm/history3496.json';
const LOCK = '/tmp/godcrm-history3496.lock';
const OWNER = 423753027;
const BOT = 8601600288;
const DIGEST = '73bcdbdb46f43af1f7858642d4f1b82051f1c6484d371f6b4956b416620847b3';
const RELATED = '8ddbe26481097b750d0525b64c29959b56d0e5acc34a7fc4889432ce0dcd6e68';
const MAP = '8022fd45435cc534a7028352b6e2aba65a88815a6a42d7cacbed9084c6f61cc7';
// Existing-space + ClipForge data import; see HISTORY3496-COMPATIBILITY.md.
const REVIEWED = 'a3bc0a1380dca49bdbdf995a4a2f989880f9623c';
const LOCKFILE = 'e8cdf426281b64b68b916afaa49e209f147d6b71f8983d3b0e740288c408818d';
const UPLOADS = '/var/lib/business-crm-data/uploads';
const cleanEnv = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', NODE_ENV: 'production' };
const actionSchema = z.enum(['status', 'dry-run', 'apply', 'verify', 'rollback']);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const proofSchema = z.object({ path: z.string().startsWith('/root/backups/temp/'), sha256: hash }).strict();
const manifestSchema = z.object({
  version: z.literal(1), enabled: z.boolean(), installed_by: z.literal(OWNER),
  reviewed_importer_sha: z.literal(REVIEWED), channel_commit_sha: sha, deployed_app_sha: sha,
  inventory_sha256: hash, node_sha256: hash, flock_sha256: hash,
}).strict();
const messageSchema = z.object({
  text: z.string(), message_id: z.number().int().positive(), date: z.number().int().positive(),
  from: z.object({ id: z.literal(OWNER), is_bot: z.literal(false).optional() }).passthrough(),
  chat: z.object({ id: z.literal(OWNER), type: z.literal('private') }).passthrough(),
}).passthrough();

function parseMessage(msg, ownerId, me, now = Math.floor(Date.now() / 1000)) {
  if (ownerId !== OWNER || me?.id !== BOT || me?.username !== 'Godcrmdeploybot' || !messageSchema.safeParse(msg).success) return null;
  if (['edit_date', 'forward_origin', 'forward_date', 'forward_from', 'forward_from_chat', 'forward_sender_name', 'is_automatic_forward', 'via_bot', 'sender_chat'].some(key => key in msg)) return null;
  if (now - msg.date > 120 || msg.date - now > 30) return null;
  const match = /^\/history3496(?:@Godcrmdeploybot)? (status|dry-run|apply|verify|rollback)$/.exec(msg.text);
  return match && match[0] === msg.text ? match[1] : null;
}

function fail(code) { throw new Error(code); }
function trusted(file, { privateFile = false, directory = false } = {}) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file) fail('PRECONDITION_PATH');
  let current = '/';
  for (const part of file.split('/').filter(Boolean)) {
    current = path.join(current, part);
    const st = fs.lstatSync(current);
    // /tmp is allowed only as an ancestor of private test/lock paths; sticky root owns it.
    if (st.isSymbolicLink() || st.uid !== 0 || (st.mode & 0o022) && !(current === '/tmp' && (st.mode & 0o1000))) fail('PRECONDITION_PERMISSIONS');
  }
  const st = fs.lstatSync(file);
  if (directory ? !st.isDirectory() : !st.isFile()) fail('PRECONDITION_PATH');
  if (privateFile && (st.mode & 0o077)) fail('PRECONDITION_PERMISSIONS');
  return file;
}
function readJson(file, privateFile = true) { return JSON.parse(fs.readFileSync(trusted(file, { privateFile }), 'utf8')); }
async function digest(file) {
  trusted(file);
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
function durableJson(file, data) {
  trusted(path.dirname(file), { directory: true, privateFile: true });
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function installation() {
  const m = manifestSchema.parse(readJson(MANIFEST));
  if (!m.enabled) fail('DISABLED');
  return { ...m, artifact: `${ROOT}/releases/${m.channel_commit_sha}` };
}
async function checkInventory(m) {
  const inventoryPath = `${m.artifact}/inventory.json`;
  if (await digest(inventoryPath) !== m.inventory_sha256) fail('PRECONDITION_INVENTORY');
  const inventory = z.record(hash).parse(readJson(inventoryPath));
  for (const required of ['scripts/import-historical-chat.mjs', 'deploy-bot/history3496.cjs', 'deploy-bot/history3496-runner.cjs', 'package-lock.json', 'node_modules/zod/package.json']) {
    if (!inventory[required]) fail('PRECONDITION_INVENTORY');
  }
  const seen = [];
  async function walk(dir) {
    trusted(dir, { directory: true });
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), rel = path.relative(m.artifact, file), st = fs.lstatSync(file);
      if (st.isDirectory()) await walk(file);
      else if (rel !== 'inventory.json') {
        if (!inventory[rel] || await digest(file) !== inventory[rel]) fail('PRECONDITION_INVENTORY');
        seen.push(rel);
      }
    }
  }
  await walk(m.artifact);
  if (seen.length !== Object.keys(inventory).length || inventory['package-lock.json'] !== LOCKFILE) fail('PRECONDITION_INVENTORY');
  if (await digest('/usr/bin/node') !== m.node_sha256 || await digest('/usr/bin/flock') !== m.flock_sha256) fail('PRECONDITION_EXECUTABLE');
  if (await digest(`${ROOT}/inputs/conversation-3496.json`) !== DIGEST || await digest(`${ROOT}/inputs/file-map.json`) !== MAP || await digest(`${ROOT}/inputs/related-data.json`) !== RELATED) fail('PRECONDITION_DIGEST');
}
function safeEnv(action, credentials) {
  if (action === 'dry-run') return { ...cleanEnv, POSTGRES_DB: 'godcrm_test', POSTGRES_HOST: '127.0.0.1' };
  const env = z.object({
    POSTGRES_HOST: z.enum(['127.0.0.1', '::1']), POSTGRES_PORT: z.string().regex(/^\d{1,5}$/),
    POSTGRES_DB: z.literal('godcrm_prod'), POSTGRES_USER: z.string().min(1), POSTGRES_PASSWORD: z.string().min(1),
  }).strict().parse(credentials);
  if (+env.POSTGRES_PORT < 1 || +env.POSTGRES_PORT > 65535) fail('PRECONDITION_CREDENTIALS');
  return { ...cleanEnv, ...env };
}
function cliArgs(action, artifact, run) {
  actionSchema.exclude(['status']).parse(action);
  const args = [`${artifact}/scripts/import-historical-chat.mjs`, '--mode', action,
    '--database', action === 'dry-run' ? 'godcrm_test' : 'godcrm_prod', '--package', `${ROOT}/inputs`,
    '--file-map', `${ROOT}/inputs/file-map.json`, '--file-map-sha256', MAP, '--digest', DIGEST,
    '--target-space', '44', '--target-name', 'Играемся', '--related-data', `${ROOT}/inputs/related-data.json`, '--related-sha256', RELATED,
    '--owner', '17', '--messages', '6061', '--files', '334', '--missing', '21', '--report', `${run}/report.json`];
  if (action !== 'dry-run') args.push('--uploads-root', UPLOADS, '--operator-evidence', `${run}/operator-evidence.json`);
  return args;
}
function previousRuns(state = STATE) {
  return fs.readdirSync(`${state}/runs`).map(id => {
    const run = `${state}/runs/${id}`;
    trusted(run, { directory: true, privateFile: true });
    const intent = fs.existsSync(`${run}/intent.json`) ? readJson(`${run}/intent.json`) : { run_id: id, action: 'apply', accepted_at: fs.statSync(run).mtimeMs };
    return { ...intent, result: fs.existsSync(`${run}/result.json`) ? readJson(`${run}/result.json`) : null };
  }).sort((a, b) => (b.result?.finished_at || b.accepted_at) - (a.result?.finished_at || a.accepted_at));
}
function needsVerify(runs, currentId) {
  const verifiedAt = Math.max(0, ...runs.filter(r => r.action === 'verify' && r.result?.status === 'SUCCEEDED').map(r => r.result.finished_at));
  return runs.some(r => r.run_id !== currentId && ['apply', 'rollback'].includes(r.action) && r.accepted_at > verifiedAt && (!r.result || r.result.status === 'OUTCOME_UNKNOWN'));
}
function admit(msg, action, manifest, state = STATE) {
  const runId = `${BOT}-${OWNER}-${msg.message_id}`;
  const run = `${state}/runs/${runId}`;
  trusted(`${state}/runs`, { directory: true, privateFile: true });
  try { fs.mkdirSync(run, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') return null; throw e; }
  const parent = fs.openSync(`${state}/runs`, 'r');
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  durableJson(`${run}/intent.json`, { run_id: runId, action, accepted_at: Date.now(), channel_commit_sha: manifest.channel_commit_sha, deployed_app_sha: manifest.deployed_app_sha });
  return { run, runId };
}
function receipt(result) {
  // Never serialize arbitrary child errors, report bodies, author names or paths.
  return JSON.stringify({ action: result.action, run_id: result.run_id, status: result.status,
    conversation_id: result.conversation_id, space_id: result.space_id, url: result.url,
    messages: result.messages, files: result.files, missing: result.missing, report_sha256: result.report_sha256 });
}
async function handleHistory3496(bot, msg, ownerId) {
  if (!messageSchema.safeParse(msg).success || ownerId !== OWNER) return;
  let me;
  try { me = await bot.getMe(); } catch { return; }
  const action = parseMessage(msg, ownerId, me);
  if (!action) return;
  try {
    const m = installation();
    if (__dirname !== `${m.artifact}/deploy-bot`) fail('PRECONDITION_SHA');
    if (action === 'status') {
      const last = previousRuns()[0];
      await bot.sendMessage(OWNER, receipt(last ? { ...last, ...last.result, status: last.result?.status || 'PENDING_OR_UNKNOWN' } : { action, status: 'READY_FOR_DRY_RUN' }));
      return;
    }
    // Check the runner before exec, not merely after starting potentially modified code.
    await checkInventory(m);
    const admitted = admit(msg, action, m);
    if (!admitted) { await bot.sendMessage(OWNER, 'DUPLICATE: use /history3496 status'); return; }
    let lockFd;
    try {
      lockFd = fs.openSync(LOCK, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
      trusted(LOCK, { privateFile: true });
      const child = spawn('/usr/bin/node', [`${m.artifact}/deploy-bot/history3496-runner.cjs`, admitted.runId], {
        cwd: m.artifact, env: cleanEnv, shell: false, detached: true, stdio: ['ignore', 'ignore', 'ignore', lockFd],
      });
      child.once('error', () => {
        if (!fs.existsSync(`${admitted.run}/result.json`)) durableJson(`${admitted.run}/result.json`, { action, run_id: admitted.runId, status: 'SPAWN_FAILED', finished_at: Date.now() });
      });
      child.once('exit', code => {
        if (code === 75 && !fs.existsSync(`${admitted.run}/result.json`)) durableJson(`${admitted.run}/result.json`, { action, run_id: admitted.runId, status: 'BUSY', finished_at: Date.now() });
      });
      child.unref();
    } finally { if (lockFd !== undefined) fs.closeSync(lockFd); }
    await bot.sendMessage(OWNER, receipt({ action, run_id: admitted.runId, status: 'ACCEPTED: use /history3496 status' }));
  } catch (e) {
    const code = e.message === 'DISABLED' || e.code === 'ENOENT' ? 'DISABLED_OR_NOT_INSTALLED' : 'PRECONDITION_FAILED';
    await bot.sendMessage(OWNER, code);
  }
}
module.exports = { ROOT, STATE, MANIFEST, LOCK, OWNER, BOT, DIGEST, MAP, RELATED, REVIEWED, LOCKFILE, UPLOADS, cleanEnv, sha, hash, proofSchema,
  parseMessage, trusted, readJson, digest, durableJson, installation, checkInventory, safeEnv, cliArgs, previousRuns, needsVerify, admit, receipt, handleHistory3496 };
