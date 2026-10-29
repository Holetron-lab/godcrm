#!/usr/bin/env node
// test-baseline.mjs — "did I break anything?" instead of "is it green?"
//
// The suite is not green and has not been for a long time (216 failures across
// 45 files on main @ bba4c167, .128/godcrm_test). That turned every task into
// the same manual ritual: run the suite on a baseline copy of main somewhere,
// run it again on the change, diff the two by eye. This script makes that a
// committed artifact instead.
//
//   npm run test:baseline            compare this tree against tests/baseline-failures.json
//   npm run test:baseline -- --update   record the current failures as the baseline
//   npm run test:baseline -- backend/   pass anything else straight to vitest
//
// Exit codes: 0 = no test failing that was not already failing in the baseline;
// 1 = regressions (listed); 2 = the run itself could not be executed, or the
// worker count differs from the one the baseline was recorded at.
//
// The baseline is per-tree, not per-box: it is committed, so a worktree starts
// from main's recorded state and only has to justify its own delta.
//
// The baseline is also per-configuration (ADR-203-A1): on one shared
// godcrm_test the same SHA gives 0 failures at --maxWorkers=1 and 117 at 3, so
// a comparison only holds at the worker count the baseline was recorded with.
// The count is stamped as `workers` and a mismatch is refused before vitest
// starts. ponytail: no override flag and no detection of Vitest's own default —
// a mismatched run is simply not a gate, and "default" compares as its own value.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_CONTOUR } from '../backend/test/contour.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'tests', 'baseline-failures.json');

const argv = process.argv.slice(2);
const update = argv.includes('--update');
const vitestArgs = argv.filter((a) => a !== '--update');

// A path filter means vitest only ran part of the suite, so every baseline
// failure outside that part is simply absent from this report — not fixed.
// Regressions stay meaningful; the "now passing" list does not.
const filtered = vitestArgs.some((a) => !a.startsWith('-'));

/** Worker count this run asks vitest for: `--maxWorkers=N` / `--maxWorkers N`, else "default". */
const workersOf = (args) => {
  const i = args.findIndex((a) => a === '--maxWorkers' || a.startsWith('--maxWorkers='));
  if (i < 0) return 'default';
  const raw = args[i].includes('=') ? args[i].slice('--maxWorkers='.length) : args[i + 1];
  return /^\d+$/.test(raw ?? '') ? Number(raw) : 'default';
};
const workers = workersOf(vitestArgs);

if (update && filtered) {
  console.error(
    '[baseline] refusing to record a baseline from a filtered run — it would ' +
      'drop every failure outside the filter. Re-run without a path argument.'
  );
  process.exit(2);
}

if (!update && fs.existsSync(BASELINE)) {
  const recorded = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).workers;
  if (recorded !== undefined && String(recorded) !== String(workers)) {
    console.error(
      `[baseline] workers mismatch: baseline recorded at --maxWorkers=${recorded}, ` +
        `this run asks for ${workers}. A comparison only holds in the configuration ` +
        `the baseline was recorded in (ADR-203-A1) — re-run with --maxWorkers=${recorded}.`
    );
    process.exit(2);
  }
}

const reportPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-baseline-')),
  'report.json'
);

console.log(`[baseline] running vitest${vitestArgs.length ? ` (${vitestArgs.join(' ')})` : ''}…`);

const run = spawnSync(
  'npx',
  ['vitest', 'run', '--configLoader', 'runner', '--reporter=json', `--outputFile=${reportPath}`, ...vitestArgs],
  { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] }
);

if (run.error) {
  console.error(`[baseline] could not start vitest: ${run.error.message}`);
  process.exit(2);
}
if (!fs.existsSync(reportPath)) {
  // Guard aborts (exit 2) and config errors land here — no report was written.
  console.error('[baseline] vitest produced no report; see the output above.');
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

/** Stable id for one test, independent of run order and of absolute paths. */
const idOf = (file, fullName) => `${path.relative(ROOT, file)} :: ${fullName}`;

const failures = [];
for (const suite of report.testResults ?? []) {
  for (const assertion of suite.assertionResults ?? []) {
    if (assertion.status === 'failed') {
      failures.push(idOf(suite.name, assertion.fullName));
    }
  }
  // Import/setup failures may leave skipped assertions without a failed test.
  // Record the failed suite so the baseline cannot silently accept it.
  if (suite.status === 'failed' && !(suite.assertionResults ?? []).some(a => a.status === 'failed')) {
    failures.push(idOf(suite.name, '<file failed to load>'));
  }
}
failures.sort();

const commit = spawnSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], {
  encoding: 'utf8'
}).stdout?.trim();

if (update) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        note: 'Known-failing tests on main. Regenerate with: npm run test:baseline -- --update',
        recordedAt: new Date().toISOString(),
        commit,
        host: os.hostname(),
        // The contour, not the ambient environment. This process only spawns
        // vitest; backend/test/env.js pins POSTGRES_DB inside the CHILD, so
        // process.env here still carries whatever the box exports — on .128
        // that is `godcrm_prod`, and the baseline went out stamped with the
        // name of a combat master it had never touched. Read the same committed
        // contour the run actually used.
        database: TEST_CONTOUR.POSTGRES_DB,
        // The vitest worker count this recording ran at. Compare mode refuses
        // any other count (see the header) — the same SHA on a shared
        // godcrm_test fails differently at 1 and at 3 workers.
        workers,
        count: failures.length,
        failures
      },
      null,
      2
    )}\n`
  );
  console.log(`[baseline] recorded ${failures.length} known failures at ${commit} → ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(
    `[baseline] ${path.relative(ROOT, BASELINE)} does not exist. ` +
      'Record it on a clean checkout of main: npm run test:baseline -- --update'
  );
  process.exit(2);
}

const known = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).failures ?? []);
const regressions = failures.filter((f) => !known.has(f));
const fixed = [...known].filter((f) => !failures.includes(f));

console.log('');
console.log(`[baseline] failing now: ${failures.length}   known: ${known.size}`);

if (filtered) {
  console.log('[baseline] partial run — only regressions are meaningful here.');
} else if (fixed.length) {
  console.log(`[baseline] ${fixed.length} baseline failure(s) now pass:`);
  for (const f of fixed.slice(0, 20)) console.log(`  + ${f}`);
  if (fixed.length > 20) console.log(`  … and ${fixed.length - 20} more`);
  console.log('[baseline] re-record with --update once the change is merged.');
}

if (!regressions.length) {
  console.log('[baseline] no regressions.');
  process.exit(0);
}

console.error(`[baseline] ${regressions.length} REGRESSION(S) — failing here, passing in the baseline:`);
for (const f of regressions) console.error(`  - ${f}`);
process.exit(1);
