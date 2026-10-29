const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname, 'bot.js'), 'utf8');
// Exercise the actual sync policy: Ring 0 in the bot, DEV in staging-sync.
// Full helper/committed-manifest coverage lives in scripts/staging-sync.test.mjs.
for (const command of ['deploy_prod', 'deploy_dev']) {
  const start = source.indexOf(command === 'deploy_dev' ? 'bot.onText(/^\\/deploy_dev' : 'bot.onText(/\\/deploy_prod/');
  assert.ok(start >= 0, `${command} handler exists`);
  const next = source.indexOf('bot.onText(', start + 1);
  const handler = source.slice(start, next < 0 ? undefined : next);
  let flags;
  if (command === 'deploy_dev') {
    assert.ok(handler.includes("await runSSH('make -C /root/production/business-crm dev', 900000)"));
    const deploy = fs.readFileSync(path.join(__dirname, '../scripts/deploy.sh'), 'utf8');
    assert.ok(deploy.includes('bash "$PROJ/scripts/staging-sync.sh" "$PROJ" "$DEV_HOST:$PROJ/"'));
    const helper = fs.readFileSync(path.join(__dirname, '../scripts/staging-sync.sh'), 'utf8');
    assert.ok(helper.includes('done < "$(dirname "$0")/staging-sync.exclude"'));
    assert.ok(helper.includes('options+=(--exclude="$pattern")'));
    assert.match(helper, /rsync -az --safe-links --from0 --files-from="\$manifest"\s*\\\n\s*"\$\{options\[@\]\}" -- "\$source_tree\/" "\$2"/);
    assert.doesNotMatch(helper, /--delete/, 'staging must preserve target-owned state');
    flags = fs.readFileSync(path.join(__dirname, '../scripts/staging-sync.exclude'), 'utf8')
      .split('\n').filter(pattern => pattern && !pattern.startsWith('#'))
      .map(pattern => `--exclude=${pattern}`);
  } else {
    const sync = handler.match(/`rsync [\s\S]*?`,\s*\d+/);
    assert.ok(sync, `${command} rsync exists`);
    flags = [...sync[0].matchAll(/--exclude='([^']+)'/g)].map(m => `--exclude=${m[1]}`);
    if (sync[0].includes('--delete')) flags.push('--delete');
  }

  for (const scenario of ['existing', 'absent', 'source-absent']) {
    test(`${command}: ${scenario} local MCP configuration`, t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-rsync-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const from = path.join(root, 'artifact');
      const to = path.join(root, 'destination');
      fs.mkdirSync(from);
      fs.mkdirSync(to);
      const config = path.join(to, '.mcp.json');
      const local = '{"server":"local-fixture"}\n';
      if (scenario !== 'absent') fs.writeFileSync(config, local, { mode: 0o600 });
      if (scenario !== 'source-absent') {
        fs.writeFileSync(path.join(from, '.mcp.json'), '{"server":"artifact-fixture"}\n');
      }
      fs.writeFileSync(path.join(from, 'app.js'), 'new artifact');
      fs.writeFileSync(path.join(to, 'app.js'), 'old');
      fs.writeFileSync(path.join(to, '.env'), 'local environment');
      fs.writeFileSync(path.join(from, '.env'), 'artifact environment');
      fs.writeFileSync(path.join(to, 'destination-only.txt'), 'local state');
      const manifestFlags = [];
      if (command === 'deploy_dev') {
        // Match --files-from semantics without requiring Git in the offline
        // container: all fixture files are offered, including protected ones.
        const manifest = path.join(root, 'manifest');
        fs.writeFileSync(manifest, fs.readdirSync(from).join('\0') + '\0');
        manifestFlags.push('--safe-links', '--from0', `--files-from=${manifest}`);
      }
      execFileSync('rsync', ['-a', ...manifestFlags, ...flags, `${from}/`, `${to}/`], { stdio: ['ignore', 'pipe', 'pipe'] });
      assert.equal(fs.readFileSync(path.join(to, 'app.js'), 'utf8'), 'new artifact');
      assert.equal(fs.readFileSync(path.join(to, '.env'), 'utf8'), 'local environment');
      assert.equal(fs.readFileSync(path.join(to, 'destination-only.txt'), 'utf8'), 'local state');
      if (scenario === 'absent') {
        assert.equal(fs.existsSync(config), false);
      } else {
        assert.equal(fs.readFileSync(config, 'utf8'), local);
        assert.equal(fs.statSync(config).mode & 0o777, 0o600);
      }
    });
  }
}

// Reuse the production handler's exact flags for forward and reverse artifact copies.
{
  const start = source.indexOf('bot.onText(/\\/deploy_prod/');
  const handler = source.slice(start, source.indexOf('bot.onText(', start + 1));
  const sync = handler.match(/`rsync [\s\S]*?`,\s*\d+/);
  assert.ok(sync);
  assert.doesNotMatch(sync[0], /--delete/);
  const flags = [...sync[0].matchAll(/--exclude='([^']+)'/g)].map(m => `--exclude=${m[1]}`);
test('Ring 0 promotion and rollback preserve new PES and application state', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ring0-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'target');
  const mutable = ['pes-core/pes-data/bublik.db', 'pes-core/pes-data/bublik.db-wal',
    'pes-core/pes-data/bublik.db-shm', 'pes-core/pes-data/bublik.state.json',
    'pes-core/pes-data/users-registry.json', 'pes-core/pes-data/files/photo/new.jpg',
    'data/runtime.json', 'uploads/new.txt', '.env', '.mcp.json'];
  const put = (base, name, value) => {
    const file = path.join(base, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { mode: 0o600 });
  };
  for (const [index, version] of ['candidate', 'rollback'].entries()) {
    const artifact = path.join(root, version);
    for (const file of mutable) {
      put(target, file, `new-data-${index}`);
      put(artifact, file, 'stale-data-from-git');
    }
    put(target, 'pes-core/pes-data/target-only.json', 'new-child');
    put(artifact, 'pes-core/pes-data/source-only.json', 'must-not-seed');
    put(artifact, 'backend/server.js', version);
    put(artifact, 'pes-core/core/pes.js', version);
    put(artifact, 'dist/index.html', version);
    execFileSync('rsync', ['-a', ...flags, `${artifact}/`, `${target}/`]);
    for (const file of mutable) {
      assert.equal(fs.readFileSync(path.join(target, file), 'utf8'), `new-data-${index}`, file);
      assert.equal(fs.statSync(path.join(target, file)).mode & 0o777, 0o600, file);
    }
    assert.equal(fs.readFileSync(path.join(target, 'pes-core/pes-data/target-only.json'), 'utf8'), 'new-child');
    assert.equal(fs.existsSync(path.join(target, 'pes-core/pes-data/source-only.json')), false);
    for (const file of ['backend/server.js', 'pes-core/core/pes.js', 'dist/index.html']) {
      assert.equal(fs.readFileSync(path.join(target, file), 'utf8'), version, file);
    }
  }
});
}
