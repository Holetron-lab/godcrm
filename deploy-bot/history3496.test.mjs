// @vitest-environment node
import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('history3496 transport, runner and installation security checks', () => {
  const output = execFileSync('/usr/bin/node', ['--test', ...['history3496.checks.cjs', 'history3496-runner.checks.cjs'].map(f => fileURLToPath(new URL(f, import.meta.url)))], {
    env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 30000,
  });
  expect(output).toContain('# fail 0');
}, 35000);
