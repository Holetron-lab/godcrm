/**
 * Google OAuth routes: /google/config, /google/auth-url, /google/token,
 * /google/callback, /google/mobile-auth-url, /google/mobile-callback
 */
import axios from 'axios';
import {
  respondSuccess, respondError,
  REFRESH_COOKIE_NAME, ACCESS_COOKIE_NAME,
  getRefreshCookieOptions, getAccessCookieOptions,
  createAccessToken, createRefreshToken,
  requireAuth, getDynamicRedirectUri,
  saveGoogleOAuthConfig,
  googleOAuthConfig as _googleOAuthConfig, setGoogleOAuthConfig,
  dbGet, authLogger
} from './authShared.js';

// Local reference that stays in sync via the shared module's getter
function getConfig() {
  // Re-import to get the current mutable value
  // We read from the shared module each time so POST /google/config updates are visible
  return _googleOAuthConfig;
}

/**
 * @param {import('express').Router} router
 */
export default function registerGoogleOAuthRoutes(router) {

  // GET /api/v3/auth/google/config - Get Google OAuth config (public info only)
  router.get('/google/config', (req, res) => {
    const googleOAuthConfig = getConfig();
    return respondSuccess(res, {
      clientId: googleOAuthConfig.clientId,
      redirectUri: getDynamicRedirectUri(req, googleOAuthConfig),
      enabled: googleOAuthConfig.enabled,
      hasClientSecret: !!googleOAuthConfig.clientSecret
    });
  });

  // GET /api/v3/auth/google/auth-url - Get Google OAuth authorization URL
  router.get('/google/auth-url', (req, res) => {
    const googleOAuthConfig = getConfig();
    if (!googleOAuthConfig.enabled || !googleOAuthConfig.clientId) {
      return respondError(res, 400, 'GOOGLE_OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured');
    }

    // Support custom redirect_uri for desktop apps (localhost), otherwise use dynamic host-based URI
    const redirectUri = req.query.redirect_uri || getDynamicRedirectUri(req, googleOAuthConfig);

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${googleOAuthConfig.clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=openid%20profile%20email&` +
      `prompt=select_account&` +
      `access_type=offline`;

    return respondSuccess(res, { url: authUrl, redirectUri });
  });

  // POST /api/v3/auth/google/token - Login with Google access_token (for desktop apps)
  // Desktop app handles OAuth flow and token exchange, sends us the Google access_token
  router.post('/google/token', async (req, res) => {
    const { access_token } = req.body;

    if (!access_token) {
      return respondError(res, 400, 'NO_TOKEN', 'Google access_token is required');
    }

    try {
      authLogger.debug('[Google Token] Verifying access_token...');

      // Get user info from Google using the access_token
      const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      const googleEmail = userResponse.data.email;
      const googleName = userResponse.data.name || googleEmail.split('@')[0];

      authLogger.debug('[Google Token] User email:', googleEmail);

      // Check if user exists
      let user = await dbGet('SELECT id, email, name, role FROM users WHERE email = ?', [googleEmail]);

      if (!user) {
        // User not found - return error (no auto-registration)
        authLogger.debug('[Google Token] User not found:', googleEmail);
        return respondError(res, 401, 'USER_NOT_FOUND', `User with email ${googleEmail} is not registered in the system. Please contact administrator.`);
      }

      authLogger.debug('[Google Token] User found:', googleEmail);

      // Create tokens
      const accessToken = createAccessToken(user);
      const refreshToken = createRefreshToken(user);

      // Set refresh token cookie
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
      authLogger.error({ err: error }, '[Google Token] Error:', error.response?.data || error.message);
      return respondError(res, 500, 'GOOGLE_AUTH_FAILED', 'Google authentication failed', error.response?.data?.error_description || error.message);
    }
  });

  // POST /api/v3/auth/google/callback - Exchange code for token and login
  router.post('/google/callback', async (req, res) => {
    const googleOAuthConfig = getConfig();
    const { code, redirect_uri } = req.body;

    if (!code) {
      return respondError(res, 400, 'NO_CODE', 'Authorization code is required');
    }

    try {
      authLogger.debug(' Exchanging code for token...');

      // Use provided redirect_uri or dynamic host-based URI (for desktop apps using localhost)
      const redirectUri = redirect_uri || getDynamicRedirectUri(req, googleOAuthConfig);
      authLogger.debug(' Using redirect_uri:', redirectUri);

      // Exchange code for token
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: googleOAuthConfig.clientId,
        client_secret: googleOAuthConfig.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });

      const { access_token } = tokenResponse.data;

      // Get user info from Google
      const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      const googleEmail = userResponse.data.email;
      const googleName = userResponse.data.name || googleEmail.split('@')[0];

      authLogger.debug(' User email:', googleEmail);

      // Check if user exists
      let user = await dbGet('SELECT id, email, name, role FROM users WHERE email = ?', [googleEmail]);

      if (!user) {
        // User not found - return error (no auto-registration)
        authLogger.debug(' User not found:', googleEmail);
        return respondError(res, 401, 'USER_NOT_FOUND', `User with email ${googleEmail} is not registered in the system. Please contact administrator.`);
      }

      authLogger.debug(' User found:', googleEmail);

      // Create tokens
      const accessToken = createAccessToken(user);
      const refreshToken = createRefreshToken(user);

      // Set refresh token cookie
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
      res.cookie(ACCESS_COOKIE_NAME, accessToken, getAccessCookieOptions());

      // Include refreshToken in body for mobile clients
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
      authLogger.error({ err: error }, '[Google OAuth] Error:', error.response?.data || error.message);
      return respondError(res, 500, 'GOOGLE_AUTH_FAILED', 'Google authentication failed', error.response?.data?.error_description || error.message);
    }
  });

  // GET /api/v3/auth/google/mobile-auth-url - Get Google OAuth URL for mobile apps
  router.get('/google/mobile-auth-url', (req, res) => {
    const googleOAuthConfig = getConfig();
    if (!googleOAuthConfig.enabled || !googleOAuthConfig.clientId) {
      return respondError(res, 400, 'GOOGLE_OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured');
    }

    // Use dynamic host-based redirect URI (same as web app)
    const redirectUri = getDynamicRedirectUri(req, googleOAuthConfig);

    // App scheme passed as query parameter
    const appScheme = req.query.app_scheme || 'godframe';

    // Encode mobile flag in state so server.js can detect and forward to mobile-callback
    const state = `mobile:${appScheme}`;

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${googleOAuthConfig.clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=openid%20profile%20email&` +
      `prompt=select_account&` +
      `state=${encodeURIComponent(state)}&` +
      `access_type=offline`;

    return respondSuccess(res, { url: authUrl, redirectUri });
  });

  // GET /api/v3/auth/google/mobile-callback - Handle Google OAuth callback for mobile apps
  router.get('/google/mobile-callback', async (req, res) => {
    const googleOAuthConfig = getConfig();
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send('<html><body style="font-family:sans-serif;background:#0f0f23;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#f87171">Error</h2><p>No authorization code received. Please try again from the GOD Frame app.</p></div></body></html>');
    }

    try {
      authLogger.debug('[Google Mobile] Exchanging code for token...');

      // Use dynamic host-based redirect_uri that matches what was sent to Google in mobile-auth-url
      const redirectUri = getDynamicRedirectUri(req, googleOAuthConfig);
      authLogger.debug('[Google Mobile] Using redirect_uri:', redirectUri);

      // Exchange code for token
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: googleOAuthConfig.clientId,
        client_secret: googleOAuthConfig.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });

      const { access_token } = tokenResponse.data;

      // Get user info from Google
      const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      const googleEmail = userResponse.data.email;
      authLogger.debug('[Google Mobile] User email:', googleEmail);

      // Check if user exists
      let user = await dbGet('SELECT id, email, name, role FROM users WHERE email = ?', [googleEmail]);

      if (!user) {
        authLogger.debug('[Google Mobile] User not found:', googleEmail);
        return res.send(`<html><body style="font-family:sans-serif;background:#0f0f23;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#f87171">User Not Found</h2><p>Email ${googleEmail} is not registered in GOD CRM.</p><p>Please contact administrator.</p></div></body></html>`);
      }

      authLogger.debug('[Google Mobile] User found:', googleEmail);

      // Create JWT token and refresh token
      const accessToken = createAccessToken(user);
      const refreshToken = createRefreshToken(user);

      // Set refresh token cookie (for completeness)
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
      res.cookie(ACCESS_COOKIE_NAME, accessToken, getAccessCookieOptions());

      // Determine app scheme from state (format: "mobile:<scheme>" or just "<scheme>")
      let appScheme = 'godframe';
      if (state) {
        const decodedState = decodeURIComponent(state);
        appScheme = decodedState.startsWith('mobile:') ? decodedState.slice(7) : decodedState;
      }

      // Build deep link to redirect to the mobile app (include refresh token for persistent auth)
      const deepLink = `${appScheme}://auth/callback?token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name)}`;

      authLogger.debug('[Google Mobile] Redirecting to app via deep link:', deepLink.substring(0, 80) + '...');

      // Serve an HTML page that triggers the deep link redirect.
      const safeDeepLink = deepLink.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Redirecting to GOD Frame...</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0f0f23;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
  .c{text-align:center;padding:20px}
  h2{color:#818cf8;margin-bottom:8px}
  .spin{margin:20px auto;width:40px;height:40px;border:4px solid #1e1b4b;border-top-color:#818cf8;border-radius:50%;animation:s 1s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  a{display:inline-block;margin-top:24px;padding:14px 28px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600}
  a:active{background:#4338ca}
  .hint{color:#64748b;font-size:13px;margin-top:16px}
</style>
</head><body>
<div class="c">
  <div class="spin"></div>
  <h2>Authentication Successful!</h2>
  <p>Opening GOD Frame...</p>
  <a id="btn" href="${safeDeepLink}">Open GOD Frame</a>
  <p class="hint">If the app doesn't open automatically, tap the button above.</p>
</div>
<script>
// Strategy 1: Direct location change (works on most browsers)
try { window.location.href = "${safeDeepLink}"; } catch(e) {}

// Strategy 2: After delay, try Android intent:// URI (most reliable on Android Chrome)
setTimeout(function() {
  try {
    var intentUri = "intent://auth/callback?token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&email=${encodeURIComponent(user.email)}&name=${encodeURIComponent(user.name)}#Intent;scheme=${appScheme};end";
    window.location.href = intentUri;
  } catch(e) {}
}, 800);
</script>
</body></html>`);

    } catch (error) {
      authLogger.error({ err: error }, '[Google Mobile] Error:', error.response?.data || error.message);
      return res.status(500).send(`<html><body style="font-family:sans-serif;background:#0f0f23;color:#e2e8f0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#f87171">Authentication Error</h2><p>${error.response?.data?.error_description || error.message}</p><p>Please try again from the GOD Frame app.</p></div></body></html>`);
    }
  });

  // POST /api/v3/auth/google/config - Update Google OAuth config (owner only)
  router.post('/google/config', requireAuth, async (req, res) => {
    try {
      // Check if user is owner
      const user = await dbGet('SELECT role FROM users WHERE id = ?', [req.user.id]);
      if (user?.role !== 'owner') {
        return respondError(res, 403, 'FORBIDDEN', 'Only owner can configure Google OAuth');
      }

      const { clientId, clientSecret, redirectUri, enabled } = req.body;

      let googleOAuthConfig = getConfig();
      const newConfig = {
        clientId: clientId || googleOAuthConfig.clientId,
        clientSecret: clientSecret || googleOAuthConfig.clientSecret,
        redirectUri: redirectUri || googleOAuthConfig.redirectUri,
        enabled: enabled !== undefined ? enabled : googleOAuthConfig.enabled
      };

      setGoogleOAuthConfig(newConfig);

      if (saveGoogleOAuthConfig(newConfig)) {
        return respondSuccess(res, {
          message: 'Google OAuth configuration updated',
          enabled: newConfig.enabled
        });
      } else {
        return respondError(res, 500, 'SAVE_FAILED', 'Failed to save configuration');
      }
    } catch (error) {
      authLogger.error({ err: error }, '[Google OAuth] Config update error:', error);
      return respondError(res, 500, 'CONFIG_UPDATE_FAILED', 'Failed to update Google OAuth configuration');
    }
  });

  // GET /api/v3/auth/google/config - Get Google OAuth config (owner only)
  // NOTE: This authenticated version is registered AFTER the public one above.
  // Express matches the first registered handler; the public GET /google/config (line ~30)
  // will always win. This mirrors the original auth.js behavior where the second
  // GET /google/config at line 1312 was effectively unreachable.
  // Kept here for parity — if you need an owner-only endpoint, use a different path.
}
