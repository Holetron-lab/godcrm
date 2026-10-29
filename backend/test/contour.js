// ADR-0009 §Phase 7 — the committed test contour. NO SECRETS IN THIS FILE.
//
// This is deliberately a .js module and not a `.env.test` file: rsync-based
// deploys (`make dev`) exclude `.env*`, so a dotfile would silently fail to
// reach .72 and the run there would fall back to the ambient environment —
// exactly the failure mode this is meant to close.
//
// Applied with hard override precedence by ./env.js, so a test run lands on
// the same contour on .128, .72 and CI no matter what the ambient shell
// exports. The only values a run takes from the box-local .env are the ones
// listed in SECRET_KEYS in ./env.js (POSTGRES_PASSWORD and friends).
//
// Every box that runs tests needs a local `godcrm_test` database:
//   .72   — created/refreshed by `make sync-db`
//   .128  — local copy, refreshed by `make sync-db-local`
//
// Do not put a real key here. If a suite needs one, read it through
// getSecret() and let it fall back, or stub it inside the suite.

export const TEST_CONTOUR = {
  NODE_ENV: 'test',
  TEST_MODE: 'true',

  // Host/NPC fail-closed wiring must not change the fleet-default tests.
  // Permission suites explicitly set '1' to exercise fail-closed paths.
  AGENT_PERMS_FAIL_CLOSED: '0',

  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5432',
  POSTGRES_DB: 'godcrm_test',
  POSTGRES_USER: 'godcrm',

  // Deterministic throwaway crypto material — test-only, valid nowhere.
  JWT_SECRET: 'test-secret-for-vitest',
  MASTER_ENCRYPTION_KEY: 'test-master-key-32-characters!!',

  // SECRETS_MASTER_KEY is deliberately absent. The vault suites mint their own
  // 32-byte key when it is unset (getSecret.test.js:20, SecretsVault.test.js:29)
  // and one of them asserts the missing-key boot path; pinning a value here
  // broke 31 of their cases. Absent is also the safer default — env.js does not
  // forward the box's real key, so a suite can never decrypt the vault rows
  // that rode along with the copy of the master.

  // Public origin for SEO output (sitemap/robots/canonical). blogSeo.js and
  // publicDocsSeo.js read this at module load and fall back to
  // 'https://app.godcrm.ai'. Unpinned, the suite inherited the box's .env —
  // .128 sets https://godcrm.ai — so renderSitemap emitted the index on one
  // host and the posts on another, and blogSeo.test.js failed on .128 while
  // passing anywhere without that variable. Pin the compiled default.
  PUBLIC_SITE_ORIGIN: 'https://app.godcrm.ai',

  // Suppress the dev-user bootstrap some services run on first connect.
  SKIP_DEV_USER: 'true'
};

export default TEST_CONTOUR;
