/**
 * OIDC Fleet Client Registry — ADR-179 (D2/D3).
 *
 * Single choke-point for resolving an OIDC client and authenticating it.
 * Today it reads the `oidc_clients` table (extended by migration 078 with the
 * fleet columns). D2 will move the backing store to an Admin-Space universal
 * table behind THIS SAME interface — the provider (routes/oauth/index.js) never
 * touches the storage directly, so the swap is transparent.
 *
 * Secret handling (D3): the fleet model never stores a usable plaintext secret
 * in the row. It stores `secret_ref`, a vault key resolved via getSecret() at
 * verification time. The legacy `client_secret` column is still honoured as a
 * fallback so existing WorkAdventure / Penpot rows keep working until they are
 * re-provisioned into the vault.
 */

import crypto from 'crypto';
import { dbGet, safeJsonParse } from '../../database/connection.js';
import { getSecret } from '../secrets/getSecret.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'oidc_client_registry' });

function parseList(value, fallback = []) {
  const parsed = safeJsonParse(value, null);
  return Array.isArray(parsed) ? parsed : fallback;
}

/**
 * A client is "public" (no secret, PKCE mandatory) when it explicitly declares
 * token_endpoint_auth_method='none', or when it has neither a secret_ref nor a
 * legacy client_secret configured.
 * @param {Object} row - Raw oidc_clients row
 * @returns {boolean}
 */
function isPublicClient(row) {
  if (row.token_endpoint_auth_method === 'none') return true;
  return !row.secret_ref && !row.client_secret;
}

/**
 * Fetch an active client by client_id, with fleet fields normalised.
 * Inactive rows (is_active = 0/false) resolve to null — same as "unknown".
 * @param {string} clientId
 * @returns {Promise<Object|null>}
 */
export async function getClient(clientId) {
  if (!clientId) return null;
  const row = await dbGet('SELECT * FROM oidc_clients WHERE client_id = ?', [clientId]);
  if (!row) return null;
  // is_active is stored as integer 1/0; a missing value (legacy) counts active.
  if (row.is_active === 0 || row.is_active === false) return null;

  return {
    ...row,
    redirect_uris: parseList(row.redirect_uris),
    allowed_origins: parseList(row.allowed_origins),
    allowed_scopes: parseList(row.allowed_scopes, ['openid', 'profile', 'email']),
    login_tier: row.login_tier || 'oidc',
    is_public: isPublicClient(row),
  };
}

/**
 * Exact-match redirect_uri check against the client's registered list.
 * @param {Object} client - Normalised client (from getClient)
 * @param {string} redirectUri
 * @returns {boolean}
 */
export function isRedirectUriAllowed(client, redirectUri) {
  if (!client || !redirectUri) return false;
  return client.redirect_uris.includes(redirectUri);
}

/**
 * Resolve the client's configured secret: vault (secret_ref) first, then the
 * legacy `client_secret` column. Returns null for public clients / when nothing
 * is configured.
 * @param {Object} client - Normalised client (from getClient)
 * @returns {Promise<string|null>}
 */
export async function resolveClientSecret(client) {
  if (!client) return null;
  if (client.secret_ref) {
    const fromVault = await getSecret(client.secret_ref);
    if (fromVault) return fromVault;
    log.warn(
      { clientId: client.client_id, secretRef: client.secret_ref },
      'secret_ref is set but vault returned null — check the _secrets vault'
    );
  }
  return client.client_secret || null;
}

/**
 * Constant-time string comparison that never throws on length mismatch.
 * @returns {boolean}
 */
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Authenticate a CONFIDENTIAL client at the token endpoint.
 *
 * Public clients do NOT authenticate here — they prove possession via PKCE at
 * the token endpoint, so call sites must branch on `client.is_public` first.
 *
 * Returns true only when a configured secret exists AND the caller supplied a
 * matching one (constant-time). This deliberately closes the historical bypass
 * where omitting client_secret skipped the check for a confidential client.
 * @param {Object} client - Normalised client (from getClient)
 * @param {string} providedSecret
 * @returns {Promise<boolean>}
 */
export async function verifyClientSecret(client, providedSecret) {
  const configured = await resolveClientSecret(client);
  if (!configured) return false;     // a confidential client must have a secret
  if (!providedSecret) return false; // ...and the caller must actually send it
  return timingSafeEqualStr(providedSecret, configured);
}

export default {
  getClient,
  isRedirectUriAllowed,
  resolveClientSecret,
  verifyClientSecret,
};
