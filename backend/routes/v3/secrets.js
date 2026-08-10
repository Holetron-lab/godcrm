/**
 * Owner Secrets Vault API — ADR-0040 Phase 1.
 *
 * Owner-only CRUD over the `_secrets` registry, plus an audited reveal
 * endpoint for the Settings → Secrets UI (P2).
 *
 * Wraps `services/secrets/SecretsVault.js` so PG NOTIFY-driven cache eviction
 * stays consistent with service-to-service callers.
 *
 * Mount in server.js:
 *   app.use('/api/v3/secrets', authenticate, secretsRouter);
 *
 * Authorization model (mirrors ADR-0040 Tier 1):
 *   - JWT-authenticated (parent mount).
 *   - Owner-only: `req.user.id === space(11).owner_id`. Admin role is NOT
 *     enough — only the literal Development space owner can read/write
 *     vault entries. Rejects with 403 otherwise.
 *
 * Audit: every state-changing action AND every reveal writes a row into
 * the existing `audit_log` table. The `details` payload NEVER carries
 * plaintext — only the key and an optional description.
 */

import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import secretsVault from '../../services/secrets/SecretsVault.js';
import { apiLogger } from '../../utils/logger.js';
import {
  success,
  created,
  error,
  badRequest,
  notFound,
  forbidden,
  conflict,
} from '../../utils/response.js';

const log = apiLogger.child({ module: 'secrets_api' });

const OWNER_SPACE_ID = 11; // Development — owner of this space owns the vault.
const SECRETS_TABLE = '_secrets';

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────

async function requireOwner(req, res) {
  if (!req.user?.id) {
    forbidden(res, 'Authentication required');
    return false;
  }
  const space = await dbGet('SELECT id, owner_id FROM spaces WHERE id = ?', [OWNER_SPACE_ID]);
  if (!space) {
    // Should never happen on a real deployment — but if space 11 vanishes,
    // fail closed rather than silently elevating.
    error(res, 'OWNER_SPACE_MISSING', `Space ${OWNER_SPACE_ID} not found`, 500);
    return false;
  }
  if (space.owner_id !== req.user.id) {
    forbidden(res, 'Owner-only endpoint');
    return false;
  }
  return true;
}

async function auditSecret({ userId, action, key, extra, req }) {
  try {
    const details = JSON.stringify({ key, ...(extra || {}) });
    await dbRun(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        action,
        'secret',
        key,
        details,
        req?.ip || null,
        req?.get?.('user-agent') || null,
      ]
    );
  } catch (err) {
    // Audit failures must not break the user-facing request — but log loudly.
    log.warn({ err, action, key }, 'audit_log insert failed (non-blocking)');
  }
}

function scrubRow(row) {
  if (!row) return row;
  // Defensive: drop encrypted_payload no matter what.
  // eslint-disable-next-line no-unused-vars
  const { encrypted_payload, ...rest } = row;
  return rest;
}

function validateKey(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'key must be a string' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: 'key cannot be empty' };
  if (trimmed.length > 128) return { ok: false, error: 'key cannot exceed 128 chars' };
  // Conservative charset — letters, digits, underscore, dash, dot. Mirrors
  // typical env-var conventions so seed migration (P3) maps 1:1.
  if (!/^[A-Za-z0-9_\-.]+$/.test(trimmed)) {
    return { ok: false, error: 'key may contain only [A-Za-z0-9_-.]' };
  }
  return { ok: true, value: trimmed };
}

// ─── Reveal rate limiter ────────────────────────────────────────────
//
// 30 reveals/hour/user (ticket AC2). Per-user key so a compromised owner
// session can't be hidden by spreading reveals across IPs.
const revealLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) =>
    req.user?.id != null ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req, res)}`,
  message: {
    success: false,
    error: {
      code: 'REVEAL_RATE_LIMITED',
      message: 'Too many secret reveals — wait an hour.',
    },
  },
});

// ─── Routes ─────────────────────────────────────────────────────────

// GET /api/v3/secrets — list (no plaintext)
router.get('/', async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const rows = await dbAll(
    `SELECT id, key, description, created_by, created_at, updated_at,
            last_revealed_at, last_revealed_by
       FROM ${SECRETS_TABLE}
       ORDER BY key ASC`
  );
  return success(res, { secrets: rows.map(scrubRow) });
});

// POST /api/v3/secrets — create (409 on conflict)
router.post('/', async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const { key, plaintext, description } = req.body || {};

  const keyCheck = validateKey(key);
  if (!keyCheck.ok) return badRequest(res, keyCheck.error);
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return badRequest(res, 'plaintext must be a non-empty string');
  }
  if (description != null && typeof description !== 'string') {
    return badRequest(res, 'description must be a string when provided');
  }

  const existing = await dbGet(
    `SELECT id FROM ${SECRETS_TABLE} WHERE key = ? LIMIT 1`,
    [keyCheck.value]
  );
  if (existing) {
    return conflict(res, `Secret "${keyCheck.value}" already exists — use PUT to update`);
  }

  try {
    await secretsVault.putSecret(keyCheck.value, plaintext, {
      actor: req.user.id,
      description: description ?? null,
    });
  } catch (err) {
    log.error({ err, key: keyCheck.value }, 'putSecret failed (create)');
    if (err?.code === 'VAULT_NOT_CONFIGURED') {
      return error(res, 'VAULT_NOT_CONFIGURED', err.message, 503);
    }
    return error(res, 'PUT_SECRET_FAILED', err?.message || 'unknown', 500);
  }

  await auditSecret({
    userId: req.user.id,
    action: 'secret.create',
    key: keyCheck.value,
    extra: { description: description ?? null },
    req,
  });

  const row = await dbGet(
    `SELECT id, key, description, created_by, created_at, updated_at,
            last_revealed_at, last_revealed_by
       FROM ${SECRETS_TABLE} WHERE key = ?`,
    [keyCheck.value]
  );
  return created(res, { secret: scrubRow(row) });
});

// PUT /api/v3/secrets/:key — partial update (plaintext and/or description)
router.put('/:key', async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const keyCheck = validateKey(req.params.key);
  if (!keyCheck.ok) return badRequest(res, keyCheck.error);

  const { plaintext, description } = req.body || {};
  const hasPlain = plaintext != null;
  const hasDesc = description !== undefined;

  if (!hasPlain && !hasDesc) {
    return badRequest(res, 'At least one of {plaintext, description} required');
  }
  if (hasPlain && (typeof plaintext !== 'string' || plaintext.length === 0)) {
    return badRequest(res, 'plaintext must be a non-empty string');
  }
  if (hasDesc && description !== null && typeof description !== 'string') {
    return badRequest(res, 'description must be a string or null');
  }

  const existing = await dbGet(
    `SELECT id, description FROM ${SECRETS_TABLE} WHERE key = ? LIMIT 1`,
    [keyCheck.value]
  );
  if (!existing) return notFound(res, 'Secret');

  try {
    if (hasPlain) {
      // putSecret upserts encrypted_payload + bumps updated_at and fires NOTIFY.
      // description: pass through if provided this call, else preserve existing.
      await secretsVault.putSecret(keyCheck.value, plaintext, {
        actor: req.user.id,
        description: hasDesc ? description : existing.description,
      });
    } else {
      // Description-only update — no NOTIFY needed (cache value unchanged).
      await dbRun(
        `UPDATE ${SECRETS_TABLE}
            SET description = ?, updated_at = NOW()
          WHERE key = ?`,
        [description, keyCheck.value]
      );
    }
  } catch (err) {
    log.error({ err, key: keyCheck.value }, 'putSecret failed (update)');
    if (err?.code === 'VAULT_NOT_CONFIGURED') {
      return error(res, 'VAULT_NOT_CONFIGURED', err.message, 503);
    }
    return error(res, 'PUT_SECRET_FAILED', err?.message || 'unknown', 500);
  }

  await auditSecret({
    userId: req.user.id,
    action: 'secret.update',
    key: keyCheck.value,
    extra: {
      changed: [hasPlain ? 'plaintext' : null, hasDesc ? 'description' : null].filter(Boolean),
    },
    req,
  });

  const row = await dbGet(
    `SELECT id, key, description, created_by, created_at, updated_at,
            last_revealed_at, last_revealed_by
       FROM ${SECRETS_TABLE} WHERE key = ?`,
    [keyCheck.value]
  );
  return success(res, { secret: scrubRow(row) });
});

// POST /api/v3/secrets/:key/reveal — owner-only, rate-limited, audited.
router.post('/:key/reveal', revealLimiter, async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const keyCheck = validateKey(req.params.key);
  if (!keyCheck.ok) return badRequest(res, keyCheck.error);

  let plaintext;
  try {
    plaintext = await secretsVault.revealSecret(keyCheck.value, { actor: req.user.id });
  } catch (err) {
    log.error({ err, key: keyCheck.value }, 'revealSecret failed');
    if (err?.code === 'VAULT_NOT_CONFIGURED') {
      return error(res, 'VAULT_NOT_CONFIGURED', err.message, 503);
    }
    return error(res, 'REVEAL_FAILED', err?.message || 'unknown', 500);
  }
  if (plaintext == null) return notFound(res, 'Secret');

  // Audit row — entity_id=key, action=secret.reveal, NO plaintext in details.
  await auditSecret({
    userId: req.user.id,
    action: 'secret.reveal',
    key: keyCheck.value,
    extra: null,
    req,
  });

  return success(res, { key: keyCheck.value, plaintext });
});

// DELETE /api/v3/secrets/:key — hard delete + audit row.
router.delete('/:key', async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const keyCheck = validateKey(req.params.key);
  if (!keyCheck.ok) return badRequest(res, keyCheck.error);

  const existing = await dbGet(
    `SELECT id, description FROM ${SECRETS_TABLE} WHERE key = ? LIMIT 1`,
    [keyCheck.value]
  );
  if (!existing) return notFound(res, 'Secret');

  try {
    await secretsVault.deleteSecret(keyCheck.value, { actor: req.user.id });
  } catch (err) {
    log.error({ err, key: keyCheck.value }, 'deleteSecret failed');
    return error(res, 'DELETE_FAILED', err?.message || 'unknown', 500);
  }

  await auditSecret({
    userId: req.user.id,
    action: 'secret.delete',
    key: keyCheck.value,
    extra: { description: existing.description ?? null },
    req,
  });

  return success(res, { key: keyCheck.value, deleted: true });
});

export default router;
// Exposed for tests: lets the rate-limit suite reset the per-user window
// between cases (`revealLimiter.resetKey(\`u:${userId}\`)`).
export { revealLimiter };
