// @vitest-environment node
import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createEvidence, clean } from './release-evidence.mjs';
import { buildIsolated, recoverRuntime } from './build-inputs.mjs';

const exec = promisify(execFile);
const recorder = fileURLToPath(new URL('./release-evidence.mjs', import.meta.url));
const verifier = fileURLToPath(new URL('./build-inputs.mjs', import.meta.url));
const roots = [];
afterEach(() => roots.splice(0).forEach(root => {
  const target = process.env.RELEASE_REHEARSAL_EVIDENCE;
  if (target && fs.existsSync(path.join(root, 'evidence'))) {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(path.join(root, 'evidence'), path.join(target, path.basename(root)), { recursive: true });
  }
  fs.rmSync(root, { recursive: true, force: true });
}));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function environment() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-rehearsal-'));
  roots.push(root);
  const worktree = path.join(root, 'app');
  fs.mkdirSync(worktree);
  // Do not inherit production secrets, database settings or npm config.
  const env = { PATH: process.env.PATH, HOME: root, npm_config_cache: path.join(root, 'cache'), npm_config_offline: 'true' };
  const runner = async (command, timeout = 30000) => {
    const { stdout } = await exec('/bin/bash', ['-c', command], { env, timeout, maxBuffer: 1024 * 1024 });
    return stdout;
  };
  const dir = path.join(root, 'evidence');
  const options = { dir, worktree, appSha: 'a'.repeat(40), botDigest: 'b'.repeat(64), helperFiles: [recorder, verifier], recorder };
  const evidence = await createEvidence(runner, options);
  return { root, worktree, dir, env, runner, options, evidence };
}

it('persists full successful and failed streams, versions, outcomes and checksums outside cleanup', async () => {
  const { dir, worktree, evidence } = await environment();
  await evidence.run('node --version && npm --version');
  await evidence.run(`node -e 'process.stdout.write("x".repeat(1200000)+"\\nTAIL\\n")'`);
  await expect(evidence.run(`node -e 'process.stderr.write("failure-tail\\n"); process.exit(9)'`)).rejects.toThrow('Command 3 failed');
  await expect(evidence.run(`node -e 'setTimeout(()=>{},10000)'`, 100)).rejects.toThrow('Command 4 failed');
  const archive = await evidence.finish('failed');
  fs.rmSync(worktree, { recursive: true });
  expect(fs.readFileSync(path.join(dir, '0002.stdout.log'), 'utf8')).toHaveLength(1200006);
  expect(fs.readFileSync(path.join(dir, '0003.stderr.log'), 'utf8')).toBe('failure-tail\n');
  expect(JSON.parse(fs.readFileSync(path.join(dir, '0003.json'))).code).toBe(9);
  expect(JSON.parse(fs.readFileSync(path.join(dir, '0004.json'))).timedOut).toBe(true);
  const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8');
  expect(archive.manifestSha256).toBe(hash(sums));
  for (const line of sums.trim().split('\n')) {
    const [digest, file] = line.split('  ');
    expect(hash(fs.readFileSync(path.join(dir, file)))).toBe(digest);
  }
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'run.json'))).helperDigests[recorder]).toBe(hash(fs.readFileSync(recorder)));
  expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
}, 30000);

it('redacts credentials even when split between chunks and refuses evidence inside worktree or reused IDs', async () => {
  const { evidence, dir, runner, options, worktree } = await environment();
  await evidence.run(`node -e 'process.stdout.write("Bearer sec"); setTimeout(()=>process.stdout.write("ret-value\\nhttps://user:password@example.test\\n"),30)'`);
  const log = fs.readFileSync(path.join(dir, '0001.stdout.log'), 'utf8');
  expect(log).not.toContain('secret-value');
  expect(log).not.toContain('user:password');
  expect(clean('token=abcd secret="long value"', { TEST_PASSWORD: 'abcd' })).not.toContain('abcd');
  await expect(createEvidence(runner, options)).rejects.toThrow();
  await expect(createEvidence(runner, { ...options, dir: path.join(worktree, 'evidence') })).rejects.toThrow();
});

it('archives install, rebuild, full input report and build failure before cleanup using the real helper', async () => {
  const { evidence, dir, worktree, env } = await environment();
  fs.writeFileSync(path.join(worktree, 'package.json'), JSON.stringify({ name: 'isolated-build-fixture', version: '1.0.0', scripts: { build: 'node -e "console.error(\'BUILD-FAILED\'); process.exit(8)"' } }));
  await exec('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: worktree, env });
  // npm creates node_modules only when packages exist; the no-dependency fixture
  // uses a rebuild script to create it, keeping buildIsolated's initial guard real.
  const run = async (command, timeout) => {
    const output = await evidence.run(command, timeout);
    if (command.includes('npm rebuild')) fs.mkdirSync(path.join(worktree, 'node_modules'), { recursive: true });
    return output;
  };
  await expect(buildIsolated(run, worktree, verifier)).rejects.toThrow('Command');
  await evidence.finish('failed');
  const files = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f));
  const commands = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f))));
  expect(commands.some(c => c.command.includes('npm ci') && c.code === 0)).toBe(true);
  expect(commands.some(c => c.command.includes('npm rebuild') && c.code === 0)).toBe(true);
  expect(commands.some(c => c.command.includes('build-inputs.mjs') && c.code === 0)).toBe(true);
  expect(commands.some(c => c.command.includes('npm run build') && c.code === 8)).toBe(true);
});

it('recovers real npm ci after lifecycle failure with unchanged lock hashes, using an offline local package', async () => {
  const { root, evidence, dir, worktree, env } = await environment();
  const pkg = path.join(root, 'package');
  fs.mkdirSync(pkg);
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'recovery-probe', version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(pkg, 'index.js'), 'module.exports = 42;');
  await exec('npm', ['pack', '--offline', '--ignore-scripts', '--pack-destination', root], { cwd: pkg, env });
  fs.copyFileSync(path.join(root, 'recovery-probe-1.0.0.tgz'), path.join(worktree, 'probe.tgz'));
  fs.writeFileSync(path.join(worktree, 'package.json'), JSON.stringify({ name: 'runtime-fixture', version: '1.0.0', dependencies: { 'recovery-probe': 'file:probe.tgz' }, scripts: { postinstall: 'node install.cjs' } }));
  fs.writeFileSync(path.join(worktree, 'install.cjs'), `if(require('fs').existsSync('fail-install')) { require('fs').rmSync('node_modules/recovery-probe',{recursive:true,force:true}); process.exit(17); }`);
  await exec('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: worktree, env });
  const lock = hash(fs.readFileSync(path.join(worktree, 'package-lock.json')));
  fs.writeFileSync(path.join(worktree, 'fail-install'), '');
  await expect(recoverRuntime(evidence.run, worktree, verifier)).rejects.toThrow('failed');
  expect(fs.existsSync(path.join(worktree, 'node_modules/recovery-probe'))).toBe(false);
  expect(hash(fs.readFileSync(path.join(worktree, 'package-lock.json')))).toBe(lock);
  fs.unlinkSync(path.join(worktree, 'fail-install'));
  await recoverRuntime(evidence.run, worktree, verifier);
  expect(hash(fs.readFileSync(path.join(worktree, 'package-lock.json')))).toBe(lock);
  const probe = await exec('node', ['-e', 'if(require("recovery-probe")!==42)process.exit(1)'], { cwd: worktree, env });
  expect(probe.stderr).toBe('');
  await evidence.finish('recovery-passed');
  const commands = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(dir, f))));
  const installs = commands.filter(c => c.command.includes('npm ci --omit=dev'));
  expect(installs).toHaveLength(2);
  expect(installs[0].code).not.toBe(0);
  expect(installs[1].code).toBe(0);
}, 60000);
