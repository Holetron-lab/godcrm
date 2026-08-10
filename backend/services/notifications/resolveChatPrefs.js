// resolveChatPrefs.js — ADR-0064 WP-A.
//
// 4-layer hierarchy resolver for chat notification preferences.
// Order (private overrides general): per-chat → personal → space → global → DEFAULTS.
//
// Storage:
//   1. conversation_participants.notification_overrides   (JSONB, migration 064)
//   2. user_settings.setting_value_encrypted              (setting_key='chat_notifications')
//   3. spaces.notification_defaults                       (JSONB, migration 064)
//   4. _app_settings.value                                (key='chat_notifications_global', seeded by migration 064)
//
// Merge semantics: declared-keys-win. A layer "declares" a key when it sets
// a non-null/non-undefined value for it. Inner layers win over outer layers
// ONLY for keys they declare; undeclared keys fall through to the next layer.
//
// Cache: in-process Map, 60s TTL, keyed `(user_id, conversation_id)`.
// Eviction: PG NOTIFY channel `chat_prefs_invalidate` with payload
// `{user_id?, space_id?, conversation_id?}` from each PUT endpoint.
//   - conversation_id set → evict entries with that conv (any user)
//   - user_id set         → evict entries with that user (any conv)
//   - space_id set        → clear cache (rare; admin-driven; no userId→space map)
//   - empty payload       → clear cache (manual invalidate)

import pg from 'pg';
import { dbGet, safeJsonParse } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'chat_prefs_resolver' });

const CACHE_TTL_MS = 60_000;
const NOTIFY_CHANNEL = 'chat_prefs_invalidate';
const CACHE_SIZE_LIMIT = 10_000;

export const CHAT_PREFS_DEFAULTS = Object.freeze({
  enabled: true,
  sound_enabled: true,
  sound_volume: 0.6,
  humans: { sound: true, popup: true, badge: true },
  agents: { sound: true, popup: true, badge: true },
});

const TOP_SCALARS = ['enabled', 'sound_enabled', 'sound_volume'];
const NESTED_BLOCKS = ['humans', 'agents'];
const NESTED_KEYS = ['sound', 'popup', 'badge'];

// ─── Pure merge (testable without DB) ───────────────────────────────────────

/**
 * Walk layers in priority order; first layer that DECLARES a key wins.
 * A declaration is a non-undefined, non-null value at the right path.
 *
 * @param {...Object|null} layers  Layers from MOST-private to LEAST-private.
 *                                 Last entry should be CHAT_PREFS_DEFAULTS to guarantee a value.
 * @returns {Object}  Fully-populated prefs object — no nulls, no undefineds.
 */
export function mergeDeclared(...layers) {
  const out = {};

  // Top-level scalars
  for (const k of TOP_SCALARS) {
    for (const layer of layers) {
      if (layer && layer[k] !== undefined && layer[k] !== null) {
        out[k] = layer[k];
        break;
      }
    }
  }

  // Nested per-sender-type blocks (humans, agents) — merge each key independently
  // so a layer that declares only `humans.popup` doesn't shadow another layer's
  // `humans.sound`.
  for (const block of NESTED_BLOCKS) {
    out[block] = {};
    for (const k of NESTED_KEYS) {
      for (const layer of layers) {
        const v = layer && layer[block] ? layer[block][k] : undefined;
        if (v !== undefined && v !== null) {
          out[block][k] = v;
          break;
        }
      }
    }
  }

  return out;
}

// ─── DB fetchers (override-able for tests) ─────────────────────────────────

async function _fetchPerChat(userId, conversationId) {
  if (!userId || !conversationId) return null;
  const row = await dbGet(
    `SELECT notification_overrides FROM conversation_participants
     WHERE user_id = $1 AND conversation_id = $2`,
    [userId, conversationId]
  );
  return safeJsonParse(row?.notification_overrides, null);
}

async function _fetchPersonal(userId) {
  if (!userId) return null;
  const row = await dbGet(
    `SELECT setting_value_encrypted AS value FROM user_settings
     WHERE user_id = $1 AND setting_key = 'chat_notifications'`,
    [userId]
  );
  return safeJsonParse(row?.value, null);
}

async function _fetchSpace(conversationId) {
  if (!conversationId) return null;
  // `conversations.space_id` references `spaces.id` directly (schema verified
  // 2026-05-16 — see migration 010 + ADR-0024). DMs have NULL space_id.
  const row = await dbGet(
    `SELECT s.notification_defaults AS prefs
       FROM conversations c
       JOIN spaces s ON s.id = c.space_id
      WHERE c.id = $1`,
    [conversationId]
  );
  return safeJsonParse(row?.prefs, null);
}

async function _fetchGlobal() {
  const row = await dbGet(
    `SELECT value FROM _app_settings WHERE key = 'chat_notifications_global'`
  );
  return safeJsonParse(row?.value, null);
}

// Injection points for unit tests — keep module-default fetchers swappable.
let fetchPerChat = _fetchPerChat;
let fetchPersonal = _fetchPersonal;
let fetchSpace = _fetchSpace;
let fetchGlobal = _fetchGlobal;

/** Test-only helper. */
export function __setFetchers(overrides) {
  if (overrides.perChat) fetchPerChat = overrides.perChat;
  if (overrides.personal) fetchPersonal = overrides.personal;
  if (overrides.space) fetchSpace = overrides.space;
  if (overrides.global) fetchGlobal = overrides.global;
}

/** Test-only helper. */
export function __resetFetchers() {
  fetchPerChat = _fetchPerChat;
  fetchPersonal = _fetchPersonal;
  fetchSpace = _fetchSpace;
  fetchGlobal = _fetchGlobal;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

/** @type {Map<string, { value: object, expiresAt: number }>} */
const _cache = new Map();

function cacheKey(userId, conversationId) {
  return `${userId}:${conversationId}`;
}

function cacheGet(userId, conversationId) {
  const k = cacheKey(userId, conversationId);
  const hit = _cache.get(k);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _cache.delete(k);
    return null;
  }
  return hit.value;
}

function cacheSet(userId, conversationId, value) {
  if (_cache.size >= CACHE_SIZE_LIMIT) {
    // Cheap eviction: drop the oldest entry (Map preserves insertion order).
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
  _cache.set(cacheKey(userId, conversationId), {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Evict cache entries matching a scope.
 * @param {object} scope  { user_id?, space_id?, conversation_id? }
 *                        Also accepts `{ scope: 'global' }` (semantic alias for
 *                        a full clear, used by the admin/global PUT route).
 *                        Empty object → clear entire cache.
 */
export function invalidateCache(scope = {}) {
  if (!scope || Object.keys(scope).length === 0) {
    _cache.clear();
    return;
  }
  // Semantic alias / unknown scope: any caller saying "global" → wipe all.
  if (scope.scope === 'global') {
    _cache.clear();
    return;
  }
  // For space_id we have no userId→space map in-process — clear all.
  if (scope.space_id) {
    _cache.clear();
    return;
  }
  const matchUser = scope.user_id != null ? String(scope.user_id) : null;
  const matchConv = scope.conversation_id != null ? String(scope.conversation_id) : null;

  // If the caller passed only unrecognised keys, fail safe by clearing.
  if (!matchUser && !matchConv) {
    _cache.clear();
    return;
  }

  for (const k of _cache.keys()) {
    const [uid, cid] = k.split(':');
    if (matchUser && uid === matchUser) { _cache.delete(k); continue; }
    if (matchConv && cid === matchConv) { _cache.delete(k); continue; }
  }
}

/** Test-only helper. */
export function __cacheSize() { return _cache.size; }
/** Test-only helper. */
export function __cacheClear() { _cache.clear(); }

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve effective chat notification preferences for a (user, conversation).
 *
 * @param {object} args
 * @param {number} args.userId
 * @param {number} args.conversationId
 * @returns {Promise<object>}  Flattened prefs object — guaranteed non-null fields.
 */
export async function resolveChatPrefs({ userId, conversationId }) {
  const cached = cacheGet(userId, conversationId);
  if (cached) return cached;

  const [perChat, personal, spacePrefs, globalPrefs] = await Promise.all([
    fetchPerChat(userId, conversationId),
    fetchPersonal(userId),
    fetchSpace(conversationId),
    fetchGlobal(),
  ]);

  const resolved = mergeDeclared(perChat, personal, spacePrefs, globalPrefs, CHAT_PREFS_DEFAULTS);
  cacheSet(userId, conversationId, resolved);
  return resolved;
}

/**
 * Fire pg_notify on the cache-invalidate channel. Wraps the dbRun shape
 * so callers can `await notifyInvalidate({ user_id: 5 })` from any PUT.
 *
 * @param {object} scope { user_id?, space_id?, conversation_id? }
 */
export async function notifyInvalidate(scope = {}) {
  try {
    const { dbRun } = await import('../../database/connection.js');
    await dbRun(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, JSON.stringify(scope || {})]);
  } catch (err) {
    log.warn({ err, scope }, 'notifyInvalidate failed — local-only eviction');
    // Still evict locally so the originating process sees fresh data.
    invalidateCache(scope);
  }
}

// ─── LISTEN client (cluster-wide eviction) ─────────────────────────────────

/** @type {pg.Client|null} */
let _listenClient = null;

function buildConnectionConfig() {
  if (process.env.POSTGRES_URL) return { connectionString: process.env.POSTGRES_URL };
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'godcrm',
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

/**
 * Start a dedicated long-lived LISTEN client. Best-effort: if it fails,
 * eviction degrades to local-only + 60s TTL.
 */
export async function startInvalidationListener() {
  if (_listenClient) return _listenClient;
  const client = new pg.Client(buildConnectionConfig());
  await client.connect();

  client.on('notification', (msg) => {
    if (msg.channel !== NOTIFY_CHANNEL) return;
    let scope = {};
    try { scope = msg.payload ? JSON.parse(msg.payload) : {}; }
    catch { scope = {}; }
    invalidateCache(scope);
    log.debug({ scope, cacheSize: _cache.size }, 'chat_prefs cache invalidated via NOTIFY');
  });
  client.on('error', (err) => {
    log.error({ err }, 'chat_prefs LISTEN client error — eviction degraded to TTL-only');
  });

  await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
  _listenClient = client;
  log.info({ channel: NOTIFY_CHANNEL }, 'chat_prefs invalidation listener started');
  return client;
}

/** Stop the LISTEN client; safe to call multiple times. */
export async function stopInvalidationListener() {
  if (!_listenClient) return;
  try { await _listenClient.end(); } catch { /* ignore */ }
  _listenClient = null;
}

export default {
  CHAT_PREFS_DEFAULTS,
  mergeDeclared,
  resolveChatPrefs,
  notifyInvalidate,
  invalidateCache,
  startInvalidationListener,
  stopInvalidationListener,
};
