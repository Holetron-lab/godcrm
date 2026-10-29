// Human chat presence — the "online" dot next to a person's name.
//
//   GET  /conversations/:id/presence → { users: [{ user_id, last_activity_at }], server_time }
//   POST /conversations/:id/presence   { data: { client_id, active, idle_ms } }
//
// One lease per mounted chat tab (client_id), keyed by conversation and user.
// A lease lives PRESENCE_TTL_MS after its last activity (owner decision
// 2026-09-24: one minute). GET aggregates a user's tabs and never renews.
// active:false drops only that tab. Identity comes from the session; only
// conversation participants may read or publish, and agent principals are
// refused — this is a human signal.
//
// Storage is process memory: PM2 runs `godcrm` as a single fork instance
// (ecosystem.config.cjs), and presence is ephemeral by nature, so no table,
// no writes to the master, nothing to migrate. Bounded by real memberships
// × PRESENCE_MAX_TABS_PER_USER; expired leases are pruned on every access.

import {
  dbGet, isPostgres, apiLogger,
  success, error, badRequest, notFound, forbidden,
  requireAuth,
} from './chatShared.js';

export const PRESENCE_TTL_MS = 60_000;
export const PRESENCE_MAX_TABS_PER_USER = 8;
const CLIENT_ID_MAX_LENGTH = 64;

/** conversationId → userId → clientId → lastActivityMs */
let store = new Map();

/** Test seam. */
export function _resetPresenceStore() { store = new Map(); }

// Participant gate shared by both methods. Mirrors GET /conversations/:id:
// a non-participant learns nothing (404). Agents are refused (403).
async function gate(conversationId, userId) {
  const row = await dbGet(
    isPostgres()
      ? `SELECT u.user_type FROM conversation_participants cp JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = $1 AND cp.user_id = $2`
      : `SELECT u.user_type FROM conversation_participants cp JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = ? AND cp.user_id = ?`,
    [conversationId, userId]
  );
  if (!row) return { status: 404, message: 'Conversation not found' };
  if (row.user_type === 'agent') return { status: 403, message: 'Presence is for human users only' };
  return null;
}

function snapshot(conversationId, now) {
  const users = [];
  const byUser = store.get(conversationId);
  for (const [userId, tabs] of byUser ?? []) {
    for (const [clientId, at] of tabs) if (now - at >= PRESENCE_TTL_MS) tabs.delete(clientId);
    if (tabs.size === 0) { byUser.delete(userId); continue; }
    users.push({ user_id: userId, last_activity_at: new Date(Math.max(...tabs.values())).toISOString() });
  }
  if (byUser?.size === 0) store.delete(conversationId);
  users.sort((a, b) => a.user_id - b.user_id);
  return { users, server_time: new Date(now).toISOString() };
}

function upsertLease(conversationId, userId, clientId, at) {
  const byUser = store.get(conversationId) ?? new Map();
  const tabs = byUser.get(userId) ?? new Map();
  if (!tabs.has(clientId) && tabs.size >= PRESENCE_MAX_TABS_PER_USER) {
    let oldest;
    for (const [id, t] of tabs) if (oldest === undefined || t < tabs.get(oldest)) oldest = id;
    tabs.delete(oldest);
  }
  tabs.set(clientId, at);
  byUser.set(userId, tabs);
  store.set(conversationId, byUser);
}

function dropLease(conversationId, userId, clientId) {
  store.get(conversationId)?.get(userId)?.delete(clientId);
}

function parseConversationId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default function registerPresenceRoutes(router) {
  // Mounted under /api/v3/chat by index.js.
  router.get('/conversations/:id/presence', requireAuth, async (req, res) => {
    try {
      const conversationId = parseConversationId(req.params.id);
      if (!conversationId) return badRequest(res, 'Invalid conversation id');
      const denied = await gate(conversationId, req.user.userId);
      if (denied) return denied.status === 404 ? notFound(res, denied.message) : forbidden(res, denied.message);
      return success(res, snapshot(conversationId, Date.now()));
    } catch (err) {
      apiLogger.error({ err }, 'Error reading chat presence');
      return error(res, 'PRESENCE_ERROR', err.message, 500);
    }
  });

  router.post('/conversations/:id/presence', requireAuth, async (req, res) => {
    try {
      const conversationId = parseConversationId(req.params.id);
      if (!conversationId) return badRequest(res, 'Invalid conversation id');
      const data = req.body?.data;
      const clientId = data?.client_id;
      if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > CLIENT_ID_MAX_LENGTH) {
        return badRequest(res, 'client_id must be a string of 1..64 characters');
      }
      if (typeof data.active !== 'boolean') return badRequest(res, 'active must be a boolean');
      if (!Number.isInteger(data.idle_ms) || data.idle_ms < 0) return badRequest(res, 'idle_ms must be a non-negative integer');

      const userId = req.user.userId;
      const denied = await gate(conversationId, userId);
      if (denied) return denied.status === 404 ? notFound(res, denied.message) : forbidden(res, denied.message);

      const now = Date.now();
      if (data.active && data.idle_ms < PRESENCE_TTL_MS) upsertLease(conversationId, userId, clientId, now - data.idle_ms);
      else dropLease(conversationId, userId, clientId);
      return success(res, snapshot(conversationId, now));
    } catch (err) {
      apiLogger.error({ err }, 'Error updating chat presence');
      return error(res, 'PRESENCE_ERROR', err.message, 500);
    }
  });
}
