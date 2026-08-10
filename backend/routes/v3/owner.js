/**
 * Owner-only endpoints — ADR-0059 AMEND-3 §4.9.
 *
 * Mount in server.js:
 *   app.use('/api/v3/owner', authenticate, ownerRoutesV3);
 *
 * Authz mirrors `routes/v3/secrets.js`: only the Development space (id 11)
 * owner may access. Admin role alone is NOT enough.
 */

import express from 'express';

import { dbGet } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, error, forbidden } from '../../utils/response.js';
import { getCallsLimits } from '../../services/livekit/callsLimits.js';

const log = apiLogger.child({ module: 'owner_api' });
const OWNER_SPACE_ID = 11;

const router = express.Router();

async function requireOwner(req, res) {
  if (!req.user?.id) {
    forbidden(res, 'Authentication required');
    return false;
  }
  const space = await dbGet('SELECT id, owner_id FROM spaces WHERE id = ?', [OWNER_SPACE_ID]);
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

// GET /api/v3/owner/calls-settings — read-only view of current limits.
// PUT is intentionally NOT exposed in this cut: AMEND-3 specifies "edit via
// .env until D14 (2026-05-18)". A future PUT will land alongside the
// `_settings` + pg_notify migration post-D14.
router.get('/calls-settings', async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  const limits = getCallsLimits();
  log.debug({ userId: req.user.id }, 'calls-settings read');
  return success(res, {
    maxConcurrent: limits.maxConcurrent,
    maxParticipantsPerRoom: limits.maxParticipantsPerRoom,
    maxDurationMinutes: limits.maxDurationMinutes,
    retentionDays: limits.retentionDays,
    editable: false,
    note: 'Edit via .env on each host until 2026-05-19 (post-D14 migration to _settings).',
  });
});

export default router;
