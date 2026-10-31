import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('CRM launcher preserves arguments, hooks, exit status and existing Node options', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kimi-crm-test-'));
  try {
    const probe = join(dir, 'probe.cjs');
    writeFileSync(probe, `console.log(JSON.stringify({
      timeout: require('node:net').getDefaultAutoSelectFamilyAttemptTimeout(),
      options: process.env.NODE_OPTIONS,
      hook: process.env.AGENT_PERMS_FAIL_CLOSED,
      args: process.argv.slice(2)
    })); process.exit(23);`);
    const source = readFileSync(new URL('./kimi-crm.sh', import.meta.url), 'utf8');
    const execLine = 'exec /root/.local/bin/kimi "$@"';
    assert.equal(source.split(execLine).length, 2);
    const launcher = join(dir, 'launcher.sh');
    writeFileSync(launcher, source.replace(execLine, `exec '${process.execPath}' '${probe}' "$@"`));
    for (const managed of ['1', '0', '']) {
      for (const options of ['', '--no-warnings --network-family-autoselection-attempt-timeout=250']) {
        const args = ['-p', 'literal $(touch /invalid) `id` with spaces', '--output-format', 'stream-json'];
        const result = spawnSync('/bin/sh', [launcher, ...args], {
          encoding: 'utf8',
          env: { ...process.env, KIMI_CRM_MANAGED: managed, NODE_OPTIONS: options, AGENT_PERMS_FAIL_CLOSED: '1' },
        });
        assert.equal(result.status, 23, result.stderr);
        const actual = JSON.parse(result.stdout);
        assert.deepEqual(actual.args, args);
        assert.equal(actual.hook, '1');
        assert.equal(actual.timeout, managed === '1' ? 2000 : 250);
        assert.equal(actual.options, managed === '1'
          ? `${options ? `${options} ` : ''}--network-family-autoselection-attempt-timeout=2000`
          : options);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
