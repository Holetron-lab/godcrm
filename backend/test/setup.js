// ADR-0009 §Phase 5 — Test Isolation Boot Guard
// ADR-0009 §Phase 6 — Hardening (2026-04-28): localhost exception removed
// ADR-0009 §Phase 7 — Allowlist + prod-host rule (2026-09-06)
//
// Single source of truth. Automated tests MUST NEVER connect to a combat DB.
//
// Phase 7 changes two things and is strictly stricter than Phase 6 on the
// case Phase 6 was written to defend against:
//
//   1. The forbidden-DB *blocklist* became an allowlist. Phase 6 refused the
//      literal name `godcrm_prod`; anything else passed, so the very scenario
//      its comment worried about — "in case the DB name is ever renamed" —
//      would have sailed through. Phase 7 refuses every database whose name
//      does not end in `_test`. Renaming a master now fails closed.
//
//   2. BUSINESS_CRM_IS_PROD=1 is no longer an unconditional abort. It marks
//      the *host*, and on .128 (Ring 0, the agent home) it is permanently
//      true — which meant no agent could ever run vitest where the code
//      lives, and every run had to be rsynced to .72 first. A production host
//      may now run tests, but only against a `*_test` database reached over
//      loopback, and it says so loudly on every run. Reaching off-box from a
//      production host is still refused outright.
//
// Environment determinism is a separate concern and is handled by ./env.js,
// imported first below: it pins POSTGRES_DB/HOST and friends from
// ./contour.js so this guard sees the intended contour rather than whatever
// PM2 exported into the agent's shell.
//
// Exits with code 2 so runners / CI pipelines detect this as a hard abort
// rather than a normal test failure.
//
// Usage:
//   - Auto-invokes on import (side effect below).
//   - Also exports `assertSafeTestDb` for explicit calls.
//
// Wiring:
//   - vitest.config.ts  → setupFiles: ['./backend/test/setup.js', ...]
//   - playwright.config.ts → globalSetup: './backend/test/setup.js'
//   - scripts/smoke-*.mjs → `import '../backend/test/setup.js';` at top

import './env.js';

// Hosts that front a combat master. <LEGACY_IP> is the decommissioned
// v3.0 PROD box, kept so an old .env resurrecting it still fails closed.
const COMBAT_HOSTS = [
  '<LEGACY_IP>',
  'crm.hltrn.cc',
  'app.godcrm.ai',
  '<RING1_IP>' // Ring 1 GA (NL), master B
];

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', ''];

// A test run may only touch a database whose name ends here. Fails closed on
// anything else, including a renamed master.
const TEST_DB_SUFFIX = '_test';

function refuse(message) {
  // eslint-disable-next-line no-console
  console.error(`REFUSING TO RUN TESTS: ${message}`);
  process.exit(2);
}

export function assertSafeTestDb() {
  const host = process.env.POSTGRES_HOST || '';
  const db = process.env.POSTGRES_DB || '';
  const isProdHost = process.env.BUSINESS_CRM_IS_PROD === '1';

  if (COMBAT_HOSTS.includes(host)) {
    refuse(`POSTGRES_HOST=${host} fronts a combat master.`);
  }

  if (!db.endsWith(TEST_DB_SUFFIX)) {
    refuse(
      `POSTGRES_DB=${db || '(unset)'} is not a test database. Tests may only ` +
        `run against a database whose name ends in "${TEST_DB_SUFFIX}" ` +
        '(e.g. godcrm_test). See ADR-0009 §Phase 7.'
    );
  }

  // The guard only ever inspected POSTGRES_*. Two suites
  // (backend/__tests__/{api-keys,ai-tools}/*-postgres.test.js) built their own
  // pg Pool from a second, undocumented naming — DB_HOST / DB_NAME / DB_USER /
  // DB_PASSWORD — and defaulted DB_NAME to `godcrm_prod` with a literal
  // password. They failed only because that password was wrong; with the right
  // one in the environment they would have opened a connection straight to the
  // combat master, and this guard would not have seen it. Both suites now read
  // POSTGRES_*, and the alias is refused here so a third one cannot reintroduce
  // the bypass.
  const aliasHost = process.env.DB_HOST || '';
  const aliasDb = process.env.DB_NAME || '';
  if (COMBAT_HOSTS.includes(aliasHost)) {
    refuse(`DB_HOST=${aliasHost} fronts a combat master. Use POSTGRES_* — see ADR-0009 §Phase 7.`);
  }
  if (aliasDb && !aliasDb.endsWith(TEST_DB_SUFFIX)) {
    refuse(
      `DB_NAME=${aliasDb} is not a test database. This alias bypasses the ` +
        'POSTGRES_* contour; point the suite at POSTGRES_* instead. ADR-0009 §Phase 7.'
    );
  }

  if (isProdHost && !LOOPBACK_HOSTS.includes(host)) {
    refuse(
      `BUSINESS_CRM_IS_PROD=1 and POSTGRES_HOST=${host}. A production host may ` +
        'only run tests against a local test database, never a remote one.'
    );
  }

  if (isProdHost) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ADR-0009] Running tests on a PRODUCTION host (BUSINESS_CRM_IS_PROD=1) ' +
        `against ${host || 'localhost'}/${db}. Permitted, but the combat master ` +
        'lives on this same cluster — never point a suite at it.'
    );
  }
}

// Playwright globalSetup contract: export a default async function.
// Safe to keep alongside the auto-invoke below — calling twice is a no-op.
export default async function globalSetup() {
  assertSafeTestDb();
}

// Auto-invoke on import so `import './backend/test/setup.js'` is enough.
assertSafeTestDb();
