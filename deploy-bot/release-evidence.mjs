// Runs on the deployment host. Full sanitized streams stay outside the worktree;
// only bounded previews cross the SSH/Telegram transport. No raw logs on disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const filename = fileURLToPath(import.meta.url);
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const json = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const payload = data => Buffer.from(JSON.stringify(data)).toString('base64');

function clean(text, env = process.env) {
  let result = String(text);
  for (const [key, value] of Object.entries(env)) {
    if (/TOKEN|PASSWORD|SECRET|CREDENTIAL|PRIVATE_KEY/i.test(key) && value?.length >= 4) {
      result = result.split(value).join('[REDACTED]');
    }
  }
  return result.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(Bearer\s+)[\w.+/=-]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:[\w-]*(?:token|password|secret|credential|_auth)[\w-]*)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]');
}

function initEvidence({ dir, worktree, appSha, botDigest, helperFiles }) {
  const parent = fs.realpathSync(path.dirname(dir));
  const tree = path.resolve(worktree);
  const actualDir = path.join(parent, path.basename(dir));
  if (actualDir === tree || actualDir.startsWith(tree + path.sep)) throw Error('Evidence must be outside worktree');
  if (!/^[a-f0-9]{40}$/.test(appSha)) throw Error('Invalid app SHA');
  fs.mkdirSync(actualDir, { mode: 0o700 }); // exclusive run ID: never overwrite evidence
  const helpers = Object.fromEntries(helperFiles.map(file => [file, digest(fs.readFileSync(file))]));
  json(path.join(actualDir, 'run.json'), {
    runId: path.basename(actualDir), appSha, botDigest, helperDigests: helpers,
    node: process.version, startedAt: new Date().toISOString(), worktree: tree,
  });
}

async function recordCommand({ dir, id, command, timeout }) {
  if (!/^\d{4}$/.test(id)) throw Error('Invalid command ID');
  const streams = {};
  let preview = '';
  for (const name of ['stdout', 'stderr']) {
    streams[name] = { fd: fs.openSync(path.join(dir, `${id}.${name}.log`), 'wx', 0o600), decoder: new StringDecoder('utf8'), pending: '' };
  }
  const flush = (stream, final = false) => {
    const end = final ? stream.pending.length : stream.pending.lastIndexOf('\n') + 1;
    if (!end) return;
    const text = clean(stream.pending.slice(0, end));
    stream.pending = stream.pending.slice(end);
    fs.writeSync(stream.fd, text);
    preview = (preview + text).slice(0, 32768);
  };
  const startedAt = new Date().toISOString();
  json(path.join(dir, `${id}.json`), { command: clean(command), startedAt, status: 'running' });
  const child = spawn('/bin/bash', ['-c', command], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let timedOut = false;
  let spawnError;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
  }, timeout);
  for (const name of ['stdout', 'stderr']) {
    child[name].on('data', bytes => {
      streams[name].pending += streams[name].decoder.write(bytes);
      flush(streams[name]);
    });
  }
  child.on('error', error => { spawnError = clean(error.message); });
  const result = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  for (const stream of Object.values(streams)) {
    stream.pending += stream.decoder.end();
    flush(stream, true);
    fs.fsyncSync(stream.fd);
    fs.closeSync(stream.fd);
  }
  const outcome = { command: clean(command), startedAt, endedAt: new Date().toISOString(), ...result, timedOut, spawnError };
  json(path.join(dir, `${id}.json`), outcome);
  return { ...outcome, preview, ok: result.code === 0 && !timedOut && !spawnError };
}

function sealEvidence({ dir, status }) {
  for (const file of fs.readdirSync(dir).filter(file => /^\d{4}\.json$/.test(file))) {
    if (JSON.parse(fs.readFileSync(path.join(dir, file))).status === 'running') {
      throw Error('Incomplete command evidence; retain worktree');
    }
  }
  json(path.join(dir, 'outcome.json'), { status, endedAt: new Date().toISOString() });
  const files = fs.readdirSync(dir).filter(file => file !== 'SHA256SUMS').sort();
  const sums = files.map(file => `${digest(fs.readFileSync(path.join(dir, file)))}  ${file}\n`).join('');
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), sums, { mode: 0o600 });
  return { dir, manifestSha256: digest(sums), files: files.length };
}

async function createEvidence(runner, options) {
  const script = quote(options.recorder);
  const invoke = async (op, args, timeout = 30000) => JSON.parse(await runner(
    `node ${script} ${op} ${quote(payload(args))}`, timeout));
  await invoke('init', options);
  let sequence = 0;
  const run = async (command, timeout = 120000) => {
    const result = await invoke('record', { dir: options.dir, id: String(++sequence).padStart(4, '0'), command, timeout }, timeout + 30000);
    if (!result.ok) throw Error(`Command ${sequence} failed; full evidence: ${options.dir}\n${result.preview.slice(-2000)}`);
    return result.preview.trim();
  };
  return { run, finish: status => invoke('seal', { dir: options.dir, status }) };
}

async function startReleaseEvidence(runner, { source, worktree, appSha, botFile, root }) {
  const runId = `ring0-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  return createEvidence(runner, {
    dir: `${root || '/var/lib/godcrm/deploy-evidence'}/${runId}`, worktree, appSha,
    botDigest: digest(fs.readFileSync(botFile)),
    helperFiles: [`${source}/deploy-bot/build-inputs.mjs`, `${source}/deploy-bot/release-evidence.mjs`],
    recorder: `${source}/deploy-bot/release-evidence.mjs`,
  });
}

export { clean, initEvidence, recordCommand, sealEvidence, createEvidence, startReleaseEvidence };
if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  try {
    const args = JSON.parse(Buffer.from(process.argv[3], 'base64').toString());
    const ops = { init: initEvidence, record: recordCommand, seal: sealEvidence };
    const op = ops[process.argv[2]];
    if (!op) throw Error('Unknown evidence operation');
    process.stdout.write(JSON.stringify((await op(args)) || { ok: true }) + '\n');
  } catch (error) {
    process.stderr.write(clean(error.message) + '\n');
    process.exitCode = 1;
  }
}
