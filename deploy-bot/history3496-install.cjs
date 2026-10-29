// Operator-only packaging; never invoked from Telegram and never restarts a runtime.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { networkInterfaces } = require('node:os');
const { z } = require('zod');
const c = require('./history3496.cjs');
const REPO = '/root/production/business-crm';
const DEPENDENCIES = '/srv/godcrm/live';
const SOURCE = '/root/backups/temp/chat3496-space44-246779-20261010-developer-ralph/inputs';
const SOURCE_FILES = '/root/backups/temp/ring1-chat2068-export-20261007-sysadmin/package/files.tar';
const SOURCE_MAP = `${SOURCE}/file-map.json`;
const IMPORTER = ['scripts/import-historical-chat.mjs', 'backend/services/chat/historical-import.js',
  'backend/services/chat/historical-related.js', 'backend/services/chat/historical-files.js', 'backend/services/chat/historical-migration.js'];
const run = (exe, argv, options = {}) => execFileSync(exe, argv, { env: c.cleanEnv, shell: false, ...options });
function dependencyVersions(root, lock) {
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative || !relative.includes('node_modules/')) continue;
    const file = path.join(root, relative, 'package.json');
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).version !== entry.version) throw new Error(`Dependency version mismatch: ${relative}`);
  }
}
function copyInstalledDependencies(source, target) {
  fs.cpSync(source, target, { recursive: true, dereference: true, filter: entry => {
    if (['.cache', '.vite', '.vite-temp'].includes(path.basename(entry))) return false;
    if (fs.lstatSync(entry).isSymbolicLink() && fs.statSync(entry).isDirectory()) {
      if (entry === `${source}/node_modules` && fs.realpathSync(entry) === fs.realpathSync(source)) return false;
      throw new Error('Unsupported dependency directory link');
    }
    return true;
  } });
}
async function inventory(root) {
  const files = {};
  async function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), st = fs.lstatSync(file);
      if (st.isSymbolicLink() || st.uid !== 0) throw new Error('Untrusted installation artifact');
      if (st.isDirectory()) { fs.chmodSync(file, 0o500); await walk(file); }
      else { fs.chmodSync(file, st.mode & 0o111 ? 0o500 : 0o400); files[path.relative(root, file)] = await c.digest(file); }
    }
  }
  await walk(root);
  return files;
}
async function installHistory3496(action, revision) {
  z.enum(['prepare', 'enable', 'disable']).parse(action);
  c.sha.parse(revision);
  if (process.getuid() !== 0 || !Object.values(networkInterfaces()).flat().some(n => n?.address === '<PROD_IP>')) throw new Error('Owner installation requires root on Ring 0');
  if (action !== 'prepare') {
    const m = c.readJson(c.MANIFEST);
    if (m.channel_commit_sha !== revision) throw new Error('Installed SHA mismatch');
    // Enabling is an explicit operator act; templates and prepare never enable.
    if (action === 'enable') {
      if (await c.digest(`${c.ROOT}/releases/${revision}/inventory.json`) !== m.inventory_sha256) throw new Error('Inventory changed');
      await c.checkInventory({ ...m, artifact: `${c.ROOT}/releases/${revision}` });
    }
    const backup = `/root/backups/temp/history3496-config-${Date.now()}`;
    fs.mkdirSync(backup, { mode: 0o700 });
    fs.copyFileSync(c.MANIFEST, `${backup}/manifest.json`, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(`${backup}/manifest.json`, 0o600);
    c.durableJson(`${c.MANIFEST}.next`, { ...m, enabled: action === 'enable' });
    fs.renameSync(`${c.MANIFEST}.next`, c.MANIFEST);
    return;
  }
  if (fs.existsSync(c.MANIFEST)) throw new Error('Existing installation: disable and review upgrade/rollback before replacing');
  if (run('/usr/bin/git', ['-C', REPO, 'rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' }).trim() !== revision) throw new Error('Exact commit required');
  if (await c.digest(`${REPO}/package-lock.json`) !== c.LOCKFILE) throw new Error('Reviewed dependency lock mismatch');
  if (await c.digest(`${DEPENDENCIES}/package-lock.json`) !== c.LOCKFILE) throw new Error('Installed dependency lock mismatch');
  // Each copied package must match the committed lock; live can supply a locked
  // version missing/drifted in the edit dependency tree (no downloads).
  dependencyVersions(`${REPO}/deploy-bot`, JSON.parse(fs.readFileSync(`${REPO}/deploy-bot/package-lock.json`, 'utf8')));
  for (const file of IMPORTER) {
    const reviewed = run('/usr/bin/git', ['-C', REPO, 'show', `${c.REVIEWED}:${file}`]);
    const candidate = run('/usr/bin/git', ['-C', REPO, 'show', `${revision}:${file}`]);
    if (!reviewed.equals(candidate)) throw new Error('Importer changed: separate compatibility review required');
  }
  const disk = fs.statfsSync('/opt');
  if (disk.bavail * disk.bsize < 11 * 1024 ** 3) throw new Error('Need 11 GiB free for private dependencies and later uploads');
  const artifact = `${c.ROOT}/releases/${revision}`;
  for (const dir of [c.ROOT, `${c.ROOT}/releases`, `${c.ROOT}/inputs`, '/etc/godcrm', c.STATE, `${c.STATE}/runs`]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
    c.trusted(dir, { directory: true, privateFile: true });
  }
  const backup = `/root/backups/temp/history3496-install-${revision}-${Date.now()}`;
  fs.mkdirSync(backup, { mode: 0o700 });
  // Backup and restoration round-trip of bot config, without changing its source.
  for (const name of ['.env', 'bot.js']) {
    const source = `${REPO}/deploy-bot/${name}`, copy = `${backup}/${name}`;
    c.trusted(source);
    fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL); fs.chmodSync(copy, 0o600);
    fs.copyFileSync(copy, `${copy}.restore-check`, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(`${copy}.restore-check`, 0o600);
    if (await c.digest(source) !== await c.digest(`${copy}.restore-check`)) throw new Error('Config restoration check failed');
    fs.unlinkSync(`${copy}.restore-check`);
  }
  fs.mkdirSync(artifact, { mode: 0o700 });
  run('/usr/bin/git', ['-C', REPO, 'archive', '--format=tar', `--output=${backup}/artifact.tar`, revision]);
  run('/usr/bin/tar', ['-xf', `${backup}/artifact.tar`, '-C', artifact]);
  // Copy the already installed dependency set, never npm install during activation.
  for (const relative of ['node_modules', 'deploy-bot/node_modules']) {
    copyInstalledDependencies(`${REPO}/${relative}`, `${artifact}/${relative}`);
  }
  const lock = JSON.parse(fs.readFileSync(`${artifact}/package-lock.json`, 'utf8'));
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative.includes('node_modules/')) continue;
    const target = `${artifact}/${relative}`, live = `${DEPENDENCIES}/${relative}`;
    if (fs.existsSync(`${target}/package.json`) && JSON.parse(fs.readFileSync(`${target}/package.json`, 'utf8')).version !== entry.version) {
      if (!fs.existsSync(`${live}/package.json`) || JSON.parse(fs.readFileSync(`${live}/package.json`, 'utf8')).version !== entry.version) throw new Error('No installed locked dependency available');
      fs.rmSync(target, { recursive: true }); copyInstalledDependencies(live, target);
    }
  }
  for (const name of ['zod', 'tar', 'pg', 'pino']) if (!fs.existsSync(`${artifact}/node_modules/${name}/package.json`)) throw new Error('Missing importer dependency');
  dependencyVersions(artifact, lock);
  // Seal archive modes before any trusted read, including the RUNBOOK copy.
  const files = await inventory(artifact);
  for (const [source, target] of [[`${SOURCE}/conversation-3496.json`, 'conversation-3496.json'], [SOURCE_MAP, 'file-map.json'],
    [`${SOURCE}/related-data.json`, 'related-data.json'], [`${SOURCE}/archived-only-messages.json`, 'archived-only-messages.json'],
    [`${artifact}/scripts/HISTORICAL-CHAT-IMPORT.md`, 'RUNBOOK.md']]) {
    c.trusted(source); fs.copyFileSync(source, `${c.ROOT}/inputs/${target}`, fs.constants.COPYFILE_EXCL); fs.chmodSync(`${c.ROOT}/inputs/${target}`, 0o400);
  }
  // Same-filesystem hard link preserves the 6 GiB archive without doubling storage.
  // Both names are made read-only; content and the original archive path are retained.
  c.trusted(SOURCE_FILES);
  fs.linkSync(SOURCE_FILES, `${c.ROOT}/inputs/files.tar`); fs.chmodSync(`${c.ROOT}/inputs/files.tar`, 0o400);
  c.durableJson(`${artifact}/inventory.json`, files);
  fs.chmodSync(`${artifact}/inventory.json`, 0o400); fs.chmodSync(artifact, 0o500);
  const deployed = fs.readFileSync(c.trusted('/srv/godcrm/live/.promoted-sha'), 'utf8').split(/\s+/)[0]; c.sha.parse(deployed);
  const manifest = { version: 1, enabled: false, installed_by: c.OWNER, reviewed_importer_sha: c.REVIEWED,
    channel_commit_sha: revision, deployed_app_sha: deployed, inventory_sha256: await c.digest(`${artifact}/inventory.json`),
    node_sha256: await c.digest('/usr/bin/node'), flock_sha256: await c.digest('/usr/bin/flock') };
  await c.checkInventory({ ...manifest, artifact });
  c.durableJson(c.MANIFEST, manifest);
  c.durableJson(`${backup}/installation.json`, { manifest, backup, config_restore_checked: true, artifact });
}
if (require.main === module) installHistory3496(process.argv[2], process.argv[3]).catch(() => {
  // Do not echo exceptions: dependency tools may include credentials in errors.
  process.stderr.write('Installation stopped. Review private paths and runbook; no runtime was restarted.\n'); process.exitCode = 1;
});
module.exports = { dependencyVersions, copyInstalledDependencies, inventory, installHistory3496 };
