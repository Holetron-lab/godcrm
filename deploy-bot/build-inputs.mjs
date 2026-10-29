// Ring 0 build inputs: never borrow or repair a running checkout's modules.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);

const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";

function requestedRevision(text) {
  const match = /^\/deploy_prod(?:@[A-Za-z0-9_]+)?(?:\s+([a-f0-9]{40}))?\s*$/.exec(text);
  if (!match) throw new Error('Usage: /deploy_prod [full 40-character commit SHA]');
  return match[1] || 'HEAD';
}

function matchesPlatform(values, current) {
  if (!values || !values.length) return true;
  if (values.includes(`!${current}`)) return false;
  const positive = values.filter(value => !value.startsWith('!'));
  return !positive.length || positive.includes(current) || positive.includes('any');
}

function inspectInputs(root, runtime = false) {
  const lockBytes = fs.readFileSync(path.join(root, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  if (lock.lockfileVersion < 2 || !lock.packages) throw new Error('A v2+ npm lockfile is required');
  const modules = path.join(root, 'node_modules');
  if (fs.lstatSync(modules).isSymbolicLink()) throw new Error('Shared node_modules symlink is forbidden');
  const result = {
    root: fs.realpathSync(root), modules: fs.realpathSync(modules),
    lockSha256: crypto.createHash('sha256').update(lockBytes).digest('hex'),
    node: process.version, platform: process.platform, arch: process.arch,
    checked: 0, mismatches: [], missingRequired: [], omittedPlatform: [], missingOptional: [],
  };
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location || (runtime && entry.dev)) continue;
    if (!location.startsWith('node_modules/') || location.split('/').includes('..') || entry.link) {
      throw new Error(`Unsupported dependency location: ${location}`);
    }
    const manifest = path.join(root, location, 'package.json');
    if (!fs.existsSync(manifest)) {
      const platformExcluded = !matchesPlatform(entry.os, process.platform) || !matchesPlatform(entry.cpu, process.arch);
      if (platformExcluded && entry.optional) result.omittedPlatform.push(location);
      else if (entry.optional) result.missingOptional.push(location);
      else result.missingRequired.push(location);
      continue;
    }
    if (!fs.realpathSync(manifest).startsWith(result.modules + path.sep)) {
      throw new Error(`Dependency escapes isolated modules: ${location}`);
    }
    const actual = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
    result.checked++;
    if (actual !== entry.version) result.mismatches.push({ path: location, expected: entry.version, actual });
  }
  // npm may omit optional dependencies, including transitive platform-only trees.
  // Every omission stays in evidence; npm ls and native/build smoke run separately.
  result.ok = !result.mismatches.length && !result.missingRequired.length;
  return result;
}

async function buildIsolated(runner, root, verifier = filename, { productionFrontend = false } = {}) {
  const dir = quote(root);
  // Check BEFORE npm ci: npm would otherwise remove a shared symlink silently.
  await runner(`test ! -e ${dir}/node_modules && test ! -L ${dir}/node_modules`, 30000);
  const before = (await runner(`sha256sum ${dir}/package-lock.json`, 30000)).split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(before)) throw new Error('Cannot fingerprint build lockfile');
  await runner(`cd ${dir} && npm ci --include=dev --ignore-scripts --no-audit --no-fund`, 600000);
  await runner(`cd ${dir} && npm rebuild better-sqlite3 bcrypt esbuild --no-audit --no-fund`, 300000);
  await runner(`mkdir -p ${dir}/node_modules/.vite ${dir}/node_modules/.vite-temp`, 30000);
  const report = await runner(`node ${quote(verifier)} ${dir}`, 30000);
  // Ring 0 matches the accepted staging Vite input without copying env files.
  // Opt in at that handler; other callers retain their existing environment.
  const build = productionFrontend ? 'VITE_USER_NODE_ENV=production npm run build' : 'npm run build';
  await runner(`cd ${dir} && npm ls --depth=0 && ${build}`, 600000);
  const after = (await runner(`sha256sum ${dir}/package-lock.json`, 30000)).split(/\s+/)[0];
  if (before !== after) throw new Error('Build modified package-lock.json');
  return report;
}

// A copied lockfile cannot attest node_modules after a failed npm ci. Always
// reinstall on promotion, including retries and same-lock rollback. Fail closed
// before the promoted marker/restart; the administrator controls outage recovery.
async function recoverRuntime(runner, root, verifier = filename) {
  const dir = quote(root);
  await runner(`test ! -L ${dir}/node_modules`, 30000);
  const before = (await runner(`sha256sum ${dir}/package-lock.json`, 30000)).split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(before)) throw new Error('Cannot fingerprint runtime lockfile');
  await runner(`cd ${dir} && NODE_ENV=production npm ci --omit=dev --no-audit --no-fund`, 600000);
  await runner(`node ${quote(verifier)} ${dir} --runtime`, 30000);
  await runner(`cd ${dir} && npm ls --omit=dev --depth=0`, 60000);
  const after = (await runner(`sha256sum ${dir}/package-lock.json`, 30000)).split(/\s+/)[0];
  if (before !== after) throw new Error('Runtime install modified package-lock.json');
}

export { requestedRevision, inspectInputs, buildIsolated, recoverRuntime };
if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  try {
    const result = inspectInputs(path.resolve(process.argv[2] || '.'), process.argv[3] === '--runtime');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
