/**
 * BDD routes — thin re-export wrapper.
 * All logic has been refactored into ./bdd/ submodules (tests, acceptance,
 * specs, enrollments, transitions, escalation, events).
 *
 * This file preserves backward compatibility for server.js (`import bddRoutesV3
 * from './routes/v3/bdd.js'`), scripts/snapshots/smoke-c4-verify.mjs (which
 * imports the default router and walks its stack), and the migration script
 * scripts/encrypt-totp-secrets.js (which may import the named helpers).
 */

// Default export: the Express router
export { default } from './bdd/index.js';

// Named exports (backward compatibility with original line 616)
export { encryptSecret, decryptSecret } from './bdd/index.js';
