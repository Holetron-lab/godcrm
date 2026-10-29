import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/staging-sync.sh');
const protectedPaths = [
  '.env', '.env.edit', '.env.prod-real', '.env.bak.20261002', 'backend/.env',
  '.mcp.json', 'nested/.mcp.json', 'scripts/deploy.local.env',
  'deploy/hindsight/hindsight.env', 'deploy/hindsight/hindsight.env.bak-1',
  'deploy/penpot/penpot.env', 'deploy/penpot/docker-compose.yaml',
  'deploy/livekit/livekit.yaml', 'deploy-bot/config.json', 'ecosystem.config.cjs',
  'ecosystem.edit.config.cjs', 'nested/settings.backup', 'nested/settings.old',
  'nested/settings.original', 'nested/key.pem', 'nested/private.key',
  'nested/credentials-service.json', 'nested/secrets.json', 'backend/smtp-config.json',
  'backend/google-calendar-tokens.json', '.npmrc', '.ssh/id_rsa',
  'node_modules/pkg/index.js', 'dist/index.html', 'data/state.json', 'logs/app.log',
  'uploads/file.txt', 'backend/public/uploads/file.txt', 'pes-core/pes-data/state',
  'scripts/snapshots/snapshot.json', '.backups/config', '.cache/result',
];
const codePaths = ['package.json', 'package-lock.json', 'backend/server.js', 'src/main.tsx',
  'scripts/staging-sync.sh', 'public/icon.svg', 'nested/with space.txt', 'nested/with\nnewline.txt'];

function put(root, name, data) {
  const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data);
}
function run(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 20000 });
  assert.ifError(r.error); return r;
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'staging-sync-'));
  const source = join(root, 'source'); const dest = join(root, 'dest');
  mkdirSync(source); mkdirSync(dest);
  const git = (...args) => {
    const r = run('git', ['-C', source, ...args]); assert.equal(r.status, 0, r.stderr); return r.stdout;
  };
  git('init', '-q');
  for (const name of [...codePaths, ...protectedPaths]) put(source, name, `SYNTHETIC SOURCE ${name}`);
  put(root, 'outside-secret', 'SYNTHETIC OUTSIDE SECRET');
  symlinkSync('../outside-secret', join(source, 'escaping-link'));
  symlinkSync(join(root, 'outside-secret'), join(source, 'absolute-link'));
  git('add', '--', ...codePaths, ...protectedPaths, 'escaping-link', 'absolute-link');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic fixture');
  // Deliberately no .gitignore: arbitrary local names must still stay local.
  put(source, 'untracked-opaque-config', 'SYNTHETIC UNTRACKED SECRET');
  put(source, 'src/untracked.js', 'uncommitted code');
  for (const name of protectedPaths) put(dest, name, `TARGET OWNED ${name}`);
  put(dest, 'destination-only.txt', 'PRESERVE');
  return { root, source, dest, git };
}

for (const mode of ['transfer', 'dry-run', 'dirty', 'staged', 'mcp-local']) {
  test(`staging sync: ${mode}`, () => {
    const f = fixture();
    try {
      if (['dirty', 'staged'].includes(mode)) put(f.source, 'backend/server.js', 'dirty tracked code');
      if (mode === 'staged') f.git('add', '--', 'backend/server.js');
      if (mode === 'mcp-local') put(f.source, '.mcp.json', 'SYNTHETIC HOST LOCAL CONFIG');
      const args = [script, f.source, f.dest + '/'];
      if (mode === 'dry-run') args.push('--dry-run');
      const result = run('bash', args);
      const blocked = ['dirty', 'staged'].includes(mode);
      assert.equal(result.status, blocked ? 1 : 0, result.stderr);
      for (const name of protectedPaths) assert.equal(readFileSync(join(f.dest, name), 'utf8'), `TARGET OWNED ${name}`);
      for (const name of codePaths) {
        const path = join(f.dest, name);
        if (blocked || mode === 'dry-run') assert.equal(existsSync(path), false, name);
        else assert.equal(readFileSync(path, 'utf8'), `SYNTHETIC SOURCE ${name}`);
      }
      for (const name of ['untracked-opaque-config', 'src/untracked.js', 'escaping-link', 'absolute-link']) {
        assert.equal(existsSync(join(f.dest, name)), false, name);
      }
      assert.equal(readFileSync(join(f.dest, 'destination-only.txt'), 'utf8'), 'PRESERVE');
      if (mode === 'dry-run') {
        assert.match(result.stdout, /backend\/server.js/);
        assert.doesNotMatch(result.stdout, /\.env|\.mcp|hindsight|penpot|ecosystem|untracked/);
      }
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}
