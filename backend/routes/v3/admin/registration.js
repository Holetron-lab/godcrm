// ADR-188 F1 — owner-only runtime registration policy.
//
//   GET  /api/v3/admin/registration — read the effective runtime policy
//   PUT  /api/v3/admin/registration — owner writes policy (pg_notify-evicted cluster-wide)
//
// Storage: `_app_settings` key='registration' (JSONB) — reuses the ADR-0064 table,
// no migration. Authz gates on role==='owner' (see requireOwner) — NOT a hardcoded
// space id — so from-empty community boxes (dev188 / box 205) with no space 11 work.
// The unauthenticated public slice (F5) is a separate route. Route-level enforcement
// of `signup_mode`/`auto_join` (F2/F3) is a follow-up; this endpoint persists +
// resolves the full contract so the owner UI round-trips cleanly and `default_role`
// (already enforced in AuthService) takes effect.

import express from 'express';

import { dbRun } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, forbidden } from '../../../utils/response.js';
import {
  RUNTIME_SETTINGS_KEY,
  sanitizeRuntimeConfig,
  getEffectiveRegistrationPolicy,
  invalidateRegistrationCache,
  notifyRegistrationInvalidate,
} from '../../../services/registrationPolicy.js';

const log = apiLogger.child({ module: 'admin_registration' });

const router = express.Router();

// Owner gate. Gates on the platform-owner ROLE, not a hardcoded space id.
//
// The old code looked up `spaces WHERE id = 11` and 500'd with OWNER_SPACE_MISSING
// when that row was absent. On a from-empty community box (dev188, box 205 — the exact
// target of ADR-188) space 11 never exists (space ids are sequential from 1), so the
// box owner could never save policy. The first registrant on ANY box is minted
// role='owner' by AuthService, which is exactly this gate. `admin` alone is
// intentionally NOT enough — matches the established owner checks in routes/v3/terminal.js.
export async function requireOwner(req, res) {
  if (!req.user?.id) {
    forbidden(res, 'Authentication required');
    return false;
  }
  if (req.user.role !== 'owner') {
    forbidden(res, 'Owner-only endpoint');
    return false;
  }
  return true;
}

// Project the effective policy down to the frozen FE contract slice.
function toContract(policy) {
  return {
    signup_mode: policy.signup_mode,
    default_role: policy.default_role,
    auto_join: Array.isArray(policy.auto_join) ? policy.auto_join : [],
  };
}

// GET /api/v3/admin/registration — effective runtime policy (env preset if unset).
router.get('/registration', async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  try {
    const policy = await getEffectiveRegistrationPolicy(null);
    return success(res, toContract(policy));
  } catch (err) {
    log.error({ err }, 'admin/registration GET failed');
    return error(res, 'GET_REGISTRATION_POLICY_ERROR', err.message, 500);
  }
});

// PUT /api/v3/admin/registration — overwrite the runtime policy blob.
router.put('/registration', async (req, res) => {
  if (!(await requireOwner(req, res))) return;
  try {
    const clean = sanitizeRuntimeConfig(req.body);
    // Fill unset scalars from the current effective policy so a partial PUT never
    // silently downgrades the front door (fail-closed is the client default, not here).
    const effective = await getEffectiveRegistrationPolicy(null);
    const toStore = {
      signup_mode: clean.signup_mode ?? effective.signup_mode,
      default_role: clean.default_role ?? effective.default_role,
      auto_join: clean.auto_join,
    };

    await dbRun(
      `INSERT INTO _app_settings (key, value, updated_by, updated_at)
       VALUES (?, ?::jsonb, ?, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
      [RUNTIME_SETTINGS_KEY, JSON.stringify(toStore), req.user.id]
    );

    // Evict locally now (this process) + fire pg_notify for any other listener.
    invalidateRegistrationCache();
    await notifyRegistrationInvalidate();

    log.info({ userId: req.user.id, signup_mode: toStore.signup_mode }, 'admin/registration updated');

    // Return the freshly-resolved effective policy so the UI reflects reality.
    const resolved = await getEffectiveRegistrationPolicy(null);
    return success(res, toContract(resolved));
  } catch (err) {
    log.error({ err }, 'admin/registration PUT failed');
    return error(res, 'PUT_REGISTRATION_POLICY_ERROR', err.message, 500);
  }
});

export default router;
