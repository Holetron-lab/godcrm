// notificationPrefsController.js — ADR-0064 WP-A.
//
// Chat-side endpoints for the notification-preferences hierarchy + the
// unread badge summary used by FloatingChatButton.
//
// Mounted via chat/index.js under /api/v3/chat/*.
//
// Endpoints (6 of the 11 total — space and admin live in their own files):
//   GET    /chat/unread-summary
//   GET    /chat/notification-prefs/resolved?conversation_id=X
//   GET    /chat/notification-prefs/personal
//   PUT    /chat/notification-prefs/personal
//   GET    /chat/notification-prefs/conversation/:id
//   PUT    /chat/notification-prefs/conversation/:id
//   DELETE /chat/notification-prefs/conversation/:id

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, error, badRequest, notFound, forbidden,
  requireAuth,
} from './chatShared.js';
import { resolveChatPrefs, notifyInvalidate } from '../../../services/notifications/resolveChatPrefs.js';

// ─── Shape validation ───────────────────────────────────────────────────────
// The canonical JSON shape is partial — every field optional. We reject
// unknown keys and bad types but tolerate missing ones.

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

// ─── Helpers ────────────────────────────────────────────────────────────────

async function assertParticipant(userId, conversationId) {
  const part = await dbGet(
    `SELECT id FROM conversation_participants WHERE user_id = $1 AND conversation_id = $2`,
    [userId, conversationId]
  );
  return !!part;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export default function registerNotificationPrefsRoutes(router) {

  // GET /chat/unread-summary — total + by_conversation for the current user.
  router.get('/unread-summary', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      // Use the maintained conversation_participants.unread_count + the
      // last_read_at fallback. For each conversation where the user is a
      // participant, count messages > last_read_at (excluding system noise).
      const rows = await dbAll(
        `SELECT cp.conversation_id,
                GREATEST(
                  COALESCE(cp.unread_count, 0),
                  COALESCE((
                    SELECT COUNT(*) FROM messages m
                     WHERE m.conversation_id = cp.conversation_id
                       AND m.sender_id IS DISTINCT FROM $1
                       AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
                       AND (m.content_type IS NULL OR m.content_type NOT IN ('tool_call','tool_result','thinking','plan','agent_status'))
                  ), 0)
                ) AS unread_count
           FROM conversation_participants cp
          WHERE cp.user_id = $1`,
        [userId]
      );
      const by_conversation = rows
        .map((r) => ({
          conversation_id: parseInt(r.conversation_id, 10),
          unread_count: parseInt(r.unread_count || 0, 10),
        }))
        .filter((r) => r.unread_count > 0);
      const total = by_conversation.reduce((sum, r) => sum + r.unread_count, 0);
      return success(res, { total, by_conversation });
    } catch (err) {
      apiLogger.error('chat/unread-summary error:', err);
      return error(res, 'UNREAD_SUMMARY_ERROR', err.message, 500);
    }
  });

  // GET /chat/notification-prefs/resolved?conversation_id=X
  router.get('/notification-prefs/resolved', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const conversationId = parseInt(req.query.conversation_id, 10);
      if (!conversationId) return badRequest(res, 'conversation_id required');
      const prefs = await resolveChatPrefs({ userId, conversationId });
      return success(res, { prefs });
    } catch (err) {
      apiLogger.error('chat/notification-prefs/resolved error:', err);
      return error(res, 'RESOLVE_ERROR', err.message, 500);
    }
  });

  // GET /chat/notification-prefs/personal
  router.get('/notification-prefs/personal', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const row = await dbGet(
        `SELECT setting_value_encrypted AS value FROM user_settings
         WHERE user_id = $1 AND setting_key = 'chat_notifications'`,
        [userId]
      );
      const prefs = safeJsonParse(row?.value, null);
      return success(res, { prefs });
    } catch (err) {
      apiLogger.error('chat/notification-prefs/personal GET error:', err);
      return error(res, 'GET_PERSONAL_ERROR', err.message, 500);
    }
  });

  // PUT /chat/notification-prefs/personal
  router.put('/notification-prefs/personal', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const v = validatePrefsShape(req.body?.prefs);
      if (!v.ok) return badRequest(res, v.reason);
      const valueJson = JSON.stringify(v.value || {});

      await dbRun(
        `INSERT INTO user_settings (user_id, setting_key, setting_value_encrypted, setting_type)
         VALUES ($1, 'chat_notifications', $2, 'preference')
         ON CONFLICT (user_id, setting_key)
         DO UPDATE SET setting_value_encrypted = $2, last_used_at = CURRENT_TIMESTAMP`,
        [userId, valueJson]
      );
      await notifyInvalidate({ user_id: userId });
      return success(res, { prefs: v.value });
    } catch (err) {
      apiLogger.error('chat/notification-prefs/personal PUT error:', err);
      return error(res, 'PUT_PERSONAL_ERROR', err.message, 500);
    }
  });

  // GET /chat/notification-prefs/conversation/:id — raw per-chat override
  // (or null if not set). Used by the per-chat overrides modal to show the
  // current state instead of opening in an all-Inherit default.
  router.get('/notification-prefs/conversation/:id', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const conversationId = parseInt(req.params.id, 10);
      if (!conversationId) return badRequest(res, 'conversation_id required');

      const row = await dbGet(
        `SELECT notification_overrides AS value
           FROM conversation_participants
          WHERE user_id = $1 AND conversation_id = $2`,
        [userId, conversationId]
      );
      if (!row) return forbidden(res, 'Not a participant in this conversation');
      const prefs = typeof row.value === 'string' ? safeJsonParse(row.value, null) : (row.value ?? null);
      return success(res, { prefs });
    } catch (err) {
      apiLogger.error('chat/notification-prefs/conversation GET error:', err);
      return error(res, 'GET_CONV_ERROR', err.message, 500);
    }
  });

  // PUT /chat/notification-prefs/conversation/:id
  router.put('/notification-prefs/conversation/:id', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const conversationId = parseInt(req.params.id, 10);
      if (!conversationId) return badRequest(res, 'conversation_id required');
      const v = validatePrefsShape(req.body?.prefs);
      if (!v.ok) return badRequest(res, v.reason);

      if (!(await assertParticipant(userId, conversationId))) {
        return forbidden(res, 'Not a participant in this conversation');
      }
      const valueJson = JSON.stringify(v.value || {});
      await dbRun(
        `UPDATE conversation_participants
            SET notification_overrides = $1::jsonb
          WHERE user_id = $2 AND conversation_id = $3`,
        [valueJson, userId, conversationId]
      );
      await notifyInvalidate({ user_id: userId, conversation_id: conversationId });
      return success(res, { prefs: v.value });
    } catch (err) {
      apiLogger.error('chat/notification-prefs/conversation PUT error:', err);
      return error(res, 'PUT_CONV_ERROR', err.message, 500);
    }
  });

  // DELETE /chat/notification-prefs/conversation/:id — clear the override
  router.delete('/notification-prefs/conversation/:id', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const conversationId = parseInt(req.params.id, 10);
      if (!conversationId) return badRequest(res, 'conversation_id required');

      if (!(await assertParticipant(userId, conversationId))) {
        return forbidden(res, 'Not a participant in this conversation');
      }
      await dbRun(
        `UPDATE conversation_participants
            SET notification_overrides = NULL
          WHERE user_id = $1 AND conversation_id = $2`,
        [userId, conversationId]
      );
      await notifyInvalidate({ user_id: userId, conversation_id: conversationId });
      return success(res, { cleared: true });
    } catch (err) {
      apiLogger.error('chat/notification-prefs/conversation DELETE error:', err);
      return error(res, 'DELETE_CONV_ERROR', err.message, 500);
    }
  });
}

// Exported for tests
export { validatePrefsShape };
