// Runs scripts/strip-test-scripts.test.mjs (ADR-0010 §B) under vitest.
//
// That file is a deliberately framework-free plain-Node script: it asserts with
// node:assert, prints PASS lines and exits 1 on failure. It also matches
// vitest's `*.test.mjs` glob, so vitest collected it, found no describe/it and
// reported "No test suite found in file …" — one permanent red entry for a
// script that was in fact passing.
//
// Excluding it from the glob alone would have dropped it out of `npm test`
// entirely. Instead the script keeps its zero-dependency shape and this wrapper
// gives the runner something to collect: spawn it, assert the exit code.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(here, '../strip-test-scripts.test.mjs');

describe('ADR-0010 §B — strip-test-scripts regex cases', () => {
  it('the standalone node script passes all cases (exit 0)', () => {
    let output;
    expect(() => {
      output = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    }).not.toThrow();
    expect(output).toContain('OK: all ADR-0010 §B cases pass');
    expect(output).not.toContain('FAIL:');
  });
});
