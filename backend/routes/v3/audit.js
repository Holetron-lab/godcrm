/**
 * Audit chain API — ADR-0066-A §C.
 *
 * Owner-only integrity check over the `audit_log` hash chain.
 *
 * Mount in server.js:
 *   app.use('/api/v3/audit', authenticate, auditRouter);
 *
 * Authorization (ADR-189): JWT-authenticated at the parent mount, then
 * owner-only via the shared `requireOwnerRole` gate — `req.user.role ===
 * 'owner'`. Admin role is NOT sufficient. Portable to from-empty community
 * boxes (no hardcoded space-11 lookup). Rejects 403 otherwise.
 */

import express from 'express';

import { verifyAuditChain } from '../../services/audit/verifyAuditChain.js';
import { apiLogger } from '../../utils/logger.js';
import { success, error, badRequest } from '../../utils/response.js';
import { requireOwnerRole } from './system/helpers.js';

const log = apiLogger.child({ module: 'audit_api' });

const router = express.Router();

/**
 * GET /api/v3/audit/verify?from_id=<n>
 * → { ok, checked, break_at_id, cutover_id, head }
 */
router.get('/verify', async (req, res) => {
  if (!requireOwnerRole(req, res)) return;

  let fromId;
  if (req.query.from_id !== undefined) {
    fromId = Number(req.query.from_id);
    if (!Number.isInteger(fromId) || fromId < 0) {
      return badRequest(res, 'from_id must be a non-negative integer');
    }
  }

  try {
    const result = await verifyAuditChain(fromId);
    if (!result.ok) {
      log.warn(
        { break_at_id: result.break_at_id, checked: result.checked },
        'audit chain verification FAILED — possible tampering'
      );
    }
    return success(res, result);
  } catch (err) {
    log.error({ err: { message: err?.message } }, 'audit verify failed');
    return error(res, 'AUDIT_VERIFY_FAILED', 'Chain verification error', 500);
  }
});

export default router;
