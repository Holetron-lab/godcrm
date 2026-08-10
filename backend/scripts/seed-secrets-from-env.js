#!/usr/bin/env node
/**
 * ADR-0040 P3 — Seed `_secrets` from current `process.env` values.
 *
 * Idempotent one-shot: for each Tier-1 entry in `services/secrets/registry.js`
 * — if `process.env[ENV]` is set AND the vault has no row yet for `vaultKey`
 * — encrypt + insert. Skips when vault already holds the key (never
 * overwrites an existing row; rotation goes through the Settings UI).
 *
 * Run during deploy on PROD/.205 + .72:
 *
 *   $ node backend/scripts/seed-secrets-from-env.js
 *   $ node backend/scripts/seed-secrets-from-env.js --actor=1
 *   $ node backend/scripts/seed-secrets-from-env.js --dry-run
 *
 * Exit codes:
 *   0 — all reachable keys seeded (or already present)
 *   2 — vault not configured (SECRETS_MASTER_KEY missing) — refused
 *   1 — at least one putSecret failed
 */

import dotenv from 'dotenv';
dotenv.config();

import vault from '../services/secrets/SecretsVault.js';
import { TIER_1_SECRETS } from '../services/secrets/registry.js';
import { getAdapter as getDbAdapter } from '../database/connection.js';

const ACTOR_FLAG = process.argv.find((a) => a.startsWith('--actor='));
const DEFAULT_ACTOR = ACTOR_FLAG ? Number(ACTOR_FLAG.split('=')[1]) : 1; // space 11 owner
const DRY_RUN = process.argv.includes('--dry-run');

function pickEnv(envFallback) {
  const names = Array.isArray(envFallback) ? envFallback : [envFallback];
  for (const n of names) if (process.env[n]) return { name: n, value: process.env[n] };
  return null;
}

async function main() {
  if (!process.env.SECRETS_MASTER_KEY) {
    console.error('❌ SECRETS_MASTER_KEY not set — refusing to seed.');
    console.error('   Generate one with: openssl rand -base64 32');
    console.error('   Then set it in .env on this host and re-run.');
    process.exit(2);
  }

  const adapter = await getDbAdapter();
  await vault.init({ adapter, allowEnvFallback: false });

  const report = { seeded: [], skipped: [], missing: [], failed: [] };

  for (const entry of TIER_1_SECRETS) {
    const env = pickEnv(entry.envFallback);
    if (!env) {
      report.missing.push(entry.vaultKey);
      continue;
    }

    // Idempotency check via direct adapter query (avoids decrypting just to
    // know existence + sidesteps cache).
    const existing = await adapter.query(
      `SELECT id FROM _secrets WHERE key = $1 LIMIT 1`,
      [entry.vaultKey]
    );
    if (existing.rowCount > 0) {
      report.skipped.push({ key: entry.vaultKey, reason: 'already in vault' });
      continue;
    }

    if (DRY_RUN) {
      report.seeded.push({ key: entry.vaultKey, env: env.name, dryRun: true });
      continue;
    }

    try {
      await vault.putSecret(entry.vaultKey, env.value, {
        actor: DEFAULT_ACTOR,
        description: `[${entry.category}] ${entry.description}`,
      });
      report.seeded.push({ key: entry.vaultKey, env: env.name });
    } catch (err) {
      report.failed.push({ key: entry.vaultKey, error: err.message });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────
  console.log('');
  console.log(`ADR-0040 seed report  (host: ${process.env.HOSTNAME || 'unknown'}, dryRun=${DRY_RUN})`);
  console.log('─────────────────────────────────────────────────────────────');
  for (const s of report.seeded) {
    const tag = s.dryRun ? '[DRY]' : '[SEED]';
    console.log(`${tag} ${s.key.padEnd(32)} ← process.env.${s.env}`);
  }
  for (const s of report.skipped) {
    console.log(`[SKIP] ${s.key.padEnd(32)} — ${s.reason}`);
  }
  for (const s of report.missing) {
    console.log(`[GAP ] ${s.padEnd(32)} — env not set on this host`);
  }
  for (const s of report.failed) {
    console.log(`[FAIL] ${s.key.padEnd(32)} — ${s.error}`);
  }
  console.log('─────────────────────────────────────────────────────────────');
  console.log(
    `seeded=${report.seeded.length}  ` +
    `skipped=${report.skipped.length}  ` +
    `missing=${report.missing.length}  ` +
    `failed=${report.failed.length}`
  );

  await vault.shutdown();
  if (adapter && typeof adapter.close === 'function') {
    try { await adapter.close(); } catch { /* ignore */ }
  }

  process.exit(report.failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('seed-secrets-from-env: fatal:', err);
  process.exit(1);
});
