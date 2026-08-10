/**
 * Shared helpers for BDD routes (ADR-156, ADR-0003 §C-4).
 *
 * Extracted from the original monolithic routes/v3/bdd.js. All helpers here are
 * used by two or more submodules (tests, specs, enrollments, transitions,
 * escalation, events). Per-submodule helpers live alongside their handlers.
 */

import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { dbGet, dbRun, sqlNow } from '../../../database/connection.js';
import { generateBaseId } from '../../../utils/baseId.js';
import { apiLogger } from '../../../utils/logger.js';

// ADR-0003 §C-4: TOTP attempt limiter at HTTP layer (3 per minute per IP).
// Complements the per-criterion `failed_attempts` lockout (5 attempts → 1h).
export const totpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'TOTP_RATE_LIMITED', message: 'Too many TOTP attempts. Wait 60s.' },
    timestamp: new Date().toISOString(),
  },
});

// Space where BDD tables live (see scripts/bootstrap-bdd-tables.js)
export const BDD_SPACE_ID = 11;

// In-memory cache of logical-table name -> table_id (populated on first use)
const tableIdCache = new Map();

/**
 * Resolve logical BDD table id by name, within space 11.
 * Returns null if the table has not been bootstrapped yet.
 */
export async function getBddTableId(name) {
  if (tableIdCache.has(name)) return tableIdCache.get(name);
  const row = await dbGet(`
    SELECT ut.id
    FROM universal_tables ut
    JOIN projects p ON ut.project_id = p.id
    WHERE p.space_id = ? AND ut.name = ?
    ORDER BY ut.id ASC
    LIMIT 1
  `, [BDD_SPACE_ID, name]);
  if (row?.id) {
    tableIdCache.set(name, row.id);
    return row.id;
  }
  return null;
}

const BDD_CRITERIA_TABLE_CACHE = { id: null };
export async function criteriaTableId() {
  if (BDD_CRITERIA_TABLE_CACHE.id) return BDD_CRITERIA_TABLE_CACHE.id;
  const id = await getBddTableId('bdd_criteria');
  BDD_CRITERIA_TABLE_CACHE.id = id;
  return id;
}

// ADR-0003 §C-4 — append-only audit log for TOTP-signed ownership acts
// and state transitions. Table is created by scripts/bootstrap-bdd-tables.js.
const BDD_AUDIT_TABLE_CACHE = { id: null };
export async function auditLogTableId() {
  if (BDD_AUDIT_TABLE_CACHE.id) return BDD_AUDIT_TABLE_CACHE.id;
  const id = await getBddTableId('bdd_audit_log');
  BDD_AUDIT_TABLE_CACHE.id = id;
  return id;
}

export async function writeAuditLog(entry) {
  try {
    const tid = await auditLogTableId();
    if (!tid) {
      apiLogger.warn({ entry }, 'bdd_audit_log missing — run scripts/bootstrap-bdd-tables.js');
      return;
    }
    const row = {
      criterion_id: entry.criterion_id ?? null,
      spec_id:      entry.spec_id ?? null,
      doc_id:       entry.doc_id ?? null,
      action:       entry.action,
      from_status:  entry.from_status ?? null,
      to_status:    entry.to_status ?? null,
      user_id:      entry.user_id ?? null,
      actor_kind:   entry.actor_kind || 'user',
      totp_hash:    entry.totp_hash ?? null,
      reason:       entry.reason ?? null,
      caused_by:    entry.caused_by ?? null,
      ip:           entry.ip ?? null,
      ts:           new Date().toISOString(),
    };
    await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES (?, ?, ?::jsonb, ${sqlNow()}, ${sqlNow()})`,
      [tid, generateBaseId(), JSON.stringify(row)]
    );
  } catch (e) {
    apiLogger.error({ err: e.message, entry }, 'writeAuditLog failed (non-fatal)');
  }
}

// ADR-0003 §C-4: totp_hash = sha256(code + server_salt). Server_salt comes from
// env BDD_AUDIT_SALT (fallback derives from SESSION_SECRET so the value is
// stable across restarts but never equal to the raw TOTP).
export function hashTotpCode(code) {
  if (!code) return null;
  const salt = process.env.BDD_AUDIT_SALT
    || process.env.SESSION_SECRET
    || 'godcrm-bdd-audit-default-salt';
  return crypto.createHash('sha256').update(`${code}|${salt}`).digest('hex');
}

/* =========================================================================
 * ADR-156 iter-5 Task 1 — TOTP encrypt-at-rest (AES-256-GCM)
 *
 * Key comes from BDD_TOTP_KEY (32 raw bytes, base64-encoded). Storage format
 * on bdd_criteria.data.totp.secret_enc is: "<iv_b64>:<ct_b64>:<tag_b64>".
 *
 * During the transition window, enroll-confirm writes BOTH secret_enc (new)
 * and active_secret (legacy plaintext). The one-shot migration script
 * scripts/encrypt-totp-secrets.js back-fills secret_enc on rows that only
 * have active_secret, and drops the plaintext. verifyCriterionTotp() reads
 * secret_enc first and falls back to active_secret only when secret_enc is
 * absent (transition safety).
 * ========================================================================= */

function getTotpKey() {
  const b64 = process.env.BDD_TOTP_KEY;
  if (!b64) throw new Error('BDD_TOTP_KEY env var is required (32-byte base64)');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('BDD_TOTP_KEY must decode to exactly 32 bytes');
  return key;
}

export function encryptSecret(plaintext) {
  const key = getTotpKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

export function decryptSecret(enc) {
  if (typeof enc !== 'string') throw new Error('secret_enc must be string');
  const parts = enc.split(':');
  if (parts.length !== 3) throw new Error('secret_enc malformed (expected iv:ct:tag)');
  const [ivB64, ctB64, tagB64] = parts;
  const key = getTotpKey();
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Return the base32 TOTP secret for verification — prefers encrypted
 * secret_enc, falls back to plaintext active_secret during migration window.
 * Returns null if neither is present (not enrolled).
 */
export function resolveActiveSecret(totp) {
  if (!totp || typeof totp !== 'object') return null;
  if (totp.secret_enc) {
    try { return decryptSecret(totp.secret_enc); }
    catch (e) {
      apiLogger.warn({ err: e.message }, 'BDD TOTP: secret_enc decrypt failed');
      // fall through to plaintext fallback
    }
  }
  if (totp.active_secret) return totp.active_secret;
  return null;
}

/**
 * Update a single logical row's JSONB data with a shallow merge.
 */
export async function patchLogicalRow(tableId, rowId, patch) {
  await dbRun(`
    UPDATE table_rows
    SET data = COALESCE(data,'{}'::jsonb) || ?::jsonb,
        updated_at = ${sqlNow()}
    WHERE table_id = ? AND id = ?
  `, [JSON.stringify(patch), tableId, rowId]);
}

/**
 * Emit a pg_notify with JSON payload.
 */
export async function pgNotify(channel, payloadObj) {
  await dbRun(
    `SELECT pg_notify(?, ?)`,
    [channel, JSON.stringify(payloadObj)]
  );
}

/**
 * Fetch the logical row for `bdd_criteria.id` by the CRM row id.
 * Returns { id, base_id, data } with data parsed to object, or null.
 */
export async function getCriterionRow(rowId) {
  const tid = await criteriaTableId();
  if (!tid) return null;
  const row = await dbGet(
    `SELECT id, base_id, data FROM table_rows WHERE table_id = ? AND id = ?`,
    [tid, rowId]
  );
  if (!row) return null;
  row.data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  return row;
}
