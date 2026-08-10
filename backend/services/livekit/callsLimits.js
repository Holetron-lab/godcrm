/**
 * LiveKit calls capacity limits — ADR-0059 AMEND-3 §4.9 (cheap subset).
 *
 * Two knobs, both read from process.env at request time:
 *   CALLS_MAX_CONCURRENT              (default 10) — max simultaneous rooms
 *   CALLS_MAX_PARTICIPANTS_PER_ROOM   (default 20) — max identities per room
 *
 * Migration to `_settings` + pg_notify hot-reload is deferred post-D14
 * (2026-05-18) per AMEND-3.
 */

export const DEFAULT_CALLS_MAX_CONCURRENT = 10;
export const DEFAULT_CALLS_MAX_PARTICIPANTS_PER_ROOM = 20;

// 429 body shape per orchestrator brief.
export const CONCURRENT_CAP_ERROR_CODE = 'concurrent_room_cap';

// Internal — bounded so an operator typo (`9999`) doesn't melt the box.
const ABSOLUTE_MAX_CONCURRENT = 200;
const ABSOLUTE_MAX_PARTICIPANTS = 200;

function clampInt(raw, fallback, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  if (n > max) return max;
  return n;
}

/**
 * Current effective limits. Cheap to call — re-reads env so SIGHUP-style
 * `.env`+pm2 restart picks up changes without touching this module.
 */
export function getCallsLimits() {
  return {
    maxConcurrent: clampInt(
      process.env.CALLS_MAX_CONCURRENT,
      DEFAULT_CALLS_MAX_CONCURRENT,
      ABSOLUTE_MAX_CONCURRENT,
    ),
    maxParticipantsPerRoom: clampInt(
      process.env.CALLS_MAX_PARTICIPANTS_PER_ROOM,
      DEFAULT_CALLS_MAX_PARTICIPANTS_PER_ROOM,
      ABSOLUTE_MAX_PARTICIPANTS,
    ),
    // Deferred entirely per AMEND-3 — exposed as null so the UI tab can render
    // disabled `coming soon` inputs without a separate endpoint.
    maxDurationMinutes: null,
    retentionDays: null,
  };
}

/**
 * Resolve the HTTP host LiveKit's Twirp endpoint lives on.
 * `LIVEKIT_URL` is the WebSocket URL the client uses (e.g.
 * `wss://crm.hltrn.cc/livekit`) — Twirp shares the same origin/path prefix
 * over http(s), so we flip the scheme.
 */
export function livekitTwirpHost() {
  const raw = process.env.LIVEKIT_URL || 'ws://<RELAY_IP>:7880';
  return raw.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
}
