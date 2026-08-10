/**
 * OAuth/OIDC Routes for GOD CRM
 * ADR-063: WorkAdventure Integration
 * 
 * Provides OIDC endpoints for external apps like WorkAdventure
 * 
 * Endpoints:
 * - GET /.well-known/openid-configuration - Discovery document
 * - GET /authorize - Authorization endpoint
 * - POST /token - Token endpoint
 * - GET /userinfo - User info endpoint
 * - GET /jwks - JSON Web Key Set
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbGet, dbRun, dbAll } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import {
  ISSUER,
  TOKEN_TTL,
  SUPPORTED_SCOPES,
  getDiscoveryDocument
} from '../../config/oidc.config.js';
import {
  getClient,
  isRedirectUriAllowed,
  verifyClientSecret,
} from '../../services/oidc/clientRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ADR-179 D1 — ring discipline: the fleet issuer must be Ring-0-anchored
// (id.godcrm.ai), never a foreign master. The cutover to id.godcrm.ai is a
// coordinated env flip (OIDC_ISSUER) done in lockstep with client reconfig —
// we only WARN here so a stray NL/Ring-1 issuer is loud in the logs, never
// silently baked into id_tokens.
if (/hltrn\.cc|94\.103\.81\.53|31\.130\.152\.12/.test(ISSUER)) {
  apiLogger.warn(
    { issuer: ISSUER },
    'OIDC_ISSUER points at a non-Ring-0 host — ADR-179 D1 requires https://id.godcrm.ai (Ring 0). ' +
      'Set OIDC_ISSUER in the Ring-0 .env before onboarding fleet clients.'
  );
}

// Load RSA keys for RS256 signing
let privateKey = null;
let publicKey = null;
let jwkPublicKey = null;

try {
  const keysDir = path.join(__dirname, '../../config/keys');
  privateKey = fs.readFileSync(path.join(keysDir, 'oidc-private.pem'), 'utf8');
  publicKey = fs.readFileSync(path.join(keysDir, 'oidc-public.pem'), 'utf8');

  // Convert public key to JWK format
  const keyData = crypto.createPublicKey(publicKey);
  const jwk = keyData.export({ format: 'jwk' });
  jwkPublicKey = {
    ...jwk,
    kid: 'godcrm-oidc-key-1',
    use: 'sig',
    alg: 'RS256',
  };
  apiLogger.info('OIDC RS256 keys loaded successfully');
} catch (err) {
  apiLogger.warn({ err: err.message }, 'OIDC RS256 keys not found, falling back to HS256');
}

const router = express.Router();

// In-memory store for authorization codes (in production, use Redis or database)
const authorizationCodes = new Map();

// Get JWT secret dynamically to support test environment
function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Generate a random authorization code
 * @returns {string} - Random code
 */
function generateAuthorizationCode() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate access token
 * @param {Object} user - User object
 * @param {string} clientId - Client ID
 * @param {string[]} scopes - Requested scopes
 * @returns {string} - JWT access token
 */
function generateAccessToken(user, clientId, scopes) {
  return jwt.sign(
    {
      sub: String(user.id),
      iss: ISSUER,
      aud: clientId,
      scope: scopes.join(' '),
      type: 'access_token',
    },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL.ACCESS_TOKEN }
  );
}

/**
 * Generate ID token
 * @param {Object} user - User object
 * @param {string} clientId - Client ID
 * @param {string[]} scopes - Requested scopes
 * @returns {string} - JWT ID token
 */
function generateIdToken(user, clientId, scopes) {
  const claims = {
    sub: String(user.id),
    iss: ISSUER,
    aud: clientId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL.ID_TOKEN,
  };

  // Add profile claims if scope includes 'profile'
  if (scopes.includes('profile')) {
    claims.name = user.name;
    claims.picture = user.avatar;
    claims.preferred_username = `${user.name} (ID:${user.id})`;
  }

  // Add email claims if scope includes 'email'
  if (scopes.includes('email')) {
    claims.email = user.email;
    claims.email_verified = Boolean(user.email_verified);
  }

  // Use RS256 if private key is available, otherwise fallback to HS256
  if (privateKey) {
    return jwt.sign(claims, privateKey, {
      algorithm: 'RS256',
      header: { kid: 'godcrm-oidc-key-1' }
    });
  }

  return jwt.sign(claims, getJwtSecret(), { algorithm: 'HS256' });
}

/**
 * Extract bearer token from Authorization header
 * @param {Object} req - Express request
 * @returns {string|null} - Token or null
 */
function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * Extract token from cookie
 * @param {Object} req - Express request
 * @returns {string|null} - Token or null
 */
function extractCookieToken(req) {
  // Check for refresh token cookie (used by GOD CRM frontend)
  // Cookie name: godcrm_refresh (or REFRESH_COOKIE_NAME env var)
  const cookieName = process.env.REFRESH_COOKIE_NAME || 'godcrm_refresh';
  return req.cookies?.[cookieName] || null;
}

/**
 * Get authenticated user from request (Bearer token or cookie)
 * @param {Object} req - Express request
 * @returns {Object|null} - Decoded token payload or null
 */
function getAuthenticatedUser(req) {
  // Try Bearer token first
  const bearerToken = extractBearerToken(req);
  if (bearerToken) {
    const decoded = verifyToken(bearerToken);
    if (decoded) return decoded;
  }
  
  // Try cookie token
  const cookieToken = extractCookieToken(req);
  if (cookieToken) {
    const decoded = verifyToken(cookieToken);
    if (decoded) return decoded;
  }
  
  // Check if user is set by auth middleware (req.user)
  if (req.user && req.user.id) {
    return { id: req.user.id };
  }
  
  return null;
}

/**
 * Verify and decode JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} - Decoded token or null
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

// ============================================================
// OIDC Endpoints
// ============================================================

/**
 * GET /openid-configuration
 * OpenID Connect Discovery Document
 * Note: This is mounted at /.well-known in server.js, so full path is /.well-known/openid-configuration
 */
router.get('/openid-configuration', (req, res) => {
  const baseUrl = ISSUER;
  res.json(getDiscoveryDocument(baseUrl));
});

/**
 * GET /authorize
 * Authorization Endpoint - Initiates the OAuth flow
 */
router.get('/authorize', async (req, res) => {
  const {
    client_id,
    redirect_uri,
    response_type,
    scope = 'openid',
    state,
    code_challenge,
    code_challenge_method,
  } = req.query;

  apiLogger.debug({ client_id, redirect_uri, response_type, scope, code_challenge: !!code_challenge, code_challenge_method }, 'OIDC authorize request');

  // Validate client_id (registry lookup — inactive clients resolve to null)
  const client = await getClient(client_id);
  if (!client) {
    return res.status(400).json({
      error: 'invalid_client',
      error_description: 'Unknown client_id',
    });
  }

  // Validate redirect_uri
  if (!isRedirectUriAllowed(client, redirect_uri)) {
    return res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'Redirect URI not registered for this client',
    });
  }

  // Validate response_type
  if (response_type !== 'code') {
    return res.status(400).json({
      error: 'unsupported_response_type',
      error_description: 'Only "code" response type is supported',
    });
  }

  // ADR-179 D4 — public clients (the Chrome extension, ADR-180) have no secret,
  // so PKCE is the only proof-of-possession. Require code_challenge up front so
  // a public client can never fall back to an unprotected code exchange.
  if (client.is_public && !code_challenge) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'PKCE code_challenge is required for public clients',
    });
  }

  // Check if user is authenticated (via Bearer token OR cookie)
  const authUser = getAuthenticatedUser(req);
  if (!authUser) {
    // Redirect to login page with return URL
    const returnUrl = encodeURIComponent(req.originalUrl);
    apiLogger.debug({ returnUrl }, 'OIDC: User not authenticated, redirecting to login');
    return res.redirect(302, `/auth/login?redirect=${returnUrl}`);
  }

  // Get user from database
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [authUser.id]);
  if (!user) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'User not found',
    });
  }

  // Parse requested scopes
  const requestedScopes = scope.split(' ').filter(s => SUPPORTED_SCOPES.includes(s));

  // Generate authorization code
  const code = generateAuthorizationCode();
  
  // Store code with metadata (expires in 10 minutes)
  authorizationCodes.set(code, {
    userId: user.id,
    clientId: client_id,
    redirectUri: redirect_uri,
    scopes: requestedScopes,
    expiresAt: Date.now() + TOKEN_TTL.AUTHORIZATION_CODE * 1000,
    codeChallenge: code_challenge || null,
    codeChallengeMethod: code_challenge_method || null,
  });

  // Build redirect URL with code (normalize double slashes in path)
  const redirectUrl = new URL(redirect_uri);
  // Normalize path to remove double slashes (wa.hltrn.cc//openid-callback -> wa.hltrn.cc/openid-callback)
  redirectUrl.pathname = redirectUrl.pathname.replace(/\/+/g, '/');
  redirectUrl.searchParams.set('code', code);
  if (state) {
    redirectUrl.searchParams.set('state', state);
  }

  apiLogger.info({ userId: user.id, clientId: client_id }, 'OIDC authorization code issued');

  return res.redirect(302, redirectUrl.toString());
});

/**
 * POST /token
 * Token Endpoint - Exchanges authorization code for tokens
 */
router.post('/token', async (req, res) => {
  const {
    grant_type,
    code,
    redirect_uri,
  } = req.body;

  // Support client_secret_basic (Authorization: Basic base64(client_id:client_secret))
  // and client_secret_post (client_id + client_secret in POST body)
  let client_id = req.body.client_id;
  let client_secret = req.body.client_secret;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex !== -1) {
      client_id = decodeURIComponent(decoded.substring(0, colonIndex));
      client_secret = decodeURIComponent(decoded.substring(colonIndex + 1));
    }
  }

  apiLogger.debug({ grant_type, client_id }, 'OIDC token request');

  // Validate grant_type
  if (grant_type !== 'authorization_code' && grant_type !== 'refresh_token') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only "authorization_code" and "refresh_token" grant types are supported',
    });
  }

  // Look up the client, then authenticate per its tier (ADR-179 D4):
  //  - confidential client → must present a matching secret (vault or legacy).
  //    verifyClientSecret closes the old bypass where omitting the secret
  //    skipped the check entirely.
  //  - public client → no secret; proves possession via PKCE below.
  const client = await getClient(client_id);
  if (!client) {
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Invalid client credentials',
    });
  }
  if (!client.is_public) {
    const authed = await verifyClientSecret(client, client_secret);
    if (!authed) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      });
    }
  }

  if (grant_type === 'authorization_code') {
    // Validate authorization code
    const codeData = authorizationCodes.get(code);
    if (!codeData) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Invalid or expired authorization code',
      });
    }

    // Diagnostic logging for token exchange debugging
    apiLogger.info({
      grant_type,
      client_id,
      redirect_uri,
      storedRedirectUri: codeData.redirectUri,
      hasCodeVerifier: !!req.body.code_verifier,
      hasCodeChallenge: !!codeData.codeChallenge,
      codeChallengeMethod: codeData.codeChallengeMethod,
    }, 'OIDC token exchange details');

    // Check if code is expired
    if (Date.now() > codeData.expiresAt) {
      authorizationCodes.delete(code);
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Authorization code has expired',
      });
    }

    // Normalize redirect URIs for comparison (handle double slashes like //openid-callback)
    const normalizeUri = (uri) => {
      try {
        const url = new URL(uri);
        url.pathname = url.pathname.replace(/\/+/g, '/');
        return url.toString();
      } catch {
        return uri;
      }
    };

    // Validate redirect_uri matches (normalized)
    if (normalizeUri(codeData.redirectUri) !== normalizeUri(redirect_uri)) {
      apiLogger.warn({
        stored: codeData.redirectUri,
        received: redirect_uri,
        storedNormalized: normalizeUri(codeData.redirectUri),
        receivedNormalized: normalizeUri(redirect_uri),
      }, 'OIDC redirect_uri mismatch');
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Redirect URI mismatch',
      });
    }

    // Validate client_id matches
    if (codeData.clientId !== client_id) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'Client ID mismatch',
      });
    }

    // ADR-179 D4 — a public client MUST have bound a PKCE challenge at
    // /authorize; refuse the exchange if one is somehow absent.
    if (client.is_public && !codeData.codeChallenge) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'PKCE code_verifier required for public clients',
      });
    }

    // PKCE validation
    if (codeData.codeChallenge) {
      const { code_verifier } = req.body;
      if (!code_verifier) {
        apiLogger.warn({ client_id }, 'OIDC PKCE: code_verifier required but not provided');
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Code verifier required for PKCE',
        });
      }

      let expectedChallenge;
      if (codeData.codeChallengeMethod === 'S256') {
        expectedChallenge = crypto.createHash('sha256')
          .update(code_verifier)
          .digest('base64url');
      } else {
        // plain method
        expectedChallenge = code_verifier;
      }

      if (expectedChallenge !== codeData.codeChallenge) {
        apiLogger.warn({ client_id, method: codeData.codeChallengeMethod }, 'OIDC PKCE: code_verifier validation failed');
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid code verifier',
        });
      }

      apiLogger.debug({ client_id, method: codeData.codeChallengeMethod }, 'OIDC PKCE: code_verifier validated successfully');
    }

    // Delete the code (one-time use)
    authorizationCodes.delete(code);

    // Get user
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [codeData.userId]);
    if (!user) {
      return res.status(400).json({
        error: 'invalid_grant',
        error_description: 'User not found',
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user, client_id, codeData.scopes);
    const idToken = generateIdToken(user, client_id, codeData.scopes);

    apiLogger.info({ userId: user.id, clientId: client_id }, 'OIDC tokens issued');

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL.ACCESS_TOKEN,
      id_token: idToken,
      scope: codeData.scopes.join(' '),
    });
  }

  // Handle refresh_token grant (not implemented yet)
  return res.status(400).json({
    error: 'unsupported_grant_type',
    error_description: 'Refresh token grant not yet implemented',
  });
});

/**
 * GET /userinfo
 * UserInfo Endpoint - Returns user claims
 */
router.get('/userinfo', async (req, res) => {
  const token = extractBearerToken(req);
  
  if (!token) {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Access token is required',
    });
  }

  const decoded = verifyToken(token);
  if (!decoded || decoded.type !== 'access_token') {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'Invalid or expired access token',
    });
  }

  // Get user from database
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [decoded.sub]);
  if (!user) {
    return res.status(401).json({
      error: 'invalid_token',
      error_description: 'User not found',
    });
  }

  // Parse scopes from token
  const scopes = (decoded.scope || '').split(' ');

  // Build userinfo response based on scopes
  const userinfo = {
    sub: String(user.id),
  };

  if (scopes.includes('profile')) {
    userinfo.name = user.name;
    userinfo.picture = user.avatar;
    // preferred_username includes CRM user ID for identification in WorkAdventure
    userinfo.preferred_username = `${user.name} (ID:${user.id})`;
  }

  if (scopes.includes('email')) {
    userinfo.email = user.email;
    userinfo.email_verified = Boolean(user.email_verified);
  }

  return res.json(userinfo);
});

/**
 * GET /jwks
 * JSON Web Key Set - Returns public keys for token verification
 */
router.get('/jwks', (req, res) => {
  // Return public key in JWK format for RS256 verification
  if (jwkPublicKey) {
    return res.json({
      keys: [jwkPublicKey],
    });
  }

  // Fallback: no keys if RS256 not configured
  res.json({
    keys: [],
  });
});

export default router;
