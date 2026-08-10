/**
 * Audit chain API — ADR-0066-A §C.
 *
 * Owner-only integrity check over the `audit_log` hash chain.
 *
 * Mount in server.js:
 *   app.use('/api/v3/audit', authenticate, auditRouter);
 *
 * Authorization mirrors ADR-0040 / ADR-0066 §5: JWT-authenticated at the
 * parent mount, then owner-only — `req.user.id === space(11).owner_id`.
 * Admin role is NOT sufficient; only the Development-space owner may read
 * the integrity surface. Rejects 403 otherwise.
 */

import express from 'express';

import { dbGet } from '../../database/connection.js';
import { verifyAuditChain } from '../../services/audit/verifyAuditChain.js';
import { apiLogger } from '../../utils/logger.js';
import { success, error, forbidden, badRequest } from '../../utils/response.js';

const log = apiLogger.child({ module: 'audit_api' });

const OWNER_SPACE_ID = 11; // Development — its owner owns the audit surface.

const router = express.Router();

async function requireOwner(req, res) {
  if (!req.user?.id) {
    forbidden(res, 'Authentication required');
    return false;
  }
  const space = await dbGet('SELECT id, owner_id FROM spaces WHERE id = ?', [
    OWNER_SPACE_ID,
  ]);
  if (!space) {
    error(res, 'OWNER_SPACE_MISSING', `Space ${OWNER_SPACE_ID} not found`, 500);
    return false;
  }
  if (space.owner_id !== req.user.id) {
    forbidden(res, 'Owner-only endpoint');
    return false;
  }
  return true;
}

/**
 * GET /api/v3/audit/verify?from_id=<n>
 * → { ok, checked, break_at_id, cutover_id, head }
 */
router.get('/verify', async (req, res) => {
  if (!(await requireOwner(req, res))) return;

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
