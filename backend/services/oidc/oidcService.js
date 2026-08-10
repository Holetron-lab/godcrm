/**
 * OIDC Service - ADR-063: WorkAdventure Integration
 * Handles OIDC authentication flow for WorkAdventure
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { dbGet, dbRun, dbAll } from '../../database/connection.js';
import { authLogger } from '../../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';
const OIDC_ISSUER = process.env.OIDC_ISSUER || 'https://crm.hltrn.cc';
const AUTH_CODE_TTL = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Generate a secure random string
 * @param {number} length - Length of the string
 * @returns {string} Random string
 */
function generateSecureToken(length = 32) {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Hash a token for storage
 * @param {string} token - Token to hash
 * @returns {string} Hashed token
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Get OIDC client by client_id
 * @param {string} clientId - Client ID
 * @returns {Promise<Object|null>} Client object or null
 */
export async function getClient(clientId) {
  const client = await dbGet(
    'SELECT * FROM oidc_clients WHERE client_id = ? AND is_active = 1',
    [clientId]
  );
  
  if (client) {
    client.redirect_uris = JSON.parse(client.redirect_uris || '[]');
    client.allowed_scopes = JSON.parse(client.allowed_scopes || '["openid", "profile", "email"]');
  }
  
  return client;
}

/**
 * Validate redirect URI against client's allowed URIs
 * @param {Object} client - Client object
 * @param {string} redirectUri - Redirect URI to validate
 * @returns {boolean} True if valid
 */
export function validateRedirectUri(client, redirectUri) {
  return client.redirect_uris.includes(redirectUri);
}

/**
 * Validate client credentials
 * @param {string} clientId - Client ID
 * @param {string} clientSecret - Client secret
 * @returns {Promise<Object|null>} Client object if valid, null otherwise
 */
export async function validateClientCredentials(clientId, clientSecret) {
  const client = await dbGet(
    'SELECT * FROM oidc_clients WHERE client_id = ? AND client_secret = ? AND is_active = 1',
    [clientId, clientSecret]
  );
  
  if (client) {
    client.redirect_uris = JSON.parse(client.redirect_uris || '[]');
    client.allowed_scopes = JSON.parse(client.allowed_scopes || '["openid", "profile", "email"]');
  }
  
  return client;
}

/**
 * Create authorization code
 * @param {string} clientId - Client ID
 * @param {number} userId - User ID
 * @param {string} redirectUri - Redirect URI
 * @param {string} scope - Requested scope
 * @param {string} state - State parameter
 * @param {string} nonce - Nonce parameter
 * @returns {Promise<string>} Authorization code
 */
export async function createAuthorizationCode(clientId, userId, redirectUri, scope, state, nonce) {
  const code = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL).toISOString();
  
  await dbRun(
    `INSERT INTO oidc_auth_codes (code, client_id, user_id, redirect_uri, scope, state, nonce, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, clientId, userId, redirectUri, scope, state, nonce, expiresAt]
  );
  
  authLogger.debug({ clientId, userId }, 'Created authorization code');
  
  return code;
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code
 * @param {string} clientId - Client ID
 * @param {string} redirectUri - Redirect URI
 * @returns {Promise<Object|null>} Token response or null if invalid
 */
export async function exchangeAuthorizationCode(code, clientId, redirectUri) {
  // Find and validate the code
  const authCode = await dbGet(
    `SELECT * FROM oidc_auth_codes 
     WHERE code = ? AND client_id = ? AND redirect_uri = ? AND used = 0 AND expires_at > datetime('now')`,
    [code, clientId, redirectUri]
  );
  
  if (!authCode) {
    authLogger.warn({ clientId }, 'Invalid or expired authorization code');
    return null;
  }
  
  // Mark code as used
  await dbRun('UPDATE oidc_auth_codes SET used = 1 WHERE id = ?', [authCode.id]);
  
  // Get user info including role
  const user = await dbGet(
    'SELECT id, email, name, avatar, role FROM users WHERE id = ?',
    [authCode.user_id]
  );

  if (!user) {
    authLogger.error({ userId: authCode.user_id }, 'User not found for auth code');
    return null;
  }

  // Build tags for WorkAdventure Map Editor
  // Global admins/owners get editor tag; space-specific tags are added via member API
  const tags = [];
  if (user.role === 'admin' || user.role === 'owner') {
    tags.push('admin', 'editor');
  }
  if (user.role === 'user') {
    tags.push('member');
  }

  // Generate access token
  const accessToken = generateSecureToken(32);
  const accessTokenHash = hashToken(accessToken);
  const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL).toISOString();
  
  await dbRun(
    `INSERT INTO oidc_access_tokens (token_hash, client_id, user_id, scope, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [accessTokenHash, clientId, user.id, authCode.scope, accessTokenExpiresAt]
  );
  
  // Generate ID token (JWT)
  const idToken = jwt.sign(
    {
      iss: OIDC_ISSUER,
      sub: String(user.id),
      aud: clientId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      nonce: authCode.nonce,
      email: user.email,
      name: user.name,
      picture: user.avatar,
      // WorkAdventure Map Editor tags (ADR-063)
      // Global tags here; space-specific editor tag added via /member API
      tags: tags
    },
    JWT_SECRET,
    { algorithm: 'HS256' } // Using HS256 for simplicity; RS256 would require key management
  );
  
  authLogger.info({ clientId, userId: user.id }, 'Exchanged authorization code for tokens');
  
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL / 1000),
    id_token: idToken,
    scope: authCode.scope
  };
}

/**
 * Validate access token and get user info
 * @param {string} accessToken - Access token
 * @returns {Promise<Object|null>} User info or null if invalid
 */
export async function validateAccessToken(accessToken) {
  const tokenHash = hashToken(accessToken);
  
  const tokenRecord = await dbGet(
    `SELECT * FROM oidc_access_tokens 
     WHERE token_hash = ? AND revoked = 0 AND expires_at > datetime('now')`,
    [tokenHash]
  );
  
  if (!tokenRecord) {
    return null;
  }
  
  const user = await dbGet(
    'SELECT id, email, name, avatar, role FROM users WHERE id = ?',
    [tokenRecord.user_id]
  );
  
  if (!user) {
    return null;
  }
  
  return {
    sub: String(user.id),
    email: user.email,
    email_verified: true,
    name: user.name,
    picture: user.avatar,
    role: user.role
  };
}

/**
 * Revoke access token
 * @param {string} accessToken - Access token to revoke
 * @returns {Promise<boolean>} True if revoked
 */
export async function revokeAccessToken(accessToken) {
  const tokenHash = hashToken(accessToken);
  
  const result = await dbRun(
    'UPDATE oidc_access_tokens SET revoked = 1 WHERE token_hash = ?',
    [tokenHash]
  );
  
  return result.changes > 0;
}

/**
 * Clean up expired codes and tokens
 * @returns {Promise<void>}
 */
export async function cleanupExpiredTokens() {
  await dbRun("DELETE FROM oidc_auth_codes WHERE expires_at < datetime('now')");
  await dbRun("DELETE FROM oidc_access_tokens WHERE expires_at < datetime('now')");
  authLogger.debug('Cleaned up expired OIDC tokens');
}

/**
 * Get OIDC discovery document
 * @param {string} baseUrl - Base URL of the server
 * @returns {Object} Discovery document
 */
export function getDiscoveryDocument(baseUrl) {
  return {
    issuer: OIDC_ISSUER,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
    jwks_uri: `${baseUrl}/oauth/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'HS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    claims_supported: ['sub', 'email', 'email_verified', 'name', 'picture'],
    grant_types_supported: ['authorization_code']
  };
}

export default {
  getClient,
  validateRedirectUri,
  validateClientCredentials,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  validateAccessToken,
  revokeAccessToken,
  cleanupExpiredTokens,
  getDiscoveryDocument
};
