#!/usr/bin/env node
// =============================================================================
// strip-test-scripts.mjs — ADR-0010 §4.1 (deploy-strip)
// =============================================================================
// Purpose
//   Remove every entry from package.json `scripts.*` whose key matches the
//   test-script regex set defined in ADR-0010 §B. Add a top-level sentinel
//   `_test_scripts_stripped: true` so downstream tooling (deploy, canary) can
//   verify the strip ran. Idempotent: running twice is a no-op (the sentinel
//   is already present and there are no test keys left to remove).
//
// Usage
//   node scripts/strip-test-scripts.mjs <path-to-package.json>
//
// Exit codes
//   0  success (strip applied or already stripped)
//   1  argument / file / parse error
//
// Regex contract (verified by strip-test-scripts.test.mjs against ADR §B):
//   STRIP if key matches `/(^|:)test(:|$)/`  → covers `test`, `test:unit`,
//                                                `unit:test`, `e2e:test:headless`
//   STRIP if key matches `/^(pre|post)test$/` → covers `pretest`, `posttest`
//   STRIP if key matches `TEST_RUNNER_RE`     → closed-list third-party runners
//                                                (`vitest`, `vitest:run`, `jest`,
//                                                `cypress:run`, etc.)
//   KEEP everything else, including `attest`, `latest`, `attestation`,
//                                   `testbench-build`, `manifest:gen`,
//                                   `protest:rally`, `contest`, `gtest`,
//                                   `vitestrunner`, `jestify`, `lint`,
//                                   `build`, etc.
//
// Amendment 2026-04-28: closed-list runner allowlist (vitest, jest, playwright,
// mocha, cypress, ava, tap, tape, karma, jasmine). Adding a runner requires
// ADR-0010 amendment.
//
// Pure function `stripTestScripts(pkg)` is exported for unit testing without
// requiring a real file on disk.
// =============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEST_SCRIPT_RE = /(^|:)test(:|$)/;
export const TEST_PREFIX_RE = /^(pre|post)test$/;

// Closed-list third-party JS/TS test runner allowlist (ADR-0010 amendment
// 2026-04-28). Each runner matches as full namespace (`^name$`) or as a
// `name:*` sub-script. Adding a runner here requires an ADR-0010 amendment.
export const TEST_RUNNER_RE = /^(vitest|jest|playwright|mocha|cypress|ava|tap|tape|karma|jasmine)(:.*)?$/;

/**
 * Returns true if `key` is considered a test-script name and must be removed.
 * @param {string} key
 */
export function isTestScriptKey(key) {
  return TEST_SCRIPT_RE.test(key)
      || TEST_PREFIX_RE.test(key)
      || TEST_RUNNER_RE.test(key);
}

/**
 * Pure transform: returns a new pkg object with test-scripts removed and a
 * `_test_scripts_stripped: true` sentinel added at the top level.
 * Does not mutate input.
 * @param {object} pkg parsed package.json
 * @returns {object} new pkg object
 */
export function stripTestScripts(pkg) {
  const out = { ...pkg };
  if (out.scripts && typeof out.scripts === 'object') {
    const filtered = {};
    for (const [k, v] of Object.entries(out.scripts)) {
      if (!isTestScriptKey(k)) filtered[k] = v;
    }
    out.scripts = filtered;
  }
  out._test_scripts_stripped = true;
  return out;
}

/**
 * Reads `path`, applies stripTestScripts, writes back with 2-space indent +
 * trailing newline. Throws on read/parse/write failure.
 * @param {string} path
 */
export function stripFile(path) {
  const raw = readFileSync(path, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON at ${path}: ${e.message}`);
  }
  const stripped = stripTestScripts(pkg);
  writeFileSync(path, JSON.stringify(stripped, null, 2) + '\n', 'utf8');
}

// CLI entry — only run when invoked directly.
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/strip-test-scripts.mjs <path-to-package.json>');
    process.exit(1);
  }
  try {
    stripFile(target);
    console.log(`[strip-test-scripts] stripped ${target} (sentinel _test_scripts_stripped=true)`);
  } catch (e) {
    console.error(`[strip-test-scripts] FAILED: ${e.message}`);
    process.exit(1);
  }
}
