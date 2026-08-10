#!/usr/bin/env node
/**
 * ADR-0040 P3 — Verify vault completeness pre-D14 cutover.
 *
 * For every Tier-1 entry in `services/secrets/registry.js`, print one of:
 *
 *   [OK ] vault_key                — present in vault (env still set: yes|no)
 *   [GAP] vault_key                — env set but NOT in vault → BLOCKER
 *   [---] vault_key                — neither vault nor env (deferred / N/A)
 *
 * Exit codes:
 *   0 — no GAPs (safe to remove env-fallback on D15)
 *   1 — at least one GAP found
 *   2 — SECRETS_MASTER_KEY missing (cannot read vault)
 *
 * Usage:
 *   $ node backend/scripts/verify-secrets-migration.js
 *   $ node backend/scripts/verify-secrets-migration.js --json
 */

import dotenv from 'dotenv';
dotenv.config();

import vault from '../services/secrets/SecretsVault.js';
import { TIER_1_SECRETS } from '../services/secrets/registry.js';
import { getAdapter as getDbAdapter } from '../database/connection.js';

const JSON_OUT = process.argv.includes('--json');

function envValue(envFallback) {
  const names = Array.isArray(envFallback) ? envFallback : [envFallback];
  for (const n of names) if (process.env[n]) return { name: n, set: true };
  return { name: Array.isArray(envFallback) ? envFallback[0] : envFallback, set: false };
}

async function main() {
  if (!process.env.SECRETS_MASTER_KEY) {
    console.error('❌ SECRETS_MASTER_KEY not set — cannot read vault.');
    process.exit(2);
  }

  const adapter = await getDbAdapter();
  await vault.init({ adapter, allowEnvFallback: false });

  const rows = [];
  let gapCount = 0;

  for (const entry of TIER_1_SECRETS) {
    const env = envValue(entry.envFallback);
    const inVault = await adapter.query(
      `SELECT id FROM _secrets WHERE key = $1 LIMIT 1`,
      [entry.vaultKey]
    );
    const vaultHas = inVault.rowCount > 0;

    let status;
    if (vaultHas) {
      status = 'OK';
    } else if (env.set) {
      status = 'GAP';
      gapCount += 1;
    } else {
      status = 'N/A';
    }

    rows.push({
      status,
      vaultKey: entry.vaultKey,
      envName: env.name,
      envSet: env.set,
      vaultHas,
      category: entry.category,
    });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ gapCount, rows }, null, 2));
  } else {
    console.log('');
    console.log(`ADR-0040 verify report  (host: ${process.env.HOSTNAME || 'unknown'})`);
    console.log('─────────────────────────────────────────────────────────────');
    for (const r of rows) {
      const tag =
        r.status === 'OK'  ? '[OK ]' :
        r.status === 'GAP' ? '[GAP]' : '[---]';
      const envHint = r.envSet ? `env=${r.envName} (still set)` : `env=${r.envName} (unset)`;
      console.log(`${tag} ${r.vaultKey.padEnd(32)} ${envHint}`);
    }
    console.log('─────────────────────────────────────────────────────────────');
    const ok = rows.filter((r) => r.status === 'OK').length;
    const na = rows.filter((r) => r.status === 'N/A').length;
    console.log(`ok=${ok}  gap=${gapCount}  n/a=${na}`);
    if (gapCount > 0) {
      console.log('');
      console.log('⚠️  GAP rows mean: env is set but vault is empty for that key.');
      console.log('   Run `node backend/scripts/seed-secrets-from-env.js` to populate.');
      console.log('   Do NOT remove env-fallback (D15 cleanup) until this report is GAP-free.');
    }
  }

  await vault.shutdown();
  if (adapter && typeof adapter.close === 'function') {
    try { await adapter.close(); } catch { /* ignore */ }
  }
  process.exit(gapCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('verify-secrets-migration: fatal:', err);
  process.exit(1);
});
