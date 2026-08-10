/**
 * ADR-0003 §C-4 — TOTP-signed criterion state transitions.
 *
 *   POST /bdd/criteria/:id/verify   (canonical)
 *   POST /bdd/criteria/:id/confirm  (legacy alias of /verify)
 *   POST /bdd/criteria/:id/waive    (TOTP-gated human waive, reason required)
 *
 * Shared internals: verifyCriterionTotp (lockout+backoff), finalizeCriterion
 * (DB write + audit log + pg_notify + release gate recheck).
 */

import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, notFound, badRequest } from '../../../utils/response.js';
import { maybeTransitionDocumentStatus } from '../../../services/bdd/releaseGate.js';
import {
  totpLimiter,
  criteriaTableId,
  getCriterionRow,
  patchLogicalRow,
  pgNotify,
  writeAuditLog,
  hashTotpCode,
  resolveActiveSecret,
} from './shared.js';

/**
 * Internal: verify a TOTP/recovery attempt with lockout+backoff.
 * Returns { ok, err, attempts_remaining }.
 */
async function verifyCriterionTotp(crit, { totp_code, recovery_code }) {
  const totp = crit.data?.totp || {};
  // ADR-156 iter-5 Task 1: prefer secret_enc, fall back to plaintext active_secret.
  const activeSecret = resolveActiveSecret(totp);
  if (!activeSecret && !totp.recovery_hash) {
    return { ok: false, err: { status: 412, code: 'NOT_ENROLLED', message: 'Not enrolled — scan QR first' } };
  }
  // Lockout
  if (totp.locked_until && new Date(totp.locked_until).getTime() > Date.now()) {
    return { ok: false, err: { status: 429, code: 'TOTP_LOCKED', message: 'Locked for 1 hour' } };
  }

  let pass = false;
  if (recovery_code) {
    const h = crypto.createHash('sha256').update(String(recovery_code).trim()).digest('hex');
    pass = !!totp.recovery_hash && h === totp.recovery_hash;
  } else if (totp_code && activeSecret) {
    pass = speakeasy.totp.verify({
      secret: activeSecret,
      encoding: 'base32',
      token: String(totp_code),
      window: 1,
    });
  }

  if (pass) return { ok: true };

  const attempts = (totp.failed_attempts || 0) + 1;
  const MAX = 5;
  const patch = { failed_attempts: attempts };
  if (attempts >= MAX) {
    patch.locked_until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    patch.failed_attempts = 0;
  }
  const tid = await criteriaTableId();
  await patchLogicalRow(tid, crit.id, { totp: { ...totp, ...patch } });

  const remaining = Math.max(0, MAX - attempts);
  return {
    ok: false,
    err: {
      status: 401,
      code: 'TOTP_INVALID',
      message: 'Wrong code',
      attempts_remaining: remaining,
    },
  };
}

async function finalizeCriterion(crit, { status, reason, userId, totpCode = null, ip = null, action = null }) {
  const tid = await criteriaTableId();
  const totp = crit.data?.totp || {};
  const fromStatus = crit.data?.status || null;
  const totpHash = totpCode ? hashTotpCode(totpCode) : null;
  const patch = {
    status,
    [`${status}_at`]: new Date().toISOString(),
    [`${status}_by_user_id`]: userId ?? null,
    totp: {
      ...totp,
      failed_attempts: 0,
      locked_until: null,
      // ADR-0003 §C-4: fresh-TOTP sentinel — last_verified_at becomes the row-lock
      // timestamp. Subsequent state transitions must present a new TOTP code.
      last_verified_at: new Date().toISOString(),
      last_verified_hash: totpHash,
    },
  };
  if (reason) patch[`${status}_reason`] = reason;
  await patchLogicalRow(tid, crit.id, patch);

  await writeAuditLog({
    criterion_id: crit.id,
    spec_id: crit.data?.spec_id ?? null,
    doc_id: crit.data?.source_doc_id ?? null,
    action: action || status,
    from_status: fromStatus,
    to_status: status,
    user_id: userId ?? null,
    actor_kind: userId ? 'user' : 'system',
    totp_hash: totpHash,
    reason: reason ?? null,
    ip,
  });

  await pgNotify(`bdd.criterion.${status}`, {
    event: `bdd.criterion.${status}`,
    criterion_id: crit.id,
    spec_id: crit.data?.spec_id ?? null,
    doc_id: crit.data?.source_doc_id ?? null,
    by_user_id: userId ?? null,
    reason: reason ?? null,
  });

  // ADR-0003 §C-5: fire-and-forget release gate recheck on every criterion
  // transition. Safe on any state — maybeTransitionDocumentStatus is a no-op
  // unless the aggregated gate crosses a threshold (ready ↔ red).
  const docId = Number(crit.data?.source_doc_id);
  if (Number.isFinite(docId) && docId > 0) {
    maybeTransitionDocumentStatus(docId, {
      causedBy: `bdd.criterion.${status}:${crit.id}`,
      userId: userId ?? null,
    }).catch((err) => {
      apiLogger.error({ err: err.message, docId, critId: crit.id }, 'release gate hook failed (non-fatal)');
    });
  }
}

// ADR-0003 §C-4: shared handler for TOTP-signed state transitions.
// Used by /verify (canonical), /confirm (legacy alias), and /waive.
async function handleTotpTransition(req, res, { status, reasonRequired = false, action }) {
  try {
    const critId = parseInt(req.params.id, 10);
    if (!Number.isFinite(critId)) return badRequest(res, 'Invalid criterion id');

    const { reason } = req.body || {};
    if (reasonRequired && (!reason || String(reason).trim().length === 0)) {
      return badRequest(res, 'reason is required');
    }

    const crit = await getCriterionRow(critId);
    if (!crit) return notFound(res, 'bdd_criteria row');

    const v = await verifyCriterionTotp(crit, req.body || {});
    if (!v.ok) {
      return res.status(v.err.status).json({
        success: false,
        error: { code: v.err.code, message: v.err.message },
        attempts_remaining: v.err.attempts_remaining,
      });
    }

    const totpCode = (req.body || {}).totp_code || (req.body || {}).recovery_code || null;
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    await finalizeCriterion(crit, {
      status,
      reason: reasonRequired ? String(reason).trim() : null,
      userId: req.user?.id,
      totpCode,
      ip,
      action: action || status,
    });
    return success(res, { criterion_id: critId, status });
  } catch (err) {
    apiLogger.error({ err, critId: req.params.id, status }, `POST /bdd/criteria/:id/${action || status} failed`);
    return error(res, `BDD_${(action || status).toUpperCase()}_FAILED`, err.message, 500);
  }
}

export default function registerTransitionRoutes(router) {
  /* ------------------- POST /bdd/criteria/:id/verify ------------------- */
  // ADR-0003 §C-4 canonical ownership act. TOTP-signed; sets status='verified',
  // writes bdd_audit_log entry, emits pg_notify('bdd.criterion.verified').
  router.post('/criteria/:id/verify', totpLimiter, async (req, res) => {
    return handleTotpTransition(req, res, { status: 'verified', action: 'verify' });
  });

  /* ------------------- POST /bdd/criteria/:id/confirm (legacy alias) ------------------- */
  // Retained for back-compat with older frontend. Equivalent to /verify.
  router.post('/criteria/:id/confirm', totpLimiter, async (req, res) => {
    return handleTotpTransition(req, res, { status: 'verified', action: 'verify' });
  });

  /* ------------------- POST /bdd/criteria/:id/waive ------------------- */
  router.post('/criteria/:id/waive', totpLimiter, async (req, res) => {
    return handleTotpTransition(req, res, { status: 'waived', reasonRequired: true, action: 'waive' });
  });
}
