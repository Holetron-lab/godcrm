import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Execute the real deploy control flow with every external action stubbed.
// `no-restart` is the maintenance APPLY path (DEPLOY_NO_RESTART=1): sync and
// build happen, PM2 is never touched. Fixture inside the checkout: /tmp is noexec in the ops-runner.
for (const failure of ['local-build', 'sync', 'install', 'remote-build', 'restart', 'none', 'no-restart']) {
  test(`staging deploy: ${failure}`, () => {
    const dir = mkdtempSync(join(process.cwd(), '.deploy-failure-test-'));
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      mkdirSync(join(dir, 'scripts'));
      mkdirSync(join(dir, 'dist'));
      const log = join(dir, 'actions');
      writeFileSync(log, '');
      writeFileSync(join(dir, 'dist/index.html'), '<script src="/assets/index-test.js"></script>');
      writeFileSync(join(dir, 'scripts/deploy.local.env'), 'DEV_HOST=stub-host\n');
      writeFileSync(join(dir, 'scripts/check-file-lines.sh'), 'exit 0\n');
      for (const name of ['staging-sync.sh', 'staging-sync.exclude']) {
        writeFileSync(join(dir, 'scripts', name), readFileSync(join('scripts', name)));
      }
      const stub = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
      stub('git', 'case "$*" in *rev-parse*) echo "$FIXTURE_DIR" ;; *ls-tree*) printf "package.json\\0" ;; esac');
      stub('rsync', 'echo rsync >> "$ACTION_LOG"; if [ "$FAIL_ACTION" = sync ]; then exit 23; fi');
      stub('ssh', 'echo ssh >> "$ACTION_LOG"; shift; bash -c "$1"');
      stub('npm', `
action=local-build
if [ "$1" = --prefix ]; then
  shift 2
  if [ "$1" = install ]; then action=install; else action=remote-build; fi
fi
echo "$action" >> "$ACTION_LOG"
echo "stub npm output"
if [ "$FAIL_ACTION" = "$action" ]; then exit 23; fi`);
      stub('pm2', 'echo restart >> "$ACTION_LOG"; if [ "$FAIL_ACTION" = restart ]; then exit 24; fi');
      const source = readFileSync(join(process.cwd(), 'scripts/deploy.sh'), 'utf8');
      assert.ok(source.includes('PROJ="/root/production/business-crm"'));
      const script = join(dir, 'deploy.sh');
      writeFileSync(script, source.replace('PROJ="/root/production/business-crm"', `PROJ="${dir}"`));
      const result = spawnSync('bash', [script, 'dev'], {
        encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, ACTION_LOG: log, FAIL_ACTION: failure, FIXTURE_DIR: dir,
          ...(failure === 'no-restart' ? { DEPLOY_NO_RESTART: '1' } : {}) },
      });
      assert.ifError(result.error);
      const actions = readFileSync(log, 'utf8').trim().split('\n');
      const succeeds = ['none', 'no-restart'].includes(failure);
      assert.equal(result.status, succeeds ? 0 : failure === 'restart' ? 24 : 23, result.stderr);
      if (failure === 'local-build') assert.ok(!actions.includes('rsync'));
      if (failure === 'sync') assert.ok(!actions.includes('install'));
      if (failure === 'install') assert.ok(!actions.includes('remote-build'));
      if (failure === 'no-restart') assert.deepEqual(actions, ['local-build', 'rsync', 'ssh', 'install', 'remote-build', 'ssh']); // bundle readback, no pm2
      if (['local-build', 'sync', 'install', 'remote-build', 'no-restart'].includes(failure)) assert.ok(!actions.includes('restart'));
      else assert.equal(actions.filter(x => x === 'restart').length, 1);
      assert.equal(result.stdout.includes('[DEV] Done.'), succeeds);
      assert.equal(result.stdout.includes('restart skipped'), failure === 'no-restart');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
