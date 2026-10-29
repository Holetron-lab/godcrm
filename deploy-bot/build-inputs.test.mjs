// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { requestedRevision, inspectInputs, buildIsolated, recoverRuntime } from './build-inputs.mjs';

const require = createRequire(import.meta.url);
const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-inputs-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'node_modules/a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules/a/package.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
    '': {}, 'node_modules/a': { version: '1.0.0' },
    'node_modules/mac-only': { version: '1', optional: true, os: ['darwin'] },
    'node_modules/optional': { version: '1', optional: true },
  } }));
  return root;
}

describe('isolated Ring 0 inputs', () => {
  it('accepts only default HEAD or a full SHA, rejecting shell syntax and partial commands', () => {
    expect(requestedRevision('/deploy_prod')).toBe('HEAD');
    expect(requestedRevision('/deploy_prod@bot ' + 'a'.repeat(40))).toBe('a'.repeat(40));
    for (const value of ['/deploy_prod deadbeef', '/deploy_prod main', '/deploy_prod;id', 'text /deploy_prod', '/deploy_prod_check', '/deploy_prod ' + 'a'.repeat(40) + ' extra']) {
      expect(() => requestedRevision(value)).toThrow('Usage:');
    }
  });
  it('compares actual files and distinguishes optional/platform omissions', () => {
    const root = fixture();
    const result = inspectInputs(root);
    expect(result.ok).toBe(true);
    expect(result.omittedPlatform).toEqual(['node_modules/mac-only']);
    expect(result.missingOptional).toEqual(['node_modules/optional']);
    fs.writeFileSync(path.join(root, 'node_modules/a/package.json'), '{"version":"0.9.0"}');
    expect(inspectInputs(root).mismatches).toHaveLength(1);
    fs.rmSync(path.join(root, 'node_modules/a'), { recursive: true });
    expect(inspectInputs(root).missingRequired).toEqual(['node_modules/a']);
    expect(inspectInputs(root).ok).toBe(false);
  });
  it('rejects a shared module directory or an escaping nested symlink', () => {
    const root = fixture();
    const other = fixture();
    fs.rmSync(path.join(root, 'node_modules/a'), { recursive: true });
    fs.symlinkSync(path.join(other, 'node_modules/a'), path.join(root, 'node_modules/a'));
    expect(() => inspectInputs(root)).toThrow('escapes');
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
    fs.symlinkSync(path.join(other, 'node_modules'), path.join(root, 'node_modules'));
    expect(() => inspectInputs(root)).toThrow('symlink');
  });
  it('never builds after installation/verification failure; never uses npm install or audit', async () => {
    for (const failAt of ['npm ci', 'node ', 'test !']) {
      const commands = [];
      await expect(buildIsolated(async command => {
        commands.push(command);
        if (command.startsWith(failAt) || command.includes('&& ' + failAt)) throw Error('failed');
        return 'a'.repeat(64) + '  lock';
      }, '/tmp/private', '/trusted/check.cjs')).rejects.toThrow();
      expect(commands.some(command => command.includes('npm run build'))).toBe(false);
      expect(commands.some(command => /npm (install|audit)/.test(command))).toBe(false);
    }
  });
  it('verifies the lock remains unchanged after a successful build', async () => {
    let hashes = 0;
    await expect(buildIsolated(async command => command.startsWith('sha256sum')
      ? (++hashes === 1 ? 'a' : 'b').repeat(64) + '  lock' : '{}', '/tmp/private')).rejects.toThrow('modified');
  });
});

// Fake Telegram and shell: no deployment commands execute on the host.
async function runHandler({ revision, failure, sealFailure } = {}) {
  const calls = []; const messages = []; const handlers = [];
  let done;
  const completion = new Promise(resolve => { done = resolve; });
  const sha = revision || 'a'.repeat(40);
  class Telegram {
    onText(regex, handler) { handlers.push([regex, handler]); }
    on() {}
    async sendMessage(_id, text) { messages.push(text); return { message_id: 7 }; }
    async editMessageText(text) { messages.push(text); }
  }
  const runner = async command => {
    calls.push(command);
    if (failure && command.includes(failure)) throw Error('fixture failure');
    if (command.includes('worktree remove')) { done(); return { stdout: '', stderr: '' }; }
    let stdout = 'OK';
    if (command.includes('rev-parse')) stdout = sha;
    else if (command.includes('status --porcelain')) stdout = '0';
    else if (command.includes('sha256sum')) stdout = 'b'.repeat(64) + '  lock';
    else if (command.includes('sha1sum')) stdout = 'same-lock';
    else if (command.includes('grep -oE')) stdout = 'assets/index-fixture.js';
    return { stdout, stderr: '' };
  };
  const context = {
    require: name => name === 'dotenv' ? { config() {} }
      : name === 'node-telegram-bot-api' ? Telegram
      : name === 'child_process' ? { exec() {} }
      : name === 'util' ? { promisify: () => runner }
      : require(name),
    __filename: new URL('./bot.js', import.meta.url).pathname,
    done,
    loadEvidence: async () => ({ startReleaseEvidence: async (transport) => ({
      run: transport,
      finish: async () => { calls.push('SEAL'); if (sealFailure) throw Error('disk failed'); return { dir: '/evidence', manifestSha256: 'c'.repeat(64) }; },
    }) }),
    process: { env: { BOT_TOKEN: 'fixture', OWNER_ID: '1', PROD_CODE: '/source', DEPLOY_WORKTREE: '/private', RUN_MIGRATIONS: '0' } },
    console: { log() {}, error() {} }, setInterval: () => 0, setTimeout, Buffer,
    loadBuildInputs: async () => ({ requestedRevision, inspectInputs, buildIsolated, recoverRuntime }),
  };
  const source = fs.readFileSync(new URL('./bot.js', import.meta.url), 'utf8');
  expect(source).toContain("await import('./build-inputs.mjs')");
  vm.runInNewContext(source.replace("import('./build-inputs.mjs')", 'loadBuildInputs()').replace("import('./release-evidence.mjs')", 'loadEvidence()').replace("releaseLock('deploy_prod');", "releaseLock('deploy_prod'); done();"), context);
  const handler = handlers.find(([regex]) => regex.test('/deploy_prod'))[1];
  handler({ text: '/deploy_prod' + (revision ? ' ' + revision : ''), from: { id: 1 }, chat: { id: 1 }, message_id: 1 });
  await completion;
  return { calls, messages };
}

describe('Ring 0 handler', () => {
  it('suppresses only materialization hooks while preserving the shared hook configuration', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-hook-'));
    roots.push(root);
    const source = path.join(root, 'source');
    const target = path.join(root, 'artifact');
    const shared = path.join(root, 'shared-modules');
    const hooks = path.join(root, 'hooks');
    fs.mkdirSync(source); fs.mkdirSync(shared); fs.mkdirSync(hooks);
    const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
    git('init');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Fixture');
    git('config', 'core.hooksPath', hooks);
    fs.writeFileSync(path.join(source, 'README'), 'fixture');
    git('add', 'README'); git('commit', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(hooks, 'post-checkout'), `#!/bin/sh\nln -s '${shared}' node_modules\n`, { mode: 0o700 });
    // Positive control: the real checkout hook contaminates an ordinary worktree.
    git('worktree', 'add', '--detach', target, sha);
    expect(fs.lstatSync(path.join(target, 'node_modules')).isSymbolicLink()).toBe(true);
    git('worktree', 'remove', '--force', target);
    const { calls } = await runHandler({ revision: sha });
    const materialize = calls.find(c => c.includes('worktree add --detach'))
      .replaceAll('/source', source).replaceAll('/private', target);
    execFileSync('sh', ['-c', materialize]);
    expect(fs.existsSync(path.join(target, 'node_modules'))).toBe(false);
    expect(execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(sha);
    expect(git('config', '--get', 'core.hooksPath')).toBe(hooks);
    // An occupied path must still fail and must not disturb its contents.
    fs.writeFileSync(path.join(target, 'sentinel'), 'keep');
    expect(() => execFileSync('sh', ['-c', materialize], { stdio: 'pipe' })).toThrow();
    expect(fs.readFileSync(path.join(target, 'sentinel'), 'utf8')).toBe('keep');
    git('worktree', 'remove', '--force', target);
    git('worktree', 'add', '--detach', target, sha);
    expect(fs.lstatSync(path.join(target, 'node_modules')).isSymbolicLink()).toBe(true);
  });
  it('passes the explicit production frontend input through the Ring 0 handler', async () => {
    const { calls } = await runHandler();
    expect(calls.find(c => c.includes('npm run build'))).toContain('VITE_USER_NODE_ENV=production npm run build');
    expect(calls.find(c => c.includes('npm ci --include=dev'))).not.toContain('VITE_USER_NODE_ENV');
  });
  it('preserves default helper behavior and applies production input in a real build subprocess', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-build-env-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { build: 'node build.cjs' } }));
    fs.writeFileSync(path.join(root, 'build.cjs'), "require('fs').writeFileSync('received.txt', process.env.VITE_USER_NODE_ENV)");
    for (const productionFrontend of [false, true]) {
      await buildIsolated(async command => {
        if (command.includes('npm run build')) execFileSync('sh', ['-c', command], { env: { ...process.env, VITE_USER_NODE_ENV: 'inherited' }, stdio: 'pipe' });
        return 'a'.repeat(64) + '  lock';
      }, root, '/unused-verifier', { productionFrontend });
      expect(fs.readFileSync(path.join(root, 'received.txt'), 'utf8')).toBe(productionFrontend ? 'production' : 'inherited');
    }
  });
  it('still rejects real directories, shared symlinks and dangling symlinks before any install', async () => {
    for (const kind of ['directory', 'shared', 'dangling']) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-guard-'));
      roots.push(root);
      if (kind === 'directory') fs.mkdirSync(path.join(root, 'node_modules'));
      else fs.symlinkSync(kind === 'shared' ? root : path.join(root, 'missing'), path.join(root, 'node_modules'));
      const commands = [];
      await expect(buildIsolated(async command => {
        commands.push(command);
        execFileSync('sh', ['-c', command], { stdio: 'pipe' });
      }, root)).rejects.toThrow();
      expect(commands).toHaveLength(1);
      expect(fs.lstatSync(path.join(root, 'node_modules'))).toBeTruthy();
    }
  });
  it('reinstalls runtime inputs even on equal locks and aborts before restart on failure', async () => {
    const { calls } = await runHandler({ failure: 'npm ci --omit=dev' });
    expect(calls.some(c => c.includes('NODE_ENV=production npm ci --omit=dev'))).toBe(true);
    expect(calls.some(c => c.includes('pm2 restart') || c.includes('.promoted-sha'))).toBe(false);
    expect(calls).toContain('SEAL');
  });
  it('retains the worktree when evidence cannot be sealed', async () => {
    const { calls } = await runHandler({ sealFailure: true });
    expect(calls).toContain('SEAL');
    expect(calls.some(c => c.includes('worktree remove'))).toBe(false);
  });
  it('materializes a pinned rollback with its own dependencies, then cleans up', async () => {
    const sha = 'e6afa22e9f3c31d7832d347d8dbd0fc07daed472';
    const { calls } = await runHandler({ revision: sha });
    expect(calls.some(c => c.includes(`worktree add --detach /private ${sha}`))).toBe(true);
    expect(calls.some(c => c.includes('ln -s'))).toBe(false);
    expect(calls.some(c => c.includes('npm ci --include=dev'))).toBe(true);
    expect(calls.at(-1)).toContain('worktree remove');
    expect(calls.indexOf('SEAL')).toBeLessThan(calls.length - 1);
  });
  it('stops before migrations, live sync and process control if dependency verification fails', async () => {
    const { calls } = await runHandler({ failure: 'build-inputs.mjs' });
    expect(calls.some(c => /rsync|pm2|migrate:latest/.test(c))).toBe(false);
    expect(calls.at(-1)).toContain('worktree remove');
  });
});
