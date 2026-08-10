/**
 * Telegram OAuth (OIDC) routes: /telegram/config, /telegram/auth-url,
 * /telegram/callback (ADR-0078).
 *
 * Mirror of the Google provider for config plumbing + token/cookie issuance,
 * but the authorization flow itself is Telegram's OIDC variant
 * (oauth.telegram.org): PKCE + id_token instead of access_token + userinfo.
 * Email is the mapping key to an existing users row (no auto-registration);
 * users.telegram_user_id is a write-once binding for future deep-links.
 */
import axios from 'axios';
import crypto from 'crypto';
import {
  respondSuccess, respondError,
  REFRESH_COOKIE_NAME, ACCESS_COOKIE_NAME,
  getRefreshCookieOptions, getAccessCookieOptions,
  createAccessToken, createRefreshToken,
  requireAuth,
  saveTelegramOAuthConfig,
  telegramOAuthConfig as _telegramOAuthConfig, setTelegramOAuthConfig,
  dbGet, dbRun, authLogger
} from './authShared.js';

// Local reference that stays in sync via the shared module's getter.
// We read from the shared module each time so POST /telegram/config updates are visible.
function getConfig() {
  return _telegramOAuthConfig;
}

// Telegram-specific redirect URI (Google's getDynamicRedirectUri hardcodes the
// /auth/google/callback path, so we build our own here).
function getTelegramRedirectUri(req, telegramOAuthConfig) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host');
  if (host) {
    return `${proto}://${host}/auth/telegram/callback`;
  }
  return telegramOAuthConfig.redirectUri;
}

// ---------------------------------------------------------------------------
// PKCE state store — module-scope, in-memory, 5-minute TTL (alpha-grade).
// Post-alpha this moves to the _app_locks table (ADR-0078 Phase 6) so it
// survives restarts and works across multiple backend processes.
// ---------------------------------------------------------------------------
const PKCE_TTL_MS = 5 * 60 * 1000;
const pkceStore = new Map(); // state -> { codeVerifier, createdAt }

function prunePkce() {
  const now = Date.now();
  for (const [state, entry] of pkceStore) {
    if (now - entry.createdAt > PKCE_TTL_MS) pkceStore.delete(state);
  }
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// id_token payload decode WITHOUT signature verification (alpha).
// TODO ADR-0078 Phase 6: verify id_token signature via JWKS once Telegram publishes JWKS endpoint
function decodeIdTokenPayload(idToken) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token');
  const payload = Buffer.from(
    parts[1].replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8');
  return JSON.parse(payload);
}

/**
 * @param {import('express').Router} router
 */
export default function registerTelegramOAuthRoutes(router) {

  // GET /api/v3/auth/telegram/config - Get Telegram OAuth config (public info only)
  router.get('/telegram/config', (req, res) => {
    const telegramOAuthConfig = getConfig();
    return respondSuccess(res, {
      clientId: telegramOAuthConfig.clientId,
      redirectUri: getTelegramRedirectUri(req, telegramOAuthConfig),
      enabled: telegramOAuthConfig.enabled,
      hasClientSecret: !!telegramOAuthConfig.clientSecret
    });
  });

  // POST /api/v3/auth/telegram/auth-url - Build Telegram OAuth authorization URL (PKCE)
  router.post('/telegram/auth-url', (req, res) => {
    const telegramOAuthConfig = getConfig();
    if (!telegramOAuthConfig.enabled || !telegramOAuthConfig.clientId) {
      return respondError(res, 400, 'TELEGRAM_OAUTH_NOT_CONFIGURED', 'Telegram OAuth is not configured');
    }

    // Support custom redirect_uri for desktop apps (localhost), otherwise use dynamic host-based URI
    const redirectUri = req.body.redirect_uri || getTelegramRedirectUri(req, telegramOAuthConfig);

    prunePkce();
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = base64url(crypto.randomBytes(16));
    pkceStore.set(state, { codeVerifier, createdAt: Date.now() });

    // google_signin_allowed / apple_signin_allowed let users verify their email
    // via Google/Apple inside Telegram's flow.
    const authUrl = `https://oauth.telegram.org/auth?` +
      `client_id=${encodeURIComponent(telegramOAuthConfig.clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent('openid profile email')}&` +
      `code_challenge=${encodeURIComponent(codeChallenge)}&` +
      `code_challenge_method=S256&` +
      `state=${encodeURIComponent(state)}&` +
      `google_signin_allowed=true&` +
      `apple_signin_allowed=true`;

    return respondSuccess(res, { url: authUrl, state, redirectUri });
  });

  // POST /api/v3/auth/telegram/callback - Exchange code for id_token and login
  router.post('/telegram/callback', async (req, res) => {
    const telegramOAuthConfig = getConfig();
    const { code, state, redirect_uri } = req.body;

    if (!code) {
      return respondError(res, 400, 'NO_CODE', 'Authorization code is required');
    }
    if (!state) {
      return respondError(res, 400, 'NO_STATE', 'OAuth state is required');
    }

    prunePkce();
    const pkce = pkceStore.get(state);
    if (!pkce) {
      return respondError(res, 400, 'INVALID_STATE', 'PKCE state is missing or expired');
    }
    pkceStore.delete(state);

    try {
      authLogger.debug('[Telegram OAuth] Exchanging code for token...');

      // Use provided redirect_uri or dynamic host-based URI (must match auth-url)
      const redirectUri = redirect_uri || getTelegramRedirectUri(req, telegramOAuthConfig);
      authLogger.debug('[Telegram OAuth] Using redirect_uri:', redirectUri);

      // Exchange code for token (Telegram returns user data inside id_token)
      const tokenResponse = await axios.post('https://oauth.telegram.org/token', {
        code,
        client_id: telegramOAuthConfig.clientId,
        client_secret: telegramOAuthConfig.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: pkce.codeVerifier
      });

      const { id_token } = tokenResponse.data;
      if (!id_token) {
        return respondError(res, 502, 'NO_ID_TOKEN', 'Telegram did not return an id_token');
      }

      // TODO ADR-0078 Phase 6: verify id_token signature via JWKS once Telegram publishes JWKS endpoint.
      // For alpha we trust TLS + client_secret and decode the claims only.
      const claims = decodeIdTokenPayload(id_token);
      const telegramEmail = claims.email;
      const telegramSub = claims.sub;

      if (!telegramEmail) {
        return respondError(res, 400, 'NO_EMAIL', 'Telegram id_token did not include an email claim');
      }

      authLogger.debug('[Telegram OAuth] User email:', telegramEmail);

      // Check if user exists (email is the mapping key; no auto-registration)
      const user = await dbGet(
        'SELECT id, email, name, role, telegram_user_id FROM users WHERE email = ?',
        [telegramEmail]
      );

      if (!user) {
        authLogger.debug('[Telegram OAuth] User not found:', telegramEmail);
        return respondError(res, 401, 'USER_NOT_FOUND', `User with email ${telegramEmail} is not registered in the system. Please contact administrator.`);
      }

      // Write-once binding of users.telegram_user_id
      if (user.telegram_user_id === null || user.telegram_user_id === undefined) {
        await dbRun('UPDATE users SET telegram_user_id = ? WHERE id = ?', [telegramSub, user.id]);
      } else if (String(user.telegram_user_id) !== String(telegramSub)) {
        authLogger.warn('[Telegram OAuth] telegram_user_id mismatch for user:', user.id);
        return respondError(res, 409, 'TELEGRAM_ID_MISMATCH', 'This account is already linked to a different Telegram identity');
      }

      authLogger.debug('[Telegram OAuth] User found:', telegramEmail);

      // Create tokens
      const accessToken = createAccessToken(user);
      const refreshToken = createRefreshToken(user);

      // Set refresh + access token cookies
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
      res.cookie(ACCESS_COOKIE_NAME, accessToken, getAccessCookieOptions());

      // Include refreshToken in body for mobile clients (they can't use httpOnly cookies)
      return respondSuccess(res, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        accessToken,
        refreshToken
      });

    } catch (error) {
      authLogger.error({ err: error }, '[Telegram OAuth] Error:', error.response?.data || error.message);
      return respondError(res, 500, 'TELEGRAM_AUTH_FAILED', 'Telegram authentication failed', error.response?.data?.error_description || error.message);
    }
  });

  // POST /api/v3/auth/telegram/config - Update Telegram OAuth config (owner only)
  router.post('/telegram/config', requireAuth, async (req, res) => {
    try {
      // Check if user is owner
      const user = await dbGet('SELECT role FROM users WHERE id = ?', [req.user.id]);
      if (user?.role !== 'owner') {
        return respondError(res, 403, 'FORBIDDEN', 'Only owner can configure Telegram OAuth');
      }

      const { clientId, clientSecret, redirectUri, enabled } = req.body;

      const telegramOAuthConfig = getConfig();
      const newConfig = {
        clientId: clientId || telegramOAuthConfig.clientId,
        clientSecret: clientSecret || telegramOAuthConfig.clientSecret,
        redirectUri: redirectUri || telegramOAuthConfig.redirectUri,
        enabled: enabled !== undefined ? enabled : telegramOAuthConfig.enabled
      };

      setTelegramOAuthConfig(newConfig);

      if (saveTelegramOAuthConfig(newConfig)) {
        return respondSuccess(res, {
          message: 'Telegram OAuth configuration updated',
          enabled: newConfig.enabled
        });
      } else {
        return respondError(res, 500, 'SAVE_FAILED', 'Failed to save configuration');
      }
    } catch (error) {
      authLogger.error({ err: error }, '[Telegram OAuth] Config update error:', error);
      return respondError(res, 500, 'CONFIG_UPDATE_FAILED', 'Failed to update Telegram OAuth configuration');
    }
  });
}
