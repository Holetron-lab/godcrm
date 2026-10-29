import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildIsolated, recoverRuntime } from './build-inputs.mjs';
import { createEvidence } from './release-evidence.mjs';
import { databaseCommand, assertDatabaseIdentity } from './ring1-database.mjs';

const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function request(text, dryRun) {
  const match = /^\/deploy_ring1(_check)?(?:@[A-Za-z0-9_]+)?\s+(ring1-[A-Za-z0-9][A-Za-z0-9._-]{0,100})\s+([a-f0-9]{40})\s*$/.exec(text);
  if (!match || Boolean(match[1]) !== dryRun) throw Error('Usage: /deploy_ring1[_check] <ring1-tag> <full SHA>');
  return { tag: match[2], sha: match[3] };
}

export function validateApproval(receipt, { tag, sha, fingerprint, lockSha256 }, now = Date.now()) {
  if (receipt.tag !== tag || receipt.sha !== sha || receipt.target !== 'ring1-master-b' ||
      receipt.targetFingerprint !== fingerprint || receipt.lockSha256 !== lockSha256) throw Error('Gate-2 receipt does not match release/target');
  assertDatabaseIdentity(receipt.databaseIdentity || {}, receipt.databaseIdentity);
  if (!receipt.approvedBy || !receipt.ownerDecision || !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= now) throw Error('Missing/expired owner approval');
  for (const gate of ['staging', 'ring0Smoke', 'ring0Errors', 'clientErrors', 'nlRestoreMigrations', 'rollback']) {
    if (receipt.gates?.[gate]?.status !== 'PASS' || !receipt.gates[gate].evidence) throw Error(`Gate-2 missing: ${gate}`);
  }
  if (!['PASS', 'WAIVED_BY_OWNER'].includes(receipt.soak?.status) || !receipt.soak.evidence) throw Error('Soak needs evidence or explicit owner waiver');
  if (!/^[a-f0-9]{64}$/.test(receipt.distManifestSha256 || '')) throw Error('Missing reviewed dist manifest');
  return receipt;
}

// Hash code/config identities, never return their contents. A disk fingerprint
// is drift detection, not proof of loaded source or a substitute for gate 2.
export function fingerprintCommand(tree) {
  const script = `const fs=require('fs'),p=require('path'),c=require('crypto');const root=${JSON.stringify(tree)};const files=[];function walk(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=p.join(dir,e.name);if(e.isDirectory()&&e.name!=='node_modules')walk(f);else if(e.isSymbolicLink())throw Error('Symlink in fingerprint scope');else if(e.isFile())files.push(f)}}walk(p.join(root,'backend'));walk(p.join(root,'modules'));for(const n of ['package.json','package-lock.json','.mcp.json',...fs.readdirSync(root).filter(n=>n==='.env'||n.startsWith('.env.'))]){const f=p.join(root,n);if(fs.existsSync(f)){if(!fs.lstatSync(f).isFile())throw Error('Non-file config');files.push(f)}}const h=c.createHash('sha256');for(const f of files.sort()){h.update(p.relative(root,f)+'\\0');h.update(fs.readFileSync(f));h.update('\\0')}console.log(h.digest('hex'));`;
  return `node -e ${quote(script)}`;
}

export function healthy(body) {
  try { const value = JSON.parse(body); return value.status === 'ok' && value.database?.status === 'connected'; }
  catch { return false; }
}

export async function deployRing1({ text, dryRun, runLocal, runRemote, report, config: c }) {
  const { tag, sha } = request(text, dryRun);
  // These paths become shell operands. Reject aliases/overlaps before any write.
  const paths = ['source', 'worktree', 'tree', 'stage', 'docroot', 'backups', 'evidenceRoot', 'approvalRoot'];
  for (const key of paths) if (!/^\/[A-Za-z0-9_./-]+$/.test(c[key]) || c[key].includes('..') || c[key] === '/') throw Error(`Unsafe ${key}`);
  for (const [a, b] of [['stage', 'tree'], ['stage', 'docroot'], ['worktree', 'source'], ['backups', 'tree'], ['evidenceRoot', 'worktree']]) {
    if (c[a] === c[b] || c[a].startsWith(c[b] + '/') || c[b].startsWith(c[a] + '/')) throw Error(`Overlapping ${a}/${b}`);
  }
  if (!/^[A-Za-z0-9@._-]+$/.test(c.host) || c.host.startsWith('-') || !/^[A-Za-z0-9_-]+$/.test(c.pm2)) throw Error('Unsafe host/process');
  if (!/^[A-Za-z0-9_./-]+$/.test(c.knexfile) || c.knexfile.includes('..')) throw Error('Unsafe knexfile');
  if (c.url !== 'https://crm.hltrn.cc/' || c.health !== 'https://crm.hltrn.cc/api/health') throw Error('Unexpected Ring 1 origins');
  const resolved = (await runLocal(`git -C ${quote(c.source)} rev-parse --verify ${quote(`refs/tags/${tag}^{commit}`)}`)).trim();
  if (resolved !== sha) throw Error('Tag does not point to requested SHA');
  const fingerprint = (await runRemote(fingerprintCommand(c.tree))).trim();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw Error('Cannot fingerprint Ring 1');
  const lockSha256 = (await runLocal(`bash -o pipefail -c ${quote(`git -C ${quote(c.source)} show ${sha}:package-lock.json | sha256sum`)}`)).split(/\s+/)[0];
  const healthBefore = (await runLocal(`curl --fail --silent --show-error --max-time 20 ${quote(c.health)}`)).trim();
  if (!healthy(healthBefore)) throw Error('Ring 1 API/database baseline health failed');
  const dbOptions = { tree: c.tree, knexfile: c.knexfile, envFile: c.tree + '/.env' };
  const identityOutput = await runRemote(databaseCommand({ ...dbOptions, action: 'identity' }));
  const databaseIdentity = assertDatabaseIdentity(JSON.parse(identityOutput.trim()).databaseIdentity);
  if (dryRun) {
    await report(JSON.stringify({ mode: 'READ_ONLY', tag, sha, fingerprint, lockSha256, databaseIdentity, health: JSON.parse(healthBefore), gates: 'NOT_EXECUTED' }));
    return;
  }
  // Owner/admin installs the reviewed receipt, not the agent. No automatic PASS.
  const receiptPath = `${c.approvalRoot}/${tag}.json`;
  const readReceipt = `const fs=require('fs');const p=${JSON.stringify(receiptPath)},s=fs.lstatSync(p),d=fs.lstatSync(${JSON.stringify(c.approvalRoot)});if(!s.isFile()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o077)||!d.isDirectory()||d.isSymbolicLink()||d.uid!==0||(d.mode&0o022))throw Error('Approval must be protected and root-owned');process.stdout.write(fs.readFileSync(p));`;
  const receipt = validateApproval(JSON.parse(await runLocal(`node -e ${quote(readReceipt)}`)), { tag, sha, fingerprint, lockSha256 });
  assertDatabaseIdentity(databaseIdentity, receipt.databaseIdentity);
  const id = `ring1-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const stage = `${c.stage}-${id}`;
  const backup = `${c.backups}/${id}`;
  const dir = `${c.evidenceRoot}/${id}`;
  const tools = `${stage}/.release-tools`;
  let evidence, made = false, sealed = false, outcome = 'failed';
  const exclude = "--exclude='.env*' --exclude='/.mcp.json' --exclude='uploads/' --exclude='node_modules' --exclude='.git' --exclude='.gitnexus' --exclude='.cache' --exclude='docs/.snapshots/' --exclude='deploy-bot' --exclude='.release-tools' --exclude='backend/*config.json' --exclude='backend/*tokens.json'";
  try {
    evidence = await createEvidence(runLocal, { dir, worktree: c.worktree, appSha: sha,
      botDigest: hash(fs.readFileSync(c.botFile)),
      helperFiles: ['build-inputs.mjs', 'release-evidence.mjs', 'ring1-release.mjs', 'ring1-database.mjs'].map(f => `${c.source}/deploy-bot/${f}`),
      recorder: `${c.source}/deploy-bot/release-evidence.mjs` });
    const local = evidence.run;
    const remote = (command, timeout) => local(`ssh -o BatchMode=yes -o ConnectTimeout=15 ${quote(c.host)} ${quote(command)}`, timeout);
    await local(`node --version && npm --version && sha256sum ${quote(receiptPath)}`);
    await local(`test ! -e ${quote(c.worktree)} && test ! -L ${quote(c.worktree)} && git -C ${quote(c.source)} worktree add --detach ${quote(c.worktree)} ${sha}`);
    made = true;
    if ((await local(`git -C ${quote(c.worktree)} rev-parse HEAD`)).trim() !== sha) throw Error('Materialized SHA mismatch');
    await buildIsolated(local, c.worktree, `${c.source}/deploy-bot/build-inputs.mjs`);
    const manifestCommand = root => `set -o pipefail; cd ${quote(root)}/dist && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`;
    const manifest = (await local(manifestCommand(c.worktree))).split(/\s+/)[0];
    if (manifest !== receipt.distManifestSha256) throw Error('Built dist differs from reviewed artifact');
    await local(`set -o pipefail; cd ${quote(c.worktree)}/dist && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum`);
    // Recheck approval expiry and target immediately before any NL mutation.
    validateApproval(receipt, { tag, sha, fingerprint: (await remote(fingerprintCommand(c.tree))).trim(), lockSha256 });
    await remote(`test -d ${quote(c.docroot)} && test -f ${quote(c.tree)}/.env && test ! -L ${quote(c.tree)}/node_modules`);
    // Full code+dependencies+config backup supports a same-host code restore.
    // pg_restore --list validates format only; gate-2 requires an actual restore rehearsal.
    const dump = databaseCommand({ ...dbOptions, expected: receipt.databaseIdentity, action: 'dump', dumpPath: backup + '/masterB.dump' });
    await remote(`umask 077 && mkdir -p ${quote(c.backups)} && mkdir ${quote(backup)} && cd ${quote(c.tree)} && ${dump} && pg_restore --list ${quote(backup + '/masterB.dump')} > ${quote(backup + '/dump.list')} && tar czf ${quote(backup + '/tree.tgz')} --exclude='./.git' -C ${quote(c.tree)} . && tar czf ${quote(backup + '/docroot.tgz')} -C ${quote(c.docroot)} . && tar tzf ${quote(backup + '/tree.tgz')} > /dev/null && tar tzf ${quote(backup + '/docroot.tgz')} > /dev/null && cd ${quote(backup)} && sha256sum masterB.dump tree.tgz docroot.tgz > SHA256SUMS && sha256sum -c SHA256SUMS`, 1800000);
    await remote(`umask 077 && mkdir ${quote(stage)} && mkdir ${quote(tools)}`);
    await local(`rsync -az ${exclude} ${quote(c.worktree + '/')} ${quote(c.host + ':' + stage + '/')}`, 600000);
    await local(`rsync -az ${quote(c.source + '/deploy-bot/build-inputs.mjs')} ${quote(c.host + ':' + tools + '/')}`);
    // Install privately on NL BEFORE touching the running tree. No shared symlink.
    await recoverRuntime(remote, stage, `${tools}/build-inputs.mjs`);
    if ((await remote(manifestCommand(stage))).split(/\s+/)[0] !== manifest) throw Error('Shipped dist mismatch');
    const migration = action => databaseCommand({ ...dbOptions, tree: stage, expected: receipt.databaseIdentity, action });
    await remote(migration('status'), 180000);
    await remote(migration('latest'), 600000);
    await remote(`rsync -a ${exclude} ${quote(stage + '/')} ${quote(c.tree + '/')}`, 600000);
    await recoverRuntime(remote, c.tree, `${tools}/build-inputs.mjs`);
    await remote(`pm2 restart ${quote(c.pm2)}`, 180000);
    let backendHealthy = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        backendHealthy = healthy(await local(`curl --fail --silent --show-error --max-time 15 ${quote(c.health)}`));
      } catch { backendHealthy = false; }
      if (backendHealthy) break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (!backendHealthy) throw Error(`Backend unhealthy; frontend withheld. Restore requires administrator; backup ${backup}`);
    await remote(`rsync -a ${quote(stage + '/dist/')} ${quote(c.docroot + '/')}`, 300000);
    // Compare served index AND its entry script bytes, not only a bundle name.
    const index = fs.readFileSync(`${c.worktree}/dist/index.html`, 'utf8');
    const asset = index.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    if (!asset) throw Error('No entry bundle');
    for (const file of ['index.html', asset]) {
      const expected = hash(fs.readFileSync(`${c.worktree}/dist/${file}`));
      const url = c.url + (file === 'index.html' ? '' : file);
      const actual = (await local(`set -o pipefail; curl --fail --silent --show-error --max-time 30 ${quote(url)} | sha256sum`)).split(/\s+/)[0];
      if (actual !== expected) throw Error(`Served bytes mismatch: ${file}`);
    }
    await remote(`printf '%s\\n' ${quote(`${sha} ${new Date().toISOString()} ${asset}`)} > ${quote(c.tree + '/.promoted-sha')}`);
    outcome = 'completed';
    await report(`Ring 1 deployed: ${tag} ${sha}\nBackup: ${backup}\nNative/runtime acceptance remains required.`);
  } finally {
    if (evidence) {
      try { const result = await evidence.finish(outcome); sealed = true; await report(`Evidence: ${dir}\nSHA256SUMS: ${result.manifestSha256}`); }
      catch { await report(`Evidence incomplete; build retained: ${c.worktree}`); }
    }
    if (made && sealed) await runLocal(`git -C ${quote(c.source)} worktree remove --force ${quote(c.worktree)}`, 60000);
  }
}
