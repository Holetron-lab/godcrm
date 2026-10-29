// Mandatory adapter for node:test suites, including real container isolation.
// Both npm test and test:baseline collect this wrapper. Docker/image failures
// are failures, not skips. The ops runner tests committed HEAD, so commit first.
import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suites = [
  'deploy-bot/mcp-preservation.test.cjs',
  'scripts/public-router.test.cjs',
  'scripts/ops-runner/isolation.test.cjs',
  'scripts/staging-browser/inspection.test.mjs',
];

it('required Node suites pass inside the ops-runner container', () => {
  const result = spawnSync('python3', [
    'scripts/ops-runner.py', '--repo', root, 'node-test', ...suites,
  ], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 940_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  // Keep the runner's SHA, artifact path and TAP assertions in the gate log.
  console.log(result.stdout || '');
  if (result.stderr) console.error(result.stderr);
  expect(result.error, result.error?.message).toBeUndefined();
  expect(result.signal, 'ops-runner terminated by signal').toBeNull();
  expect(result.status, 'required Node/container suites failed; see runner log').toBe(0);
}, 950_000);
