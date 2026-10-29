#!/usr/bin/env node
/**
 * ADR-0040 / Constitution v4.0 §10 (invariant 5) — rotate SECRETS_MASTER_KEY.
 *
 * The KZ fork inherited .128's master key byte-for-byte (shared key =
 * invariant-5 violation). Re-key = decrypt every `_secrets` row under the OLD
 * key, re-encrypt under a NEW key, atomically UPDATE in one transaction.
 *
 * A naive key-swap would NOT work: seed-secrets-from-env.js is idempotent-skip
 * (never overwrites existing rows), so rows would stay encrypted under the OLD
 * key and silently fail to decrypt at runtime — while verify-secrets-migration.js
 * (existence-only) still prints [OK]. This script closes that gap and self-checks
 * decryptability, which verify cannot.
 *
 * Modes:
 *   (default)   DRY-RUN: decrypt(OLD)+roundtrip(NEW) every row, no writes.
 *   --commit    Same validation, then atomic UPDATE of all rows under NEW key.
 *   --probe     Decrypt every row using process.env.SECRETS_MASTER_KEY ONLY,
 *               report pass/fail. Run AFTER the .env flip to prove the new key
 *               decrypts the whole vault. (Ignores NEW_SECRETS_MASTER_KEY.)
 *
 * Keys:
 *   OLD = process.env.SECRETS_MASTER_KEY        (from .env)
 *   NEW = process.env.NEW_SECRETS_MASTER_KEY    (passed inline for the run)
 *   Accepts 64-hex or 32-byte-base64, matching SecretsVault.decodeMasterKey.
 *
 * Exit: 0 ok · 1 failure (nothing committed) · 2 bad/missing key args.
 */
import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import { getAdapter, withTransactionAsync } from '../database/connection.js';

const KEY_VERSION = 1, IV_BYTES = 12, KEY_BYTES = 32, TABLE = '_secrets';

function decodeKey(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t, 'hex');
  if (/^[A-Za-z0-9+/]+=*$/.test(t)) {
    try { const b = Buffer.from(t, 'base64'); if (b.length === KEY_BYTES) return b; } catch { /* */ }
  }
  return null;
}
function dec(key, blob) {
  const o = typeof blob === 'string' ? JSON.parse(blob) : blob;
  if (!o || o.v !== KEY_VERSION) throw new Error(`unsupported payload v=${o?.v}`);
  const iv = Buffer.from(o.iv, 'base64'), tag = Buffer.from(o.tag, 'base64'), ct = Buffer.from(o.ct, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
function encrypt(key, plain) {
  const iv = crypto.randomBytes(IV_BYTES);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { v: KEY_VERSION, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

async function main() {
  const COMMIT = process.argv.includes('--commit');
  const PROBE = process.argv.includes('--probe');
  const adapter = await getAdapter();
  const rows = (await adapter.query(`SELECT id, key, encrypted_payload FROM ${TABLE} ORDER BY key`)).rows;

  if (PROBE) {
    const key = decodeKey(process.env.SECRETS_MASTER_KEY);
    if (!key) { console.error('SECRETS_MASTER_KEY missing/invalid'); process.exit(2); }
    let ok = 0, bad = 0;
    for (const r of rows) {
      try { const p = dec(key, r.encrypted_payload); console.log(`[decrypt-ok] ${r.key} (len=${p.length})`); ok++; }
      catch (e) { console.error(`[DECRYPT-FAIL] ${r.key}: ${e.message}`); bad++; }
    }
    console.log(`\nprobe: ${ok}/${rows.length} decrypt OK, ${bad} failed`);
    process.exit(bad > 0 ? 1 : 0);
  }

  const oldKey = decodeKey(process.env.SECRETS_MASTER_KEY);
  const newKey = decodeKey(process.env.NEW_SECRETS_MASTER_KEY);
  if (!oldKey) { console.error('OLD SECRETS_MASTER_KEY missing/invalid'); process.exit(2); }
  if (!newKey) { console.error('NEW_SECRETS_MASTER_KEY missing/invalid (pass inline)'); process.exit(2); }
  if (oldKey.equals(newKey)) { console.error('NEW == OLD — refusing (that is the whole point).'); process.exit(2); }

  console.log(`rows=${rows.length}  mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
  const reenc = [];
  for (const r of rows) {
    let plain;
    try { plain = dec(oldKey, r.encrypted_payload); }
    catch (e) { console.error(`[ABORT] decrypt(OLD) failed for ${r.key}: ${e.message} — no writes made`); process.exit(1); }
    const blob = encrypt(newKey, plain);
    if (dec(newKey, blob) !== plain) { console.error(`[ABORT] roundtrip(NEW) mismatch for ${r.key}`); process.exit(1); }
    reenc.push({ id: r.id, key: r.key, blob });
    console.log(`[ok] ${r.key} — decrypt(OLD)+reencrypt(NEW) verified`);
  }

  if (!COMMIT) {
    console.log('\nDRY-RUN ok: every row decrypts under OLD and roundtrips under NEW. Re-run with --commit.');
    process.exit(0);
  }

  await withTransactionAsync(async (trx) => {
    for (const x of reenc) {
      const res = await trx.query(
        `UPDATE ${TABLE} SET encrypted_payload = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(x.blob), x.id]
      );
      if (res.rowCount !== 1) throw new Error(`UPDATE touched ${res.rowCount} rows for ${x.key}`);
    }
  });
  console.log(`\n[COMMITTED] ${reenc.length} rows re-encrypted under NEW key (atomic).`);
  console.log('Next: flip SECRETS_MASTER_KEY in .env → NEW, then pm2 restart godcrm, then run with --probe.');
  process.exit(0);
}

main().catch((e) => { console.error('rotate-secrets-master-key: fatal:', e); process.exit(1); });
