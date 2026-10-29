/**
 * Owner Secrets Vault API — ADR-0040 Phase 1.
 *
 * Space owner/admin CRUD over the `_secrets` registry, plus an audited reveal
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
 *   - Space owner OR space admin for the requested space_id. "Admin" is the
 *     caller's role IN THE SPACE (access_control users table via
 *     checkUserAccessViaTableV2) — the global users.role is never consulted.
 *   - space_id is required on every request; missing scope fails closed.
 *
 * Audit: every state-changing action AND every reveal writes a row into
 * the existing `audit_log` table. The `details` payload NEVER carries
 * plaintext — only the key and an optional description.
 */

import express from 'express';
import { z } from 'zod';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { dbGet, dbAll, dbRun, safeJsonParse } from '../../database/connection.js';
import { checkUserAccessViaTableV2 } from '../../services/space/access.js';
import secretsVault from '../../services/secrets/SecretsVault.js';
import { validateKey } from '../../services/secrets/secretsSystemTable.js';
import { ensureSecretsSystemTableForSpace } from '../../services/SystemTablesCreator.js';
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

const spaceIdSchema = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().positive().max(2147483647));
const SECRETS_TABLE = '_secrets';

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────

/** Space-level role of the caller: 'owner' | 'admin' | other | null. */
async function spaceRoleOf(userId, space) {
  if (space.owner_id === userId) return 'owner';
  const accessControl = safeJsonParse(space.access_control, null);
  if (!accessControl?.enabled || !accessControl.users_table_id) return null;
  const { accessLevel } = await checkUserAccessViaTableV2(userId, accessControl);
  return accessLevel;
}

async function requireSpaceAdmin(req, res) {
  if (!req.user?.id) {
    forbidden(res, 'Authentication required');
    return false;
  }
  const parsed = spaceIdSchema.safeParse(req.query.space_id);
  if (!parsed.success) {
    badRequest(res, 'space_id must be a positive integer');
    return false;
  }
  const space = await dbGet('SELECT id, owner_id, access_control FROM spaces WHERE id = ?', [parsed.data]);
  if (!space) {
    notFound(res, 'Space');
    return false;
  }
  const role = await spaceRoleOf(req.user.id, space);
  if (role !== 'owner' && role !== 'admin') {
    forbidden(res, 'Space owner or admin only');
    return false;
  }
  req.secretSpaceId = parsed.data;
  return true;
}

async function auditSecret({ userId, action, key, extra, req }) {
  try {
    const details = JSON.stringify({ key, space_id: req.secretSpaceId, ...(extra || {}) });
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
  if (!(await requireSpaceAdmin(req, res))) return;
  // ADR-0040 §space-secrets — the space's `Secrets` system table (lazy, like Mail).
  const tableId = await ensureSecretsSystemTableForSpace(req.secretSpaceId);
  const rows = await dbAll(
    `SELECT id, key, description, created_by, created_at, updated_at,
            last_revealed_at, last_revealed_by
       FROM ${SECRETS_TABLE}
       WHERE space_id = ?
       ORDER BY key ASC`,
    [req.secretSpaceId]
  );
  return success(res, { secrets: rows.map(scrubRow), table_id: tableId });
});

// POST /api/v3/secrets — create (409 on conflict)
router.post('/', async (req, res) => {
  if (!(await requireSpaceAdmin(req, res))) return;
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
    `SELECT id FROM ${SECRETS_TABLE} WHERE key = ? AND space_id = ? LIMIT 1`,
    [keyCheck.value, req.secretSpaceId]
  );
  if (existing) {
    return conflict(res, `Secret "${keyCheck.value}" already exists — use PUT to update`);
  }

  try {
    await ensureSecretsSystemTableForSpace(req.secretSpaceId);
    await secretsVault.putSecret(keyCheck.value, plaintext, {
      actor: req.user.id,
      spaceId: req.secretSpaceId,
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
       FROM ${SECRETS_TABLE} WHERE key = ? AND space_id = ?`,
    [keyCheck.value, req.secretSpaceId]
  );
  return created(res, { secret: scrubRow(row) });
});

// PUT /api/v3/secrets/:key — partial update (plaintext and/or description)
router.put('/:key', async (req, res) => {
  if (!(await requireSpaceAdmin(req, res))) return;
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
    `SELECT id, description FROM ${SECRETS_TABLE} WHERE key = ? AND space_id = ? LIMIT 1`,
    [keyCheck.value, req.secretSpaceId]
  );
  if (!existing) return notFound(res, 'Secret');

  try {
    if (hasPlain) {
      // putSecret upserts encrypted_payload + bumps updated_at and fires NOTIFY.
      // description: pass through if provided this call, else preserve existing.
      await secretsVault.putSecret(keyCheck.value, plaintext, {
        actor: req.user.id,
        spaceId: req.secretSpaceId,
        description: hasDesc ? description : existing.description,
      });
    } else {
      // Description-only update — no NOTIFY needed (cache value unchanged).
      await dbRun(
        `UPDATE ${SECRETS_TABLE}
            SET description = ?, updated_at = NOW()
          WHERE key = ? AND space_id = ?`,
        [description, keyCheck.value, req.secretSpaceId]
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
       FROM ${SECRETS_TABLE} WHERE key = ? AND space_id = ?`,
    [keyCheck.value, req.secretSpaceId]
  );
  return success(res, { secret: scrubRow(row) });
});

// POST /api/v3/secrets/:key/reveal — space owner/admin, rate-limited, audited.
router.post('/:key/reveal', revealLimiter, async (req, res) => {
  if (!(await requireSpaceAdmin(req, res))) return;
  const keyCheck = validateKey(req.params.key);
  if (!keyCheck.ok) return badRequest(res, keyCheck.error);

  let plaintext;
  try {
    plaintext = await secretsVault.revealSecret(keyCheck.value, { actor: req.user.id, spaceId: req.secretSpaceId });
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
  if (!(await requireSpaceAdmin(req, res))) return;
  const keyCheck = validateKey(req.params.key);
  if (!keyCheck.ok) return badRequest(res, keyCheck.error);

  const existing = await dbGet(
    `SELECT id, description FROM ${SECRETS_TABLE} WHERE key = ? AND space_id = ? LIMIT 1`,
    [keyCheck.value, req.secretSpaceId]
  );
  if (!existing) return notFound(res, 'Secret');

  try {
    await secretsVault.deleteSecret(keyCheck.value, { actor: req.user.id, spaceId: req.secretSpaceId });
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
