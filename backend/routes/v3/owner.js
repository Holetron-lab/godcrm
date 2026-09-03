/**
 * Owner-only endpoints — ADR-0059 AMEND-3 §4.9.
 *
 * Mount in server.js:
 *   app.use('/api/v3/owner', authenticate, ownerRoutesV3);
 *
 * Authz (ADR-189): owner-only via the shared `requireOwnerRole` gate —
 * `req.user.role === 'owner'`. Admin role alone is NOT enough. Portable to
 * from-empty community boxes (no hardcoded space-11 lookup).
 */

import express from 'express';

import { apiLogger } from '../../utils/logger.js';
import { success } from '../../utils/response.js';
import { getCallsLimits } from '../../services/livekit/callsLimits.js';
import { requireOwnerRole } from './system/helpers.js';

const log = apiLogger.child({ module: 'owner_api' });

const router = express.Router();

// GET /api/v3/owner/calls-settings — read-only view of current limits.
// PUT is intentionally NOT exposed in this cut: AMEND-3 specifies "edit via
// .env until D14 (2026-05-18)". A future PUT will land alongside the
// `_settings` + pg_notify migration post-D14.
router.get('/calls-settings', async (req, res) => {
  if (!requireOwnerRole(req, res)) return;
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
