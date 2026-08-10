/**
 * ADR-0002 §8 Phase 4 — Ticket seal (TOTP-act).
 *
 *   POST /api/v3/tickets/:id/seal     body: { totp_code, notes? }
 *   POST /api/v3/tickets/:id/unseal   body: { totp_code, reason }
 *
 * The seal is a separate TOTP-signed act, distinct from criterion-level
 * verification (ADR-0011 / ADR-0003). Per §8.5 A4.x:
 *
 *   A4.1 — Tickets gains sealed_at + sealed_by + seal_proof (migration 051).
 *   A4.2 — `ticket_seal_verification` table mirrors criterion_verification:
 *          one append-only audit row per seal/un-seal event.
 *   A4.3 — sealing requires (i) all Must criteria verified (Phase 3 gate),
 *          (ii) human user click + TOTP, (iii) atomic insert + update in one
 *          DB transaction. Partial seal is impossible.
 *   A4.4 — un-seal clears Tickets.sealed_* and appends an audit row with
 *          action='broken'. Reason is required.
 *
 * TOTP source: per-user `users.totp_secret` (same pool used by ADR-0011
 * verification column) — speakeasy with window=1. Hashing follows the
 * BDD audit convention (sha256(code + salt)) so the proof is comparable
 * across seal acts but is not a secret-recovery vector.
 *
 * Coordination with thread A (Phase 3): completionGate.checkCompletionGate
 * is used as the canonical gate-check helper. No inline must-counter here.
 */

import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
import {
  dbGet,
  isPostgres,
  safeJsonParse,
  withTransactionAsync,
} from '../../../database/connection.js';
import { generateBaseId } from '../../../utils/baseId.js';
import { apiLogger } from '../../../utils/logger.js';
import {
  success,
  error,
  badRequest,
  notFound,
  forbidden,
} from '../../../utils/response.js';
import {
  checkCompletionGate,
  formatGateError,
} from '../../../services/bdd/completionGate.js';
import { totpLimiter } from '../bdd/shared.js';

const TICKETS_TABLE_ID = 1708;

// `ticket_seal_verification` — created by migration 051. We resolve its id
// once at startup via a name lookup (mirrors getBddTableId pattern). Cached
// for subsequent calls.
const SEAL_TABLE_CACHE = { id: null };

async function getSealVerificationTableId() {
  if (SEAL_TABLE_CACHE.id) return SEAL_TABLE_CACHE.id;
  const row = await dbGet(
    isPostgres()
      ? `SELECT ut.id FROM universal_tables ut
            JOIN projects p ON ut.project_id = p.id
           WHERE p.space_id = $1 AND ut.name = $2 LIMIT 1`
      : `SELECT ut.id FROM universal_tables ut
            JOIN projects p ON ut.project_id = p.id
           WHERE p.space_id = ? AND ut.name = ? LIMIT 1`,
    [11, 'ticket_seal_verification'],
  );
  if (row?.id) {
    SEAL_TABLE_CACHE.id = row.id;
    return row.id;
  }
  return null;
}

/**
 * Hash a TOTP code → sha256(code + salt). Same shape as bdd/shared.js
 * `hashTotpCode` — the proof is a presence indicator, not a secret recovery.
 */
function hashTotpCode(code) {
  if (!code) return null;
  const salt =
    process.env.BDD_AUDIT_SALT ||
    process.env.SESSION_SECRET ||
    'godcrm-bdd-audit-default-salt';
  return crypto.createHash('sha256').update(`${code}|${salt}`).digest('hex');
}

/**
 * Verify a TOTP code against the user's enrolled secret (users.totp_secret).
 * Returns { ok, code }. Codes:
 *   - totp_code_missing  : body.totp_code empty
 *   - totp_not_enrolled  : user has no TOTP secret on file
 *   - totp_invalid       : speakeasy rejected the code
 *   - user_not_found     : userId resolves to no user
 */
async function verifyUserTotp(userId, code) {
  if (!code || typeof code !== 'string') {
    return { ok: false, code: 'totp_code_missing' };
  }
  const user = await dbGet(
    isPostgres()
      ? `SELECT totp_secret, totp_enabled, user_type FROM users WHERE id = $1`
      : `SELECT totp_secret, totp_enabled, user_type FROM users WHERE id = ?`,
    [userId],
  );
  if (!user) return { ok: false, code: 'user_not_found' };
  // ADR-0011 C-5 parity: agents/bots/services cannot self-sign.
  if (user.user_type === 'agent' || user.user_type === 'bot' || user.user_type === 'service') {
    return { ok: false, code: 'agent_forbidden' };
  }
  if (!user.totp_enabled || !user.totp_secret) {
    return { ok: false, code: 'totp_not_enrolled' };
  }
  const ok = speakeasy.totp.verify({
    secret: user.totp_secret,
    encoding: 'base32',
    token: String(code).trim(),
    window: 1,
  });
  if (!ok) return { ok: false, code: 'totp_invalid' };
  return { ok: true };
}

/**
 * Load a Tickets row, parsed.
 */
async function loadTicket(ticketId) {
  const row = await dbGet(
    isPostgres()
      ? `SELECT id, data FROM table_rows WHERE id = $1 AND table_id = $2`
      : `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`,
    [ticketId, TICKETS_TABLE_ID],
  );
  if (!row) return null;
  return { id: row.id, data: safeJsonParse(row.data, {}) || {} };
}

/**
 * Insert one audit row in `ticket_seal_verification` and update Tickets in a
 * single transaction. Builds the Tickets patch from the caller-supplied
 * `patchBuilder({ verifiedAt, totpHash })` so seal/unseal can express their
 * own column-level deltas (sealed_*=values vs sealed_*=null) while sharing
 * the audit-row insert.
 */
async function performSealAct({
  ticketId,
  userId,
  totpCode,
  action, // 'sealed' | 'broken'
  reason,
  ip,
  patchBuilder,
}) {
  const sealTableId = await getSealVerificationTableId();
  if (!sealTableId) {
    throw new Error(
      'ticket_seal_verification table not found — run migration 051',
    );
  }
  const totpHash = hashTotpCode(totpCode);
  const verifiedAt = new Date().toISOString();
  const ticketDataPatch = patchBuilder({ verifiedAt, totpHash });

  return withTransactionAsync(async (trx) => {
    // 1. Append audit row.
    const auditData = {
      ticket_id: ticketId,
      user_id: userId,
      totp_proof: totpHash,
      verified_at: verifiedAt,
      action,
      reason: reason || null,
      ip: ip || null,
    };
    await trx.run(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
         VALUES (?, ?, ?::jsonb, NOW(), NOW())`,
      [sealTableId, generateBaseId(), JSON.stringify(auditData)],
    );

    // 2. Re-read ticket inside the txn (avoid lost-update on concurrent seal).
    const ticketRow = await trx.get(
      `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`,
      [ticketId, TICKETS_TABLE_ID],
    );
    if (!ticketRow) {
      throw new Error(`ticket ${ticketId} disappeared mid-transaction`);
    }
    const ticketData =
      typeof ticketRow.data === 'string'
        ? JSON.parse(ticketRow.data || '{}')
        : ticketRow.data || {};
    Object.assign(ticketData, ticketDataPatch);

    await trx.run(
      `UPDATE table_rows
          SET data = ?::jsonb, updated_at = NOW()
        WHERE id = ? AND table_id = ?`,
      [JSON.stringify(ticketData), ticketId, TICKETS_TABLE_ID],
    );

    return { verifiedAt, totpHash, sealTableId };
  });
}

/* =========================================================================
 * Route registration
 * ========================================================================= */

export default function registerSealRoutes(router) {
  /* ------------------- POST /tickets/:id/seal ------------------- */
  router.post('/tickets/:id/seal', totpLimiter, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (!Number.isFinite(ticketId)) return badRequest(res, 'Invalid ticket id');

      const { totp_code, notes } = req.body || {};
      const userId = req.user?.id;
      if (!userId) return forbidden(res, 'Unauthenticated');

      // 1. Load ticket
      const ticket = await loadTicket(ticketId);
      if (!ticket) return notFound(res, `Ticket ${ticketId}`);

      // 2. Reject double-seal
      if (ticket.data.sealed_at) {
        return error(
          res,
          'TICKET_ALREADY_SEALED',
          `Ticket ${ticketId} is already sealed at ${ticket.data.sealed_at} — unseal first to re-seal`,
          409,
          { sealed_at: ticket.data.sealed_at, sealed_by: ticket.data.sealed_by ?? null },
        );
      }

      // 3. Completion gate (Phase 3 — thread A helper)
      const gate = await checkCompletionGate(ticketId);
      if (!gate.ok) {
        const body = formatGateError(gate);
        return error(
          res,
          body.code,
          `Cannot seal ticket — ${gate.blockers.length} of ${gate.must_total} must-criteria not verified`,
          409,
          { must_total: body.must_total, must_verified: body.must_verified, failed: body.failed },
        );
      }

      // 4. TOTP verification
      const totpResult = await verifyUserTotp(userId, totp_code);
      if (!totpResult.ok) {
        const status =
          totpResult.code === 'totp_not_enrolled'
            ? 412
            : totpResult.code === 'agent_forbidden'
              ? 403
              : totpResult.code === 'user_not_found'
                ? 404
                : 401;
        return error(
          res,
          `TICKET_SEAL_${totpResult.code.toUpperCase()}`,
          totpResult.code === 'totp_not_enrolled'
            ? 'TOTP not enrolled — set up 2FA first'
            : totpResult.code === 'agent_forbidden'
              ? 'Agent accounts cannot seal tickets'
              : totpResult.code === 'totp_code_missing'
                ? 'totp_code is required'
                : totpResult.code === 'user_not_found'
                  ? 'User not found'
                  : 'Invalid TOTP code',
          status,
        );
      }

      // 5. Atomic seal-act — audit row insert + Tickets.sealed_* update in
      //    one DB transaction (A4.3). Patch carries the real verifiedAt /
      //    hash, so we never write a placeholder.
      const ip = req.ip || req.headers['x-forwarded-for'] || null;
      const { verifiedAt } = await performSealAct({
        ticketId,
        userId,
        totpCode: totp_code,
        action: 'sealed',
        reason: notes || null,
        ip,
        patchBuilder: ({ verifiedAt: t, totpHash }) => ({
          sealed_at: t,
          sealed_by: String(userId),
          seal_proof: totpHash,
        }),
      });

      apiLogger.info(
        { ticket_id: ticketId, user_id: userId },
        'ADR-0002 §8 Phase 4: ticket sealed',
      );
      return success(res, {
        ticket_id: ticketId,
        sealed_at: verifiedAt,
        sealed_by: userId,
      });
    } catch (err) {
      apiLogger.error(
        { err: err.message, ticket_id: req.params.id },
        'POST /tickets/:id/seal failed',
      );
      return error(res, 'TICKET_SEAL_FAILED', err.message, 500);
    }
  });

  /* ------------------- POST /tickets/:id/unseal ------------------- */
  router.post('/tickets/:id/unseal', totpLimiter, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (!Number.isFinite(ticketId)) return badRequest(res, 'Invalid ticket id');

      const { totp_code, reason } = req.body || {};
      const userId = req.user?.id;
      if (!userId) return forbidden(res, 'Unauthenticated');
      if (!reason || String(reason).trim().length === 0) {
        return badRequest(res, 'reason is required for unseal');
      }

      // 1. Load ticket
      const ticket = await loadTicket(ticketId);
      if (!ticket) return notFound(res, `Ticket ${ticketId}`);

      // 2. Must currently be sealed
      if (!ticket.data.sealed_at) {
        return error(
          res,
          'TICKET_NOT_SEALED',
          `Ticket ${ticketId} is not sealed — nothing to unseal`,
          409,
        );
      }

      // 3. TOTP verification (same gate as seal)
      const totpResult = await verifyUserTotp(userId, totp_code);
      if (!totpResult.ok) {
        const status =
          totpResult.code === 'totp_not_enrolled'
            ? 412
            : totpResult.code === 'agent_forbidden'
              ? 403
              : totpResult.code === 'user_not_found'
                ? 404
                : 401;
        return error(
          res,
          `TICKET_UNSEAL_${totpResult.code.toUpperCase()}`,
          totpResult.code === 'totp_not_enrolled'
            ? 'TOTP not enrolled — set up 2FA first'
            : totpResult.code === 'agent_forbidden'
              ? 'Agent accounts cannot unseal tickets'
              : totpResult.code === 'totp_code_missing'
                ? 'totp_code is required'
                : totpResult.code === 'user_not_found'
                  ? 'User not found'
                  : 'Invalid TOTP code',
          status,
        );
      }

      // 4. Atomic break-act: audit + clear Tickets.sealed_* (A4.4).
      const ip = req.ip || req.headers['x-forwarded-for'] || null;
      const { verifiedAt } = await performSealAct({
        ticketId,
        userId,
        totpCode: totp_code,
        action: 'broken',
        reason: String(reason).trim(),
        ip,
        patchBuilder: () => ({
          sealed_at: null,
          sealed_by: null,
          seal_proof: null,
        }),
      });

      apiLogger.info(
        { ticket_id: ticketId, user_id: userId, reason },
        'ADR-0002 §8 Phase 4: ticket unsealed',
      );
      return success(res, {
        ticket_id: ticketId,
        unsealed_at: verifiedAt,
        unsealed_by: userId,
      });
    } catch (err) {
      apiLogger.error(
        { err: err.message, ticket_id: req.params.id },
        'POST /tickets/:id/unseal failed',
      );
      return error(res, 'TICKET_UNSEAL_FAILED', err.message, 500);
    }
  });
}

