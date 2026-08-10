/**
 * Connector Token Refresh Scheduler — ADR-0028 §3.6.
 *
 * Periodic in-process worker (5-minute tick) that refreshes any active
 * connector whose `expires_at` is within the next 10 minutes and which has a
 * `refresh_token` in its encrypted payload.
 *
 * Pattern is borrowed from `CalendarSyncScheduler.js` — `setInterval` + a
 * single-flight `isRefreshing` lock. ADR-0019 background-jobs framework is
 * not yet built; once it lands this scheduler should migrate to a registered
 * job type.
 *
 * Behaviour:
 *   - 4xx from token endpoint → status='expired', last_error set, no further
 *     attempts on this tick.
 *   - 5xx → leave as-is; row will be picked up on the next tick.
 *   - Per-row paste-in-UI client_overrides survive refresh (preserved in
 *     payload re-encrypt).
 *   - custom_oauth2 reads token_url from row.custom_definition.
 *   - Audit log entry per attempt (success or failure).
 *
 * Manual trigger for tests:
 *   POST /api/v3/connectors/admin/refresh-tick   (admin-only)
 *
 * Module Lifecycle (ADR-0025): exports init/shutdown/health.
 */

import axios from 'axios';

import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import credentialVault from './CredentialVault.js';
import { getConnectorType } from './catalogue/index.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'connector_refresh_scheduler' });

const TICK_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 30 * 1000;
const REFRESH_HORIZON_SQL = "now() + interval '10 minutes'";
const BATCH_LIMIT = 50;

let intervalHandle = null;
let firstTickTimer = null;
let isRefreshing = false;

function resolveOAuthEnvForRefresh(type, customDefinition, decryptedPayload) {
  if (type.slug === 'custom_oauth2') {
    return {
      client_id: customDefinition?.client_id,
      client_secret: decryptedPayload?.client_secret,
      token_url: customDefinition?.token_url,
    };
  }
  const overrides = decryptedPayload?.client_overrides;
  if (overrides && overrides.client_id && overrides.client_secret) {
    return {
      client_id: overrides.client_id,
      client_secret: overrides.client_secret,
      token_url: type.token_url,
    };
  }
  if (type.client_env) {
    return {
      client_id: process.env[type.client_env.id],
      client_secret: process.env[type.client_env.secret],
      token_url: type.token_url,
    };
  }
  return { client_id: null, client_secret: null, token_url: null };
}

async function audit({ connectorId, spaceId, typeSlug, action, extra }) {
  try {
    const details = JSON.stringify({ space_id: spaceId, type_slug: typeSlug, ...(extra || {}) });
    await dbRun(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [null, action, 'space_connector', String(connectorId), details]
    );
  } catch (err) {
    log.warn({ err, action }, 'audit insert failed (non-blocking)');
  }
}

async function refreshOne(row) {
  const type = getConnectorType(row.type_slug);
  if (!type) {
    log.warn({ id: row.id, type: row.type_slug }, 'unknown type — skipping');
    return { id: row.id, status: 'skipped', reason: 'unknown_type' };
  }
  if (!type.refresh_supported) {
    return { id: row.id, status: 'skipped', reason: 'type_no_refresh' };
  }

  let decrypted;
  try {
    const blob = typeof row.encrypted_payload === 'string'
      ? JSON.parse(row.encrypted_payload)
      : row.encrypted_payload;
    decrypted = credentialVault.decrypt(blob);
  } catch (err) {
    log.error({ err, id: row.id }, 'refresh decrypt failed');
    await dbRun(
      `UPDATE space_connectors SET last_error = ?, updated_at = now() WHERE id = ?`,
      [`decrypt_failed:${err?.message || 'unknown'}`, row.id]
    );
    return { id: row.id, status: 'error', reason: 'decrypt_failed' };
  }

  if (!decrypted.refresh_token) {
    return { id: row.id, status: 'skipped', reason: 'no_refresh_token' };
  }

  const oauthEnv = resolveOAuthEnvForRefresh(type, row.custom_definition, decrypted);
  if (!oauthEnv.client_id || !oauthEnv.client_secret || !oauthEnv.token_url) {
    return { id: row.id, status: 'skipped', reason: 'creds_missing' };
  }

  try {
    const tokenRes = await axios.post(
      oauthEnv.token_url,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: decrypted.refresh_token,
        client_id: oauthEnv.client_id,
        client_secret: oauthEnv.client_secret,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10_000,
      }
    );
    const tok = tokenRes.data || {};
    const newPayload = {
      ...decrypted,
      access_token: tok.access_token || decrypted.access_token,
      refresh_token: tok.refresh_token || decrypted.refresh_token,
    };
    const expires_at = tok.expires_in
      ? new Date(Date.now() + Number(tok.expires_in) * 1000)
      : null;

    const enc = credentialVault.encrypt(newPayload);
    await dbRun(
      `UPDATE space_connectors
          SET encrypted_payload = ?::jsonb,
              status = 'active',
              expires_at = ?,
              last_refresh_at = now(),
              last_error = NULL,
              updated_at = now()
        WHERE id = ?`,
      [JSON.stringify(enc), expires_at, row.id]
    );
    await audit({
      connectorId: row.id,
      spaceId: row.space_id,
      typeSlug: row.type_slug,
      action: 'connector.scheduler_refresh',
      extra: { ok: true, expires_in: tok.expires_in || null },
    });
    return { id: row.id, status: 'refreshed' };
  } catch (err) {
    const status = err?.response?.status;
    const errStr = `refresh_failed${status ? `:${status}` : ''}:${err?.message?.slice(0, 80) || 'unknown'}`;
    if (status && status >= 400 && status < 500) {
      // Hard fail — refresh_token revoked / invalid.
      await dbRun(
        `UPDATE space_connectors
            SET status = 'expired',
                last_error = ?,
                updated_at = now()
          WHERE id = ?`,
        [errStr, row.id]
      );
      await audit({
        connectorId: row.id,
        spaceId: row.space_id,
        typeSlug: row.type_slug,
        action: 'connector.scheduler_refresh_failed',
        extra: { error: errStr, hard: true },
      });
      return { id: row.id, status: 'expired', reason: errStr };
    }
    // Soft fail — leave for next tick, just record last_error.
    await dbRun(
      `UPDATE space_connectors
          SET last_error = ?,
              updated_at = now()
        WHERE id = ?`,
      [errStr, row.id]
    );
    await audit({
      connectorId: row.id,
      spaceId: row.space_id,
      typeSlug: row.type_slug,
      action: 'connector.scheduler_refresh_failed',
      extra: { error: errStr, hard: false },
    });
    return { id: row.id, status: 'soft_fail', reason: errStr };
  }
}

/**
 * Run one tick: pick up to BATCH_LIMIT due rows, refresh each.
 * Returns aggregate stats. Safe to call manually from admin route.
 */
export async function runRefreshTick() {
  if (isRefreshing) {
    log.debug('refresh tick already in progress; skipping');
    return { skipped: true };
  }
  isRefreshing = true;
  const startedAt = Date.now();
  const stats = { picked: 0, refreshed: 0, expired: 0, soft_fail: 0, skipped: 0, error: 0 };
  try {
    const rows = await dbAll(
      `SELECT id, space_id, type_slug, custom_definition, encrypted_payload, expires_at
         FROM space_connectors
        WHERE status = 'active'
          AND expires_at IS NOT NULL
          AND expires_at < ${REFRESH_HORIZON_SQL}
        ORDER BY expires_at ASC
        LIMIT ?`,
      [BATCH_LIMIT]
    );
    stats.picked = rows.length;
    for (const row of rows) {
      const r = await refreshOne(row);
      if (r.status === 'refreshed') stats.refreshed++;
      else if (r.status === 'expired') stats.expired++;
      else if (r.status === 'soft_fail') stats.soft_fail++;
      else if (r.status === 'error') stats.error++;
      else stats.skipped++;
    }
  } catch (err) {
    log.error({ err }, 'refresh tick failed');
  } finally {
    isRefreshing = false;
  }
  const duration_ms = Date.now() - startedAt;
  if (stats.picked > 0) {
    log.info({ ...stats, duration_ms }, 'connector refresh tick complete');
  } else {
    log.debug({ ...stats, duration_ms }, 'connector refresh tick (idle)');
  }
  return { ...stats, duration_ms };
}

// ─── Module Lifecycle ───────────────────────────────────────────────

export async function init() {
  if (intervalHandle) return health();
  log.info(
    { intervalMs: TICK_INTERVAL_MS, firstDelayMs: FIRST_TICK_DELAY_MS },
    'starting connector refresh scheduler'
  );
  firstTickTimer = setTimeout(() => {
    runRefreshTick().catch((err) => log.error({ err }, 'first tick failed'));
  }, FIRST_TICK_DELAY_MS);
  intervalHandle = setInterval(() => {
    runRefreshTick().catch((err) => log.error({ err }, 'periodic tick failed'));
  }, TICK_INTERVAL_MS);
  // Don't keep event loop alive on graceful shutdown.
  intervalHandle.unref?.();
  firstTickTimer.unref?.();
  return health();
}

export async function shutdown() {
  if (firstTickTimer) {
    clearTimeout(firstTickTimer);
    firstTickTimer = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('connector refresh scheduler stopped');
  }
}

export function health() {
  return {
    ok: !!intervalHandle,
    running: !!intervalHandle,
    isRefreshing,
    intervalMs: TICK_INTERVAL_MS,
  };
}

export default { init, shutdown, health, runRefreshTick };
