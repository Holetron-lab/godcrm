// ADR-0009 §Phase 5 — Test Isolation Boot Guard
// ADR-0009 §Phase 6 — Hardening (2026-04-28): localhost exception removed
//
// Single source of truth. Automated tests MUST NEVER connect to PROD DB.
//
// Refuse to run when:
//   - POSTGRES_HOST is a known PROD host marker
//     (<LEGACY_IP>, crm.hltrn.cc)
//   - POSTGRES_DB === 'godcrm_prod' — REGARDLESS of host. Tests MUST
//     point at a separate DB (e.g. `godcrm_test`). Reason: on the PROD
//     server, `localhost` resolves to the PROD DB. The previous
//     localhost exception silently let tests through and contaminated
//     PROD on 2026-04-27.
//   - BUSINESS_CRM_IS_PROD=1 (env marker set in PROD .env). Second
//     layer in case the DB name is ever renamed.
//
// Exits with code 2 so runners / CI pipelines detect this as a hard abort
// rather than a normal test failure.
//
// Usage:
//   - Auto-invokes on import (side effect below).
//   - Also exports `assertSafeTestDb` for explicit calls.
//
// Wiring:
//   - vitest.config.ts  → setupFiles: [..., './backend/test/setup.js']
//   - playwright.config.ts → globalSetup: './backend/test/setup.js'
//   - scripts/smoke-*.mjs → `import '../backend/test/setup.js';` at top

const PROD_HOSTS = ['<LEGACY_IP>', 'crm.hltrn.cc'];
const FORBIDDEN_DBS = ['godcrm_prod'];

export function assertSafeTestDb() {
  const host = process.env.POSTGRES_HOST || '';
  const db = process.env.POSTGRES_DB || '';
  const isProdMarker = process.env.BUSINESS_CRM_IS_PROD === '1';

  if (isProdMarker) {
    // eslint-disable-next-line no-console
    console.error(
      'REFUSING TO RUN TESTS: BUSINESS_CRM_IS_PROD=1 (this host is marked production)'
    );
    process.exit(2);
  }

  if (PROD_HOSTS.includes(host)) {
    // eslint-disable-next-line no-console
    console.error(
      `REFUSING TO RUN TESTS AGAINST PROD DB: POSTGRES_HOST=${host}`
    );
    process.exit(2);
  }

  if (FORBIDDEN_DBS.includes(db)) {
    // eslint-disable-next-line no-console
    console.error(
      `REFUSING TO RUN TESTS AGAINST PROD DB: POSTGRES_DB=${db}. ` +
        'Tests must use a separate DB (e.g. godcrm_test). ' +
        'See ADR-0009 §Phase 6.'
    );
    process.exit(2);
  }
}

// Playwright globalSetup contract: export a default async function.
// Safe to keep alongside the auto-invoke below — calling twice is a no-op.
export default async function globalSetup() {
  assertSafeTestDb();
}

// Auto-invoke on import so `import './backend/test/setup.js'` is enough.
assertSafeTestDb();
