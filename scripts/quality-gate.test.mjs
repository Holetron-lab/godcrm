// Run with: npx vitest run scripts/quality-gate.test.mjs
// Execute the real gate with isolated step stubs; no build, network or DB access.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

for (let failures = 0; failures < 32; failures += 1) {
  test(`gate reports all steps with failure mask ${failures.toString(2).padStart(5, '0')}`, () => {
    // The fixture holds an executable npx stub. os.tmpdir() is mounted noexec in
    // the ops-runner container, so it lives in the checkout (git-ignored) instead.
    const fixture = mkdtempSync(join(here, '..', '.quality-gate-test-'));
    try {
      const scripts = join(fixture, 'scripts');
      const bin = join(fixture, 'bin');
      mkdirSync(scripts);
      mkdirSync(bin);
      copyFileSync(join(here, 'quality-gate.sh'), join(scripts, 'quality-gate.sh'));
      writeFileSync(join(scripts, 'check-file-lines.sh'), `#!/usr/bin/env bash
printf 'lines\\n' >> "$GATE_TEST_TRACE"
exit "$((GATE_TEST_FAILURES & 1))"
`);
      writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash
case "$1" in
  tsc) bit=2 ;;
  vitest) bit=8 ;;
  vite) bit=16 ;;
  *) exit 99 ;;
esac
printf '%s\\n' "$1" >> "$GATE_TEST_TRACE"
exit "$(( (GATE_TEST_FAILURES & bit) != 0 ))"
`, { mode: 0o755 });
      writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash
printf 'translations\\n' >> "$GATE_TEST_TRACE"
exit "$(( (GATE_TEST_FAILURES & 4) != 0 ))"
`, { mode: 0o755 });
      const trace = join(fixture, 'trace');
      const result = spawnSync('bash', [join(scripts, 'quality-gate.sh')], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          GATE_TEST_TRACE: trace,
          GATE_TEST_FAILURES: String(failures),
        },
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      assert.equal(result.status, failures === 0 ? 0 : 1, result.stdout + result.stderr);
      assert.deepEqual(readFileSync(trace, 'utf8').trim().split('\n'), ['lines', 'tsc', 'translations', 'vitest', 'vite']);
      const failed = [1, 2, 4, 8, 16].filter(bit => failures & bit).length;
      assert.ok(result.stdout.includes(`Total: 5  |  Passed: ${5 - failed}  |  Failed: ${failed}`));
      const rows = result.stdout.split('\n').filter(line => /^ {2}(PASS|FAIL) {2}/.test(line));
      assert.equal(rows.length, 5);
      rows.forEach((row, index) => {
        assert.ok(row.startsWith(failures & (1 << index) ? '  FAIL  ' : '  PASS  '));
      });
      assert.ok(result.stdout.includes(failures ? 'QUALITY GATE FAILED' : 'QUALITY GATE PASSED'));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
