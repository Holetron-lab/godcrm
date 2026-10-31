import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve('scripts/ops-runner/kimi-crm.test.mjs');

it('CRM launcher node:test suite passes', () => {
  const result = spawnSync(process.execPath, ['--test', script], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  expect(result.error, result.error?.message).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(0);
});
