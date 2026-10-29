#!/usr/bin/env node
/**
 * One-shot: seed Bluesky usher (handle + app-password) into `_secrets` vault.
 * ADR-0040 P3. Idempotent — refuses to clobber existing rows (rotation goes
 * through the Settings UI). Reads creds from argv to keep them out of git.
 *
 *   node backend/scripts/seed-bluesky-secrets.mjs <handle> <app-password>
 *
 * Exit: 0 ok / 2 vault not configured / 1 write failed.
 */
import dotenv from 'dotenv';
dotenv.config();

import vault from '../services/secrets/SecretsVault.js';
import { getAdapter as getDbAdapter } from '../database/connection.js';

const [handle, appPassword] = process.argv.slice(2);
const ACTOR = 1; // space-11 owner

const ENTRIES = [
  {
    key: 'bluesky_handle',
    value: handle,
    description: '[social] Bluesky handle (AT Protocol amplifier graph — Austin recon usher)',
  },
  {
    key: 'bluesky_app_password',
    value: appPassword,
    description: '[social] Bluesky app-password (revocable; AT Protocol auth — Austin recon usher)',
  },
];

async function main() {
  if (!handle || !appPassword) {
    console.error('usage: seed-bluesky-secrets.mjs <handle> <app-password>');
    process.exit(1);
  }
  if (!process.env.SECRETS_MASTER_KEY) {
    console.error('❌ SECRETS_MASTER_KEY not set — refusing to seed.');
    process.exit(2);
  }

  const adapter = await getDbAdapter();
  await vault.init({ adapter, allowEnvFallback: false });

  let failed = 0;
  for (const e of ENTRIES) {
    const existing = await adapter.query(
      `SELECT id FROM _secrets WHERE key = $1 AND space_id = 11 LIMIT 1`,
      [e.key]
    );
    if (existing.rowCount > 0) {
      console.log(`[SKIP] ${e.key.padEnd(24)} — already in vault (rotate via Settings UI)`);
      continue;
    }
    try {
      await vault.putSecret(e.key, e.value, { actor: ACTOR, description: e.description });
      console.log(`[SEED] ${e.key.padEnd(24)} ← (${e.value.length} chars)`);
    } catch (err) {
      console.log(`[FAIL] ${e.key.padEnd(24)} — ${err.message}`);
      failed++;
    }
  }

  // Read-back proof (decrypt round-trip) without printing the secret.
  for (const e of ENTRIES) {
    const got = await vault.getSecret(e.key);
    const ok = got != null;
    console.log(`[VERIFY] ${e.key.padEnd(24)} → ${ok ? 'decrypt OK (' + got.length + ' chars)' : 'MISSING'}`);
    if (!ok) failed++;
  }

  await vault.shutdown();
  if (adapter && typeof adapter.close === 'function') {
    try { await adapter.close(); } catch { /* ignore */ }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('seed-bluesky-secrets: fatal:', err);
  process.exit(1);
});
