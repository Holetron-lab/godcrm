#!/usr/bin/env node
/**
 * ADR-156 iter-5 Task 1 — one-shot migration: encrypt plaintext TOTP secrets.
 *
 * Finds `bdd_criteria` rows where data.totp.active_secret exists AND
 * data.totp.secret_enc is absent, encrypts the secret with AES-256-GCM using
 * BDD_TOTP_KEY, writes back secret_enc, and strips plaintext active_secret.
 *
 * Idempotent: re-running against rows that already have secret_enc is a
 * no-op. Safe to run multiple times.
 *
 * Usage (from project root):
 *   source .env && node scripts/encrypt-totp-secrets.js
 *
 * Env:
 *   BDD_TOTP_KEY     required, 32-byte base64 AES key
 *   POSTGRES_*       standard CRM connection (host, user, db, password, port)
 *
 * Exit codes:
 *   0 — success (possibly 0 rows updated)
 *   1 — config/connection error
 *   2 — partial failure (see logs)
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';

const BDD_SPACE_ID = 11;

function getKey() {
  const b64 = process.env.BDD_TOTP_KEY;
  if (!b64) {
    console.error('FATAL: BDD_TOTP_KEY env var is required (32-byte base64)');
    process.exit(1);
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    console.error('FATAL: BDD_TOTP_KEY must decode to 32 bytes, got', key.length);
    process.exit(1);
  }
  return key;
}

function encryptSecret(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

async function main() {
  const key = getKey();

  const client = new pg.Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'godcrm_prod',
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD,
  });
  await client.connect();

  try {
    // Resolve bdd_criteria table id within space 11.
    const tRes = await client.query(`
      SELECT ut.id
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = $1 AND ut.name = $2
      ORDER BY ut.id ASC
      LIMIT 1
    `, [BDD_SPACE_ID, 'bdd_criteria']);
    if (tRes.rows.length === 0) {
      console.error('FATAL: bdd_criteria logical table not found in space', BDD_SPACE_ID);
      process.exit(1);
    }
    const tableId = tRes.rows[0].id;
    console.log(`[migration] bdd_criteria table_id = ${tableId}`);

    // Find rows with plaintext active_secret but no secret_enc.
    const rowsRes = await client.query(`
      SELECT id, data
      FROM table_rows
      WHERE table_id = $1
        AND data->'totp'->>'active_secret' IS NOT NULL
        AND (data->'totp'->>'secret_enc' IS NULL OR data->'totp'->>'secret_enc' = '')
    `, [tableId]);
    console.log(`[migration] candidate rows: ${rowsRes.rows.length}`);

    let ok = 0, fail = 0;
    for (const row of rowsRes.rows) {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
      const totp = data.totp || {};
      const plain = totp.active_secret;
      if (!plain) { console.log(`  row ${row.id}: no active_secret (skip)`); continue; }

      try {
        const enc = encryptSecret(plain, key);
        // Patch: add secret_enc, remove active_secret.
        const newTotp = { ...totp, secret_enc: enc };
        delete newTotp.active_secret;
        // Full replacement of totp key to strip plaintext.
        const patch = { totp: newTotp };
        await client.query(`
          UPDATE table_rows
          SET data = COALESCE(data,'{}'::jsonb) || $1::jsonb,
              updated_at = NOW()
          WHERE id = $2
        `, [JSON.stringify(patch), row.id]);
        console.log(`  row ${row.id}: migrated (enc=${enc.slice(0, 16)}...)`);
        ok++;
      } catch (e) {
        console.error(`  row ${row.id}: FAIL ${e.message}`);
        fail++;
      }
    }

    console.log(`[migration] done: ok=${ok} fail=${fail} total=${rowsRes.rows.length}`);
    if (fail > 0) process.exit(2);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});
