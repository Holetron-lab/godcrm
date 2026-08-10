/**
 * ADR-0003 Phase 2 (T-127904) — Escalate / Resolve flow.
 *
 * Escalate: any authenticated user flags a criterion with a reason. Criterion
 *   status flips to 'escalated', escalation_reason / escalated_at / escalated_by
 *   are recorded on data.*.
 * Resolve:  only the doc owner (spec.owner_user_id or spec.created_by), or an
 *   admin/owner role, can resolve. Clears escalation_* fields and sets
 *   data.status to the requested 'pending' | 'verified'.
 *
 * No TOTP gate (unlike /verify /waive): escalation is an anyone-can-flag
 * signal, and resolve is already ACL-protected by owner check. Both actions
 * are recorded in bdd_audit_log and emit pg_notify for the SSE stream.
 *
 * Storage note: bdd_criteria is a JSONB-backed logical table (table_rows).
 * escalation_reason / escalated_at / escalated_by live as keys inside
 * data->>... — no SQL ALTER TABLE is needed for the fields described in the
 * ticket. scripts/migrations/2026-04-21-bdd-criteria-escalation.sql is a
 * no-op marker kept for changelog completeness.
 */

import { dbGet, dbRun, sqlNow } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, notFound, badRequest } from '../../../utils/response.js';
import { maybeTransitionDocumentStatus } from '../../../services/bdd/releaseGate.js';
import {
  getBddTableId,
  criteriaTableId,
  getCriterionRow,
  patchLogicalRow,
  pgNotify,
  writeAuditLog,
} from './shared.js';

async function resolveDocOwnerId(crit) {
  const specId = crit.data?.spec_id;
  if (!specId) return null;
  const specsTableId = await getBddTableId('bdd_specs');
  if (!specsTableId) return null;
  const spec = await dbGet(
    `SELECT data, created_by FROM table_rows WHERE table_id = ? AND id = ?`,
    [specsTableId, specId]
  );
  if (!spec) return null;
  const sData = typeof spec.data === 'string' ? JSON.parse(spec.data) : (spec.data || {});
  const uid = sData.owner_user_id ?? spec.created_by ?? null;
  return uid == null ? null : Number(uid);
}

function isOwnerRole(user) {
  const r = user?.role;
  return r === 'admin' || r === 'owner';
}

export default function registerEscalationRoutes(router) {
  /* ------------------- POST /bdd/criteria/:id/escalate ------------------- */
  router.post('/criteria/:id/escalate', async (req, res) => {
    try {
      const critId = parseInt(req.params.id, 10);
      if (!Number.isFinite(critId)) return badRequest(res, 'Invalid criterion id');

      const { reason } = req.body || {};
      if (!reason || String(reason).trim().length === 0) {
        return badRequest(res, 'reason is required');
      }

      const crit = await getCriterionRow(critId);
      if (!crit) return notFound(res, 'bdd_criteria row');

      const tid = await criteriaTableId();
      const fromStatus = crit.data?.status || null;
      const userId = req.user?.id ?? null;
      const nowIso = new Date().toISOString();
      const trimmedReason = String(reason).trim();

      await patchLogicalRow(tid, crit.id, {
        status: 'escalated',
        escalation_reason: trimmedReason,
        escalated_at: nowIso,
        escalated_by: userId,
      });

      await writeAuditLog({
        criterion_id: crit.id,
        spec_id: crit.data?.spec_id ?? null,
        doc_id: crit.data?.source_doc_id ?? null,
        action: 'criterion.escalated',
        from_status: fromStatus,
        to_status: 'escalated',
        user_id: userId,
        actor_kind: 'user',
        reason: trimmedReason,
        ip: req.ip || req.headers['x-forwarded-for'] || null,
      });

      await pgNotify('bdd.criterion.escalated', {
        event: 'bdd.criterion.escalated',
        criterion_id: crit.id,
        spec_id: crit.data?.spec_id ?? null,
        doc_id: crit.data?.source_doc_id ?? null,
        by_user_id: userId,
        reason: trimmedReason,
      });

      return success(res, { criterion_id: critId, status: 'escalated' });
    } catch (err) {
      apiLogger.error({ err, critId: req.params.id }, 'POST /bdd/criteria/:id/escalate failed');
      return error(res, 'BDD_ESCALATE_FAILED', err.message, 500);
    }
  });

  /* ------------------- POST /bdd/criteria/:id/resolve ------------------- */
  router.post('/criteria/:id/resolve', async (req, res) => {
    try {
      const critId = parseInt(req.params.id, 10);
      if (!Number.isFinite(critId)) return badRequest(res, 'Invalid criterion id');

      const { new_status } = req.body || {};
      const ALLOWED = new Set(['pending', 'verified']);
      if (!new_status || !ALLOWED.has(new_status)) {
        return badRequest(res, `new_status must be one of: ${[...ALLOWED].join(', ')}`);
      }

      const crit = await getCriterionRow(critId);
      if (!crit) return notFound(res, 'bdd_criteria row');

      const ownerId = await resolveDocOwnerId(crit);
      const userId = req.user?.id ?? null;
      const authorized = (ownerId != null && Number(ownerId) === Number(userId)) || isOwnerRole(req.user);
      if (!authorized) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'NOT_DOC_OWNER',
            message: 'Only the document owner can resolve an escalated criterion',
          },
        });
      }

      const tid = await criteriaTableId();
      const fromStatus = crit.data?.status || null;
      const nowIso = new Date().toISOString();

      // Shallow merge can't delete keys; read full data, strip escalation_*,
      // reset status, then overwrite.
      const nextData = {
        ...(crit.data || {}),
        status: new_status,
        [`${new_status}_at`]: nowIso,
        [`${new_status}_by_user_id`]: userId,
      };
      delete nextData.escalation_reason;
      delete nextData.escalated_at;
      delete nextData.escalated_by;

      await dbRun(
        `UPDATE table_rows SET data = ?::jsonb, updated_at = ${sqlNow()}
         WHERE table_id = ? AND id = ?`,
        [JSON.stringify(nextData), tid, crit.id]
      );

      await writeAuditLog({
        criterion_id: crit.id,
        spec_id: crit.data?.spec_id ?? null,
        doc_id: crit.data?.source_doc_id ?? null,
        action: 'criterion.resolved',
        from_status: fromStatus,
        to_status: new_status,
        user_id: userId,
        actor_kind: 'user',
        reason: null,
        ip: req.ip || req.headers['x-forwarded-for'] || null,
      });

      await pgNotify('bdd.criterion.resolved', {
        event: 'bdd.criterion.resolved',
        criterion_id: crit.id,
        spec_id: crit.data?.spec_id ?? null,
        doc_id: crit.data?.source_doc_id ?? null,
        by_user_id: userId,
        new_status,
      });

      // ADR-0003 §C-5: re-check release gate, same as finalizeCriterion does.
      const docId = Number(crit.data?.source_doc_id);
      if (Number.isFinite(docId) && docId > 0) {
        maybeTransitionDocumentStatus(docId, {
          causedBy: `bdd.criterion.resolved:${crit.id}`,
          userId,
        }).catch((err) => {
          apiLogger.error({ err: err.message, docId, critId: crit.id }, 'release gate hook failed (non-fatal)');
        });
      }

      return success(res, { criterion_id: critId, status: new_status });
    } catch (err) {
      apiLogger.error({ err, critId: req.params.id }, 'POST /bdd/criteria/:id/resolve failed');
      return error(res, 'BDD_RESOLVE_FAILED', err.message, 500);
    }
  });
}
