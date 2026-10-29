// ADR-0009 §Phase 7 — deterministic test environment loader
//
// Problem this solves: vitest never loaded any env file, so a run inherited
// whatever the ambient shell exported. On .128 (Ring 0) the PM2 environment
// exports POSTGRES_DB=godcrm_prod + BUSINESS_CRM_IS_PROD=1 into every child
// process — including every agent shell — so the boot guard aborted and the
// only way to a green run was rsyncing the tree to .72. On a clean shell
// (cron, CI, a fresh ssh) the opposite happened: no POSTGRES_* at all, so the
// DB-backed suites failed for reasons unrelated to the change under test.
//
// Contract: after this module is imported, the process environment describes a
// test contour and nothing else, on every box, regardless of the caller.
//
// Load order (later wins):
//   1. process.env      — ambient (may be production; treated as untrusted)
//   2. .env             — box-local secrets only, and only if not already set
//   3. TEST_CONTOUR     — ./contour.js, committed, HARD override
//
// BUSINESS_CRM_IS_PROD is deliberately NOT overridden here: it is a statement
// about the *host*, and on .128 it is true. The guard in ./setup.js decides
// what to do with that fact — see the header there.
//
// Wiring: imported at the top of ./setup.js, which is already the first entry
// of vitest `setupFiles`, playwright `globalSetup` and the smoke scripts — so
// every existing runner picks this up with no further change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { TEST_CONTOUR } from './contour.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

// The only variable the box-local .env is allowed to contribute. Everything
// else in it is production wiring and must not leak into a test run — in
// particular the real SECRETS_MASTER_KEY, which would let a suite decrypt the
// vault rows that came along with the copy of the master. Crypto material for
// tests is the throwaway kind pinned in ./contour.js.
const SECRET_KEYS = ['POSTGRES_PASSWORD'];

/**
 * Where to look for the box-local .env.
 *
 * `.env` is git-ignored, so an ADR-0181-A worktree never has one — and without
 * POSTGRES_PASSWORD the DB-backed suites fail there for a reason that has
 * nothing to do with the change under test. A worktree's `.git` is a file
 * pointing at `<main repo>/.git/worktrees/<name>`, which is enough to find the
 * main checkout and borrow its .env.
 */
function envCandidates() {
  const candidates = [path.join(ROOT, '.env')];

  try {
    const dotGit = path.join(ROOT, '.git');
    if (fs.statSync(dotGit).isFile()) {
      const gitdir = fs.readFileSync(dotGit, 'utf8').replace(/^gitdir:\s*/, '').trim();
      const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
      const idx = gitdir.indexOf(marker);
      if (idx > 0) candidates.push(path.join(gitdir.slice(0, idx), '.env'));
    }
  } catch {
    // not a worktree, or .git unreadable — the local candidate is all we have
  }

  return candidates;
}

let loaded = false;

export function loadTestEnv() {
  if (loaded) return process.env;
  loaded = true;

  const envPath = envCandidates().find((p) => fs.existsSync(p));
  if (envPath) {
    let parsed = {};
    try {
      parsed = dotenv.parse(fs.readFileSync(envPath));
    } catch {
      parsed = {}; // unreadable .env is not fatal — the contour still applies
    }
    for (const key of SECRET_KEYS) {
      if (parsed[key] !== undefined && process.env[key] === undefined) {
        process.env[key] = parsed[key];
      }
    }
  }

  // POSTGRES_URL carries a database name and wins over POSTGRES_DB in
  // backend/database/connection.js. A test run must be described by the
  // discrete POSTGRES_* variables only, so drop any inherited URL.
  delete process.env.POSTGRES_URL;

  for (const [key, value] of Object.entries(TEST_CONTOUR)) {
    process.env[key] = value; // hard override — this is the point of the file
  }

  return process.env;
}

loadTestEnv();

export default loadTestEnv;
