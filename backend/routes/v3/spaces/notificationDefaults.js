// notificationDefaults.js — ADR-0064 WP-A.
//
// Per-space default chat notification preferences (layer 3 of the 4-layer
// hierarchy). Stored on spaces.notification_defaults JSONB.
//
// Endpoints:
//   GET /spaces/:id/notification-defaults  — viewer+ of space
//   PUT /spaces/:id/notification-defaults  — admin+ of space

import { dbGet, dbRun, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, badRequest, notFound, forbidden } from '../../../utils/response.js';
import { canAdminister, canView } from '../../../services/EffectiveRoleService.js';
import { notifyInvalidate } from '../../../services/notifications/resolveChatPrefs.js';

const TOP_SCALAR_TYPES = { enabled: 'boolean', sound_enabled: 'boolean', sound_volume: 'number' };
const NESTED_BLOCKS = ['humans', 'agents'];
const NESTED_KEYS = ['sound', 'popup', 'badge'];

function validatePrefsShape(input) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'prefs must be an object' };
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (k in TOP_SCALAR_TYPES) {
      if (v === null) continue;
      // eslint-disable-next-line valid-typeof
      if (typeof v !== TOP_SCALAR_TYPES[k]) return { ok: false, reason: `${k} must be ${TOP_SCALAR_TYPES[k]}` };
      if (k === 'sound_volume' && (v < 0 || v > 1)) return { ok: false, reason: 'sound_volume must be in [0, 1]' };
      out[k] = v;
    } else if (NESTED_BLOCKS.includes(k)) {
      if (v === null) continue;
      if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, reason: `${k} must be an object` };
      const block = {};
      for (const [nk, nv] of Object.entries(v)) {
        if (!NESTED_KEYS.includes(nk)) return { ok: false, reason: `unknown key ${k}.${nk}` };
        if (nv === null) continue;
        if (typeof nv !== 'boolean') return { ok: false, reason: `${k}.${nk} must be boolean` };
        block[nk] = nv;
      }
      out[k] = block;
    } else {
      return { ok: false, reason: `unknown key: ${k}` };
    }
  }
  return { ok: true, value: out };
}

export default function registerNotificationDefaultsRoutes(router) {

  router.get('/:id/notification-defaults', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return forbidden(res, 'Authentication required');
      const spaceId = parseInt(req.params.id, 10);
      if (!spaceId) return badRequest(res, 'invalid space id');

      const space = await dbGet('SELECT id, owner_id, notification_defaults FROM spaces WHERE id = $1', [spaceId]);
      if (!space) return notFound(res, 'Space not found');

      // viewer+ on space (owner is implicitly admin)
      const allowed = space.owner_id === userId || (await canView(userId, { spaceId }));
      if (!allowed) return forbidden(res, 'Not a member of this space');

      const prefs = safeJsonParse(space.notification_defaults, null);
      return success(res, { prefs });
    } catch (err) {
      apiLogger.error('spaces/:id/notification-defaults GET error:', err);
      return error(res, 'GET_SPACE_DEFAULTS_ERROR', err.message, 500);
    }
  });

  router.put('/:id/notification-defaults', async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return forbidden(res, 'Authentication required');
      const spaceId = parseInt(req.params.id, 10);
      if (!spaceId) return badRequest(res, 'invalid space id');

      const space = await dbGet('SELECT id, owner_id FROM spaces WHERE id = $1', [spaceId]);
      if (!space) return notFound(res, 'Space not found');

      const allowed = space.owner_id === userId || (await canAdminister(userId, { spaceId }));
      if (!allowed) return forbidden(res, 'Admin role required to set space defaults');

      const v = validatePrefsShape(req.body?.prefs);
      if (!v.ok) return badRequest(res, v.reason);

      const valueJson = v.value ? JSON.stringify(v.value) : null;
      await dbRun(
        `UPDATE spaces SET notification_defaults = $1::jsonb WHERE id = $2`,
        [valueJson, spaceId]
      );
      await notifyInvalidate({ space_id: spaceId });
      return success(res, { prefs: v.value });
    } catch (err) {
      apiLogger.error('spaces/:id/notification-defaults PUT error:', err);
      return error(res, 'PUT_SPACE_DEFAULTS_ERROR', err.message, 500);
    }
  });
}
