/**
 * NowState read-model — ADR-171 (T1).
 *
 * Mount in server.js:
 *   app.use('/api/v3', authenticate, nowStateRoutesV3);   // exposes GET /api/v3/now-state
 *
 * GET /api/v3/now-state
 *   Returns the frozen `NowState` shape (see services/nowState/contract.js).
 *   Behind a mock flag (default ON) it serves a deterministic fixture with no
 *   dependency on the domain tables or Garmin — so the HUD/companion/frontend
 *   develop against a stable contract before those sources land (T3/T4/T5).
 *
 * Mock flag: env `NOW_STATE_MOCK` (default 'true'). The live read-model is not
 * implemented in T1 — with the flag off the endpoint returns 501 until the
 * domain (T2/T3), capture (T4) and Garmin (T5) pipelines are wired.
 *
 * Ring safety: this is a Ring 0 dev endpoint. Ring 1 (NL) MUST set
 * `NOW_STATE_MOCK=false` so it never serves fixture data to real users.
 */

import express from 'express';

import { apiLogger } from '../../utils/logger.js';
import { success, error } from '../../utils/response.js';
import { buildMockNowState, NOW_STATE_VERSION } from '../../services/nowState/contract.js';

const log = apiLogger.child({ module: 'now_state_api' });

const router = express.Router();

/** Mock is the default; only an explicit `NOW_STATE_MOCK=false` disables it. */
function isMockMode() {
  return (process.env.NOW_STATE_MOCK ?? 'true').toLowerCase() !== 'false';
}

// GET /api/v3/now-state
router.get('/now-state', (req, res) => {
  if (isMockMode()) {
    const payload = buildMockNowState();
    log.debug({ userId: req.user?.id, version: NOW_STATE_VERSION }, 'now-state served (mock)');
    return success(res, payload);
  }

  // Live read-model — not implemented in T1. Kept explicit rather than
  // silently returning the mock so a misconfigured Ring 1 fails loudly.
  log.warn({ userId: req.user?.id }, 'now-state live read-model requested but not implemented');
  return error(
    res,
    'NOW_STATE_NOT_IMPLEMENTED',
    'Live NowState is not implemented yet (pending ADR-171 T2/T3/T4/T5). Set NOW_STATE_MOCK=true for the fixture.',
    501,
  );
});

export default router;
