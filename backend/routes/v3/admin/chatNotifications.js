// Admin-only endpoints — owner-role gated.
//
// Mount in server.js:
//   app.use('/api/v3/admin', authenticate, adminRoutesV3);
//
// Authz (ADR-189): owner-only via the shared `requireOwnerRole` gate —
// `req.user.role === 'owner'`. Admin role alone is NOT enough. Portable to
// from-empty community boxes (no hardcoded space-11 lookup). Per ADR-0040
// §RBAC and reused by ADR-0064 §Decision for the global
// notification-defaults layer.

import express from 'express';

import { dbGet, dbRun, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, badRequest } from '../../../utils/response.js';
import { notifyInvalidate } from '../../../services/notifications/resolveChatPrefs.js';
import { requireOwnerRole } from '../system/helpers.js';

const log = apiLogger.child({ module: 'admin_api' });
const GLOBAL_CHAT_PREFS_KEY = 'chat_notifications_global';

const router = express.Router();

// ─── Prefs validation (mirrors notificationPrefsController.js) ──────────

const TOP_SCALAR_TYPES = {
  enabled: 'boolean',
  sound_enabled: 'boolean',
  sound_volume: 'number',
};
const NESTED_BLOCKS = ['humans', 'agents'];
const NESTED_KEYS = ['sound', 'popup', 'badge'];

function validatePrefsShape(input) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'prefs must be an object' };
  }
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (k in TOP_SCALAR_TYPES) {
      if (v === null) continue;
      // eslint-disable-next-line valid-typeof
      if (typeof v !== TOP_SCALAR_TYPES[k]) {
        return { ok: false, reason: `${k} must be ${TOP_SCALAR_TYPES[k]}` };
      }
      if (k === 'sound_volume' && (v < 0 || v > 1)) {
        return { ok: false, reason: 'sound_volume must be in [0, 1]' };
      }
      out[k] = v;
    } else if (NESTED_BLOCKS.includes(k)) {
      if (v === null) continue;
      if (typeof v !== 'object' || Array.isArray(v)) {
        return { ok: false, reason: `${k} must be an object` };
      }
      const block = {};
      for (const [nk, nv] of Object.entries(v)) {
        if (!NESTED_KEYS.includes(nk)) {
          return { ok: false, reason: `unknown key ${k}.${nk}` };
        }
        if (nv === null) continue;
        if (typeof nv !== 'boolean') {
          return { ok: false, reason: `${k}.${nk} must be boolean` };
        }
        block[nk] = nv;
      }
      out[k] = block;
    } else {
      return { ok: false, reason: `unknown key: ${k}` };
    }
  }
  return { ok: true, value: out };
}

// ─── Routes ─────────────────────────────────────────────────────────────

// GET /api/v3/admin/global/chat-notifications — read the global default JSON.
router.get('/global/chat-notifications', async (req, res) => {
  if (!requireOwnerRole(req, res)) return;
  try {
    const row = await dbGet(
      `SELECT value FROM _app_settings WHERE key = ?`,
      [GLOBAL_CHAT_PREFS_KEY]
    );
    const prefs = safeJsonParse(row?.value, null);
    return success(res, { prefs });
  } catch (err) {
    log.error({ err }, 'admin/global/chat-notifications GET failed');
    return error(res, 'GET_GLOBAL_PREFS_ERROR', err.message, 500);
  }
});

// PUT /api/v3/admin/global/chat-notifications — overwrite the global default.
router.put('/global/chat-notifications', async (req, res) => {
  if (!requireOwnerRole(req, res)) return;
  try {
    const v = validatePrefsShape(req.body?.prefs);
    if (!v.ok) return badRequest(res, v.reason);

    const valueJson = JSON.stringify(v.value || {});
    await dbRun(
      `INSERT INTO _app_settings (key, value, updated_by, updated_at)
       VALUES (?, ?::jsonb, ?, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
      [GLOBAL_CHAT_PREFS_KEY, valueJson, req.user.id]
    );
    // Global write: cache-bust everything.
    await notifyInvalidate({ scope: 'global' });
    log.info({ userId: req.user.id }, 'admin/global/chat-notifications updated');
    return success(res, { prefs: v.value });
  } catch (err) {
    log.error({ err }, 'admin/global/chat-notifications PUT failed');
    return error(res, 'PUT_GLOBAL_PREFS_ERROR', err.message, 500);
  }
});

export default router;
export { validatePrefsShape };
