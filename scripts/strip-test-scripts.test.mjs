#!/usr/bin/env node
// =============================================================================
// strip-test-scripts.test.mjs — ADR-0010 §B regex verification
// =============================================================================
// Plain-Node unit test (no test framework dependency). Exercises every case
// from ADR-0010 doc 134298 §B "Strip regex test cases" plus extras from the
// ticket task spec. Run via:  node scripts/strip-test-scripts.test.mjs
//
// Exits 0 on full pass, 1 on any failure (last line is "FAIL: N case(s)").
// =============================================================================

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isTestScriptKey,
  stripTestScripts,
  stripFile,
} from './strip-test-scripts.mjs';

// ---------------------------------------------------------------------------
// Cases drawn 1:1 from ADR-0010 §B + ticket task spec.
// ---------------------------------------------------------------------------
const CASES = [
  // §B "Must strip"
  { key: 'test',                expectStrip: true,  source: 'ADR §B must-strip' },
  { key: 'test:unit',           expectStrip: true,  source: 'ADR §B must-strip' },
  { key: 'test:e2e',            expectStrip: true,  source: 'ADR §B must-strip' },
  { key: 'test:integration',    expectStrip: true,  source: 'ADR §B must-strip' },
  { key: 'pretest',             expectStrip: true,  source: 'ADR §B must-strip' },
  { key: 'posttest',            expectStrip: true,  source: 'ADR §B must-strip' },
  { key: 'playwright:test',     expectStrip: true,  source: 'ADR §B must-strip' },
  { key: 'vitest:run',          expectStrip: true,  source: 'ADR §B must-strip (allowlist amendment 2026-04-28)' },

  // §B "Must NOT strip"
  { key: 'lint',                expectStrip: false, source: 'ADR §B keep' },
  { key: 'build',               expectStrip: false, source: 'ADR §B keep' },
  { key: 'start',               expectStrip: false, source: 'ADR §B keep' },
  { key: 'dev',                 expectStrip: false, source: 'ADR §B keep' },
  { key: 'migrate',             expectStrip: false, source: 'ADR §B keep' },
  { key: 'attest',              expectStrip: false, source: 'ADR §B keep (substring "test" but not bounded)' },

  // Ticket spec extras (must strip)
  { key: 'unit:test',           expectStrip: true,  source: 'ticket spec — colon-prefixed test' },
  { key: 'e2e:test:headless',   expectStrip: true,  source: 'ticket spec — :test: middle segment' },

  // Ticket spec extras (keep — boundary check)
  { key: 'latest',              expectStrip: false, source: 'ticket spec — substring only' },
  { key: 'attestation',         expectStrip: false, source: 'ticket spec — substring only' },
  { key: 'testbench-build',     expectStrip: false, source: 'ticket spec — leading "test" but no `:` or `$` boundary' },

  // [NEW] ADR-0010 amendment 2026-04-28 — closed-list runner allowlist (must strip)
  { key: 'vitest',              expectStrip: true,  source: '[NEW] allowlist (amendment 2026-04-28)' },
  { key: 'jest',                expectStrip: true,  source: '[NEW] allowlist (amendment 2026-04-28)' },
  { key: 'jest:debug',          expectStrip: true,  source: '[NEW] allowlist (amendment 2026-04-28)' },
  { key: 'mocha:watch',         expectStrip: true,  source: '[NEW] allowlist (amendment 2026-04-28)' },
  { key: 'cypress:open',        expectStrip: true,  source: '[NEW] allowlist (amendment 2026-04-28)' },
  { key: 'cypress:run',         expectStrip: true,  source: '[NEW] allowlist (amendment 2026-04-28)' },
  { key: 'ava:debug',           expectStrip: true,  source: '[NEW] allowlist (amendment 2026-04-28)' },

  // [NEW] ADR-0010 amendment 2026-04-28 — false-positive locks (must keep)
  { key: 'manifest:gen',        expectStrip: false, source: '[NEW] lock: substring "test" before `:`, no boundary, not in allowlist' },
  { key: 'protest:rally',       expectStrip: false, source: '[NEW] lock: substring "test" before `:`, no boundary, not in allowlist' },
  { key: 'contest',             expectStrip: false, source: '[NEW] lock: substring "test", not bounded' },
  { key: 'gtest',               expectStrip: false, source: '[NEW] lock: substring "test", not bounded; not in allowlist' },
  { key: 'dotest',              expectStrip: false, source: '[NEW] lock: substring "test", not bounded; not in allowlist' },
  { key: 'attest:notarize',     expectStrip: false, source: '[NEW] lock: substring "test" before `:`, no boundary, not in allowlist' },
  { key: 'vitestrunner',        expectStrip: false, source: '[NEW] lock: starts with `vitest` but no `:` or `$` after — boundary required for allowlist match' },
  { key: 'jestify',             expectStrip: false, source: '[NEW] lock: starts with `jest` but no `:` or `$` after' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tableRow(c, actual, pass) {
  const verdict = pass ? 'PASS' : 'FAIL';
  const expected = c.expectStrip ? 'STRIP' : 'KEEP ';
  const got = actual ? 'STRIP' : 'KEEP ';
  return `${verdict} | ${c.key.padEnd(22)} | exp=${expected} | got=${got} | ${c.source}`;
}

// ---------------------------------------------------------------------------
// Test 1 — every §B case via isTestScriptKey
// ---------------------------------------------------------------------------
let failures = 0;
console.log('=== ADR-0010 §B regex verification ===');
console.log('VERD | key                    | expected | actual | source');
console.log('-----+------------------------+----------+--------+-------');
for (const c of CASES) {
  const actual = isTestScriptKey(c.key);
  const pass = actual === c.expectStrip;
  console.log(tableRow(c, actual, pass));
  if (!pass) failures += 1;
}

// ---------------------------------------------------------------------------
// Test 2 — full pkg transform: strips all test keys, keeps non-test keys,
// adds sentinel.
// ---------------------------------------------------------------------------
console.log('\n=== full pkg transform ===');
const pkgIn = {
  name: 'fixture',
  version: '0.0.0',
  scripts: Object.fromEntries(CASES.map(c => [c.key, `echo ${c.key}`])),
  dependencies: { foo: '^1.0.0' },
};
const pkgOut = stripTestScripts(pkgIn);

// Sentinel
assert.equal(pkgOut._test_scripts_stripped, true, 'sentinel must be true');
console.log('PASS | sentinel _test_scripts_stripped === true');

// Every expectStrip key must be gone
for (const c of CASES.filter(c => c.expectStrip)) {
  if (Object.prototype.hasOwnProperty.call(pkgOut.scripts, c.key)) {
    console.log(`FAIL | "${c.key}" should be stripped but survived`);
    failures += 1;
  }
}

// Every keep key must remain
for (const c of CASES.filter(c => !c.expectStrip)) {
  if (!Object.prototype.hasOwnProperty.call(pkgOut.scripts, c.key)) {
    console.log(`FAIL | "${c.key}" should be kept but was stripped`);
    failures += 1;
  }
}

// Original input not mutated
assert.equal(
  Object.keys(pkgIn.scripts).length,
  CASES.length,
  'input pkg.scripts must not be mutated'
);
assert.equal(
  pkgIn._test_scripts_stripped,
  undefined,
  'input pkg must not be mutated'
);
console.log('PASS | input pkg not mutated');

// Non-scripts keys preserved
assert.equal(pkgOut.name, 'fixture');
assert.equal(pkgOut.version, '0.0.0');
assert.deepEqual(pkgOut.dependencies, { foo: '^1.0.0' });
console.log('PASS | non-scripts top-level fields preserved');

// ---------------------------------------------------------------------------
// Test 3 — file round-trip + idempotence + indent + trailing newline
// ---------------------------------------------------------------------------
console.log('\n=== file round-trip + idempotence ===');
const dir = mkdtempSync(join(tmpdir(), 'strip-test-'));
const filePath = join(dir, 'package.json');
try {
  writeFileSync(filePath, JSON.stringify(pkgIn, null, 2) + '\n');
  stripFile(filePath);
  const after1 = readFileSync(filePath, 'utf8');
  const parsed1 = JSON.parse(after1);
  assert.equal(parsed1._test_scripts_stripped, true);
  assert.ok(after1.endsWith('\n'), 'file must end with trailing newline');
  // Indent check: a 2-space indented JSON has lines starting with `  "`.
  assert.ok(after1.includes('\n  "'), 'file must use 2-space indent');
  console.log('PASS | first strip writes sentinel + 2-space indent + trailing \\n');

  // Idempotence: a second strip produces identical bytes.
  stripFile(filePath);
  const after2 = readFileSync(filePath, 'utf8');
  assert.equal(after1, after2, 'second strip must be a no-op (byte-identical)');
  console.log('PASS | second invocation is byte-identical (idempotent)');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 4 — error cases: missing file, invalid JSON
// ---------------------------------------------------------------------------
console.log('\n=== error handling ===');
let threw = false;
try { stripFile('/nonexistent/path/package.json'); } catch { threw = true; }
assert.ok(threw, 'missing file must throw');
console.log('PASS | missing file throws');

const dir2 = mkdtempSync(join(tmpdir(), 'strip-test-bad-'));
const badPath = join(dir2, 'package.json');
try {
  writeFileSync(badPath, '{ this is not json');
  threw = false;
  try { stripFile(badPath); } catch { threw = true; }
  assert.ok(threw, 'invalid JSON must throw');
  console.log('PASS | invalid JSON throws');
} finally {
  rmSync(dir2, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Final verdict
// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.log(`FAIL: ${failures} case(s)`);
  process.exit(1);
}
console.log('OK: all ADR-0010 §B cases pass');
