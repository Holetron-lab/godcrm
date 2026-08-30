// ADR-183 Block F — Registration policy surface (F1 resolver + F2 instance default).
//
// Two-layer model (Addendum A): an anonymous visitor at /auth/register is in no
// space yet, so the box's INSTANCE DEFAULT is the front-door authority. A signup
// bound to a space may narrow it via that space's `settings.registration` sub-key
// (stored by Block F4 through the existing updateSpace allowedFields — no migration).
//
// Pure + synchronous: no DB, no I/O. Safe to call on the registration hot path and
// trivially unit-testable. Precedence: per-space override → instance default →
// hard-coded safe fallback.

// Safe fallback if config and space context both go missing — fail CLOSED
// (viewer, invite-only, no self-serve spaces) rather than open the front door.
const SAFE_FALLBACK = Object.freeze({
  default_role: 'viewer',
  signup_mode: 'invite',
  allow_self_space_create: false,
  landing_space: null,
});

// Named presets. `standard` reproduces pre-ADR-183 behaviour byte-for-byte
// (default_role 'user', open signup, self-serve spaces) so existing boxes are
// unchanged. `community` is what a fresh community box (e.g. pro.hltrn.cc) ships.
export const REGISTRATION_PRESETS = Object.freeze({
  standard:  Object.freeze({ default_role: 'user',   signup_mode: 'open', allow_self_space_create: true,  landing_space: null }),
  community: Object.freeze({ default_role: 'viewer', signup_mode: 'open', allow_self_space_create: false, landing_space: null }),
});

// F2 — instance default, selected by the REGISTRATION_DEFAULT env var (a preset
// NAME). Unset/unknown → 'standard', so a box with no config behaves as before.
// Read at call time (not module load) so tests and hot-reconfig see current env.
export function getInstanceDefault() {
  const name = (process.env.REGISTRATION_DEFAULT || 'standard').trim().toLowerCase();
  return REGISTRATION_PRESETS[name] || REGISTRATION_PRESETS.standard;
}

const VALID_ROLES = new Set(['owner', 'admin', 'editor', 'user', 'viewer']);
const VALID_MODES = new Set(['open', 'invite', 'closed']);

// Keep only whitelisted, well-typed keys from an untrusted per-space policy blob.
// spaces.settings is owner-editable JSON — treat it as a trust boundary.
function sanitizeOverride(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  if (VALID_ROLES.has(raw.default_role)) out.default_role = raw.default_role;
  if (VALID_MODES.has(raw.signup_mode)) out.signup_mode = raw.signup_mode;
  if (typeof raw.allow_self_space_create === 'boolean') out.allow_self_space_create = raw.allow_self_space_create;
  if (typeof raw.landing_space === 'string' || typeof raw.landing_space === 'number') out.landing_space = raw.landing_space;
  return out;
}

/**
 * F1 — resolve the effective registration policy.
 * @param {object|null} spaceContext - a space row (or `{ settings: {...} }`) when the
 *   signup is bound to a space; null/omitted for the anonymous front door.
 * @returns {{default_role:string, signup_mode:string, allow_self_space_create:boolean, landing_space:(string|number|null)}}
 *
 * NOTE (enforcement scope, ADR-183 Block F): `default_role` is enforced today
 * (registerUser reads it). `signup_mode` / `allow_self_space_create` / `landing_space`
 * are resolved and persisted per the architect-locked shape, but their route-level
 * enforcement (mode gating, self-space gate, landing redirect = F4/F6) is a
 * follow-up — the existing role-based viewer gate in spaces/crud.js still stands.
 */
export function resolveRegistrationPolicy(spaceContext = null) {
  const override = sanitizeOverride(spaceContext?.settings?.registration);
  return { ...SAFE_FALLBACK, ...getInstanceDefault(), ...override };
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-188 F1 — runtime policy layer (owner-editable, `_app_settings.registration`)
//
// The pure resolver above stays pure/sync (front-door hot path, unit-tested).
// This section adds ONE higher-priority tier on top of it: a runtime blob the
// space-11 owner writes from Settings (F1) — so the box's registration policy is
// flippable from the UI without a redeploy. Precedence, low → high:
//   SAFE_FALLBACK  <  env preset (getInstanceDefault)  <  runtime blob  <  per-space
// Cached 60 s in-process, evicted cluster-wide via pg_notify on write (like the
// secrets vault, ADR-0040). The FE contract slice is `{signup_mode, default_role,
// auto_join}` (src/features/registration/registration.types.ts) — extra pure-resolver
// keys (allow_self_space_create/landing_space) are NOT part of the runtime surface.
// ─────────────────────────────────────────────────────────────────────────

import pg from 'pg';
import { apiLogger } from '../utils/logger.js';

const rlog = apiLogger.child({ module: 'registration_policy' });

export const RUNTIME_SETTINGS_KEY = 'registration';
const NOTIFY_CHANNEL = 'registration_policy_invalidate';
const CACHE_TTL_MS = 60_000;

const VALID_DEFAULT_ROLES = new Set(['user', 'viewer']);       // FE front-door surface only
const VALID_ACCESS_LEVELS = new Set(['viewer', 'editor', 'admin']);

/**
 * Validate + normalise an untrusted runtime registration blob to the frozen FE
 * contract. Trust boundary: this comes from an owner PUT body. Unknown keys are
 * dropped; malformed entries are skipped rather than throwing.
 * @returns {{signup_mode:string, default_role:string, auto_join:Array<{space_id:number, access_level:string}>}}
 */
export function sanitizeRuntimeConfig(raw) {
  const out = { signup_mode: undefined, default_role: undefined, auto_join: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (VALID_MODES.has(raw.signup_mode)) out.signup_mode = raw.signup_mode;
  if (VALID_DEFAULT_ROLES.has(raw.default_role)) out.default_role = raw.default_role;
  if (Array.isArray(raw.auto_join)) {
    const seen = new Set();
    for (const e of raw.auto_join) {
      const space_id = Number(e?.space_id);
      if (!Number.isInteger(space_id) || space_id <= 0) continue;
      if (!VALID_ACCESS_LEVELS.has(e?.access_level)) continue;
      if (seen.has(space_id)) continue;                          // de-dupe, first wins
      seen.add(space_id);
      out.auto_join.push({ space_id, access_level: e.access_level });
    }
  }
  return out;
}

// ─── Single-value 60s cache ────────────────────────────────────────────────
let _cache = null;   // { value: object|null, expiresAt: number }

function _fetchRuntimeConfig() {
  // Lazy import keeps this module loadable in the pure unit test (no DB).
  return import('../database/connection.js').then(async ({ dbGet, safeJsonParse }) => {
    const row = await dbGet(`SELECT value FROM _app_settings WHERE key = ?`, [RUNTIME_SETTINGS_KEY]);
    const parsed = safeJsonParse(row?.value, null);
    return parsed ? sanitizeRuntimeConfig(parsed) : null;
  });
}

// Test seam — swap the fetcher without a DB.
let fetchRuntimeConfig = _fetchRuntimeConfig;
export function __setRuntimeFetcher(fn) { fetchRuntimeConfig = fn || _fetchRuntimeConfig; }
export function __resetRuntimeFetcher() { fetchRuntimeConfig = _fetchRuntimeConfig; }

async function loadRuntimeConfigCached() {
  if (_cache && _cache.expiresAt > Date.now()) return _cache.value;
  let value = null;
  try {
    value = await fetchRuntimeConfig();
  } catch (err) {
    rlog.warn({ err }, 'runtime registration policy fetch failed — falling back to env preset');
    value = null;
  }
  _cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** Drop the in-process cache immediately (called locally on write + by the LISTEN client). */
export function invalidateRegistrationCache() { _cache = null; }

/**
 * F1 — effective registration policy including the runtime blob.
 * Async superset of `resolveRegistrationPolicy`; used by AuthService so an owner's
 * saved `default_role` (and, once F2/F3 land, `signup_mode`/`auto_join`) take effect.
 * @param {object|null} spaceContext
 * @returns {Promise<{default_role:string, signup_mode:string, auto_join:Array, allow_self_space_create:boolean, landing_space:(string|number|null)}>}
 */
export async function getEffectiveRegistrationPolicy(spaceContext = null) {
  const runtime = await loadRuntimeConfigCached();
  const override = sanitizeOverride(spaceContext?.settings?.registration);
  const runtimeClean = {};
  if (runtime) {
    if (runtime.signup_mode !== undefined) runtimeClean.signup_mode = runtime.signup_mode;
    if (runtime.default_role !== undefined) runtimeClean.default_role = runtime.default_role;
    if (Array.isArray(runtime.auto_join)) runtimeClean.auto_join = runtime.auto_join;
  }
  return {
    auto_join: [],
    ...SAFE_FALLBACK,
    ...getInstanceDefault(),
    ...runtimeClean,
    ...override,
  };
}

/** Fire cluster-wide cache eviction; best-effort (degrades to local evict + TTL). */
export async function notifyRegistrationInvalidate() {
  try {
    const { dbRun } = await import('../database/connection.js');
    await dbRun(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, '']);
  } catch (err) {
    rlog.warn({ err }, 'notifyRegistrationInvalidate failed — local-only eviction');
    invalidateRegistrationCache();
  }
}

// ─── LISTEN client (cluster-wide eviction, mirrors resolveChatPrefs) ────────
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

/** Best-effort long-lived LISTEN client; if it fails, eviction degrades to 60s TTL. */
export async function startRegistrationPolicyListener() {
  if (_listenClient) return _listenClient;
  const client = new pg.Client(buildConnectionConfig());
  await client.connect();
  client.on('notification', (msg) => {
    if (msg.channel !== NOTIFY_CHANNEL) return;
    invalidateRegistrationCache();
    rlog.debug('registration policy cache invalidated via NOTIFY');
  });
  client.on('error', (err) => {
    rlog.error({ err }, 'registration policy LISTEN client error — eviction degraded to TTL-only');
  });
  await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
  _listenClient = client;
  rlog.info({ channel: NOTIFY_CHANNEL }, 'registration policy invalidation listener started');
  return client;
}

/** Stop the LISTEN client; safe to call multiple times. */
export async function stopRegistrationPolicyListener() {
  if (!_listenClient) return;
  try { await _listenClient.end(); } catch { /* ignore */ }
  _listenClient = null;
}
