/**
 * Core auth routes: /register, /login, /logout, /me, /refresh, /password
 */
import { registerUser, loginUser } from '../../../services/AuthService.js';
import { recordSignup } from '../../../services/SignupService.js';
import { applyPromoUnlock, isPromoEnabled } from '../../../services/starter-pack/StarterPackService.js';
import {
  respondSuccess, respondError,
  JWT_SECRET, REFRESH_COOKIE_NAME, ACCESS_TOKEN_TTL,
  ACCESS_COOKIE_NAME,
  getRefreshCookieOptions, getAccessCookieOptions,
  getCookieValues, clearForeignSessionCookies, toClearOptions,
  createAccessToken, createRefreshToken,
  requireAuth,
  dbGet, dbRun, authLogger, jwt
} from './authShared.js';

/**
 * @param {import('express').Router} router
 */
export default function registerCoreRoutes(router) {

  /**
   * @swagger
   * /auth/register:
   *   post:
   *     tags: [Auth]
   *     summary: Register a new user
   *     description: Creates a new user account with email/password
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *               - name
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *               password:
   *                 type: string
   *                 minLength: 8
   *               name:
   *                 type: string
   *     responses:
   *       200:
   *         description: Registration successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     user:
   *                       $ref: '#/components/schemas/User'
   *                     accessToken:
   *                       type: string
   *       400:
   *         description: Validation error
   *       409:
   *         description: Email already exists
   */
  // POST /api/v2/auth/register
  router.post('/register', async (req, res) => {
    try {
      const { email, password, name, promo_code, signup_source, signup_referrer, user_agent, community, referral_code } = req.body;

      // Validation
      if (!email || !password || !name) {
        return respondError(res, 400, 'VALIDATION_ERROR', 'Email, password, and name are required');
      }

      if (password.length < 8) {
        return respondError(res, 400, 'WEAK_PASSWORD', 'Password must be at least 8 characters long');
      }

      const promoNormalized = typeof promo_code === 'string' && promo_code.trim()
        ? promo_code.trim().toUpperCase().slice(0, 32)
        : null;

      // Register user (includes auto-create projects + ADR-0079 starter pack).
      // ADR-183 Block A: `community: true` marks a street/community sign-up → viewer role.
      // ADR-183 Block C: `referral_code` (if present) is the INVITER's code from the
      // deep-link /start <code>; it is resolved to write-once `referred_by` inside
      // registerUser. Unknown codes are ignored (best-effort attribution).
      const user = await registerUser({
        email, password, name,
        communitySignup: community === true,
        inviteCode: referral_code
      });

      // ADR-0079 P4: MASTERMIND / MESHOK promo unlocks the Tier-B coding agent pack for this user.
      // Best-effort — never fail the request on unlock issues.
      // ADR-183-A D6: promo is owner-gated. Skip the unlock server-side when the owner has
      // switched promo off (defence-in-depth — not just the FE hiding the field). The flag
      // read only happens when a promo code was actually submitted, keeping the hot path lean.
      if (promoNormalized && await isPromoEnabled()) {
        applyPromoUnlock(user.id, promoNormalized).catch((err) =>
          authLogger.error({ err, userId: user.id }, 'applyPromoUnlock unhandled rejection')
        );
      }

      // ADR-0070: mirror to Signups table 100045 + send welcome email (best-effort, fire-and-forget)
      recordSignup({
        user,
        promoCode: promoNormalized,
        signupSource: signup_source || 'godcrm.ai/register',
        signupReferrer: signup_referrer || req.get('referer') || null,
        userAgent: user_agent || req.get('user-agent') || null
      }).catch((err) => authLogger.error({ err, userId: user.id }, 'recordSignup unhandled rejection'));

      // Create tokens
      const accessToken = createAccessToken(user);
      const refreshToken = createRefreshToken(user);

      // Set refresh token cookie + access_token cookie (ADR-0016 — for <img> auth on /uploads)
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
      res.cookie(ACCESS_COOKIE_NAME, accessToken, getAccessCookieOptions());

      // Include refreshToken in body for mobile clients (they can't use httpOnly cookies).
      return respondSuccess(res, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          // ADR-183 Block C: the newcomer's own code to hand out (their invite link).
          referral_code: user.referral_code
        },
        accessToken,
        refreshToken
      }, 201);

    } catch (error) {
      authLogger.error({ err: error }, 'Registration error:', error);

      if (error.message.includes('already exists')) {
        return respondError(res, 409, 'USER_EXISTS', 'User with this email already exists');
      }

      // ADR-183 Block F4 (enforce) — signup_mode gate rejected this sign-up: the box
      // is invite-only or closed and this request carried no valid inviter code.
      if (error.code === 'REGISTRATION_NOT_ALLOWED') {
        return respondError(res, 403, 'REGISTRATION_NOT_ALLOWED', error.message);
      }

      return respondError(res, 500, 'REGISTRATION_FAILED', 'Failed to register user', error.message);
    }
  });

  // POST /api/v2/auth/login
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        return respondError(res, 400, 'VALIDATION_ERROR', 'Email and password are required');
      }

      // Get IP and User-Agent for audit log
      const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      // Login user
      const result = await loginUser(email, password, ipAddress, userAgent);

      if (!result.success) {
        return respondError(res, 401, 'INVALID_CREDENTIALS', result.error);
      }

      // Create refresh token
      const refreshToken = createRefreshToken(result.user);

      // Set refresh token cookie + access_token cookie (ADR-0016 — for <img> auth on /uploads)
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
      res.cookie(ACCESS_COOKIE_NAME, result.token, getAccessCookieOptions());
      // Evict parent-domain copies left by another *.godcrm.ai box (chat 3660)
      clearForeignSessionCookies(req, res);

      // Include refreshToken in body for mobile clients (they can't use httpOnly cookies).
      // Web clients still get the httpOnly cookie above for CSRF protection.
      return respondSuccess(res, {
        user: result.user,
        accessToken: result.token,
        refreshToken
      });

    } catch (error) {
      authLogger.error({ err: error }, 'Login error:', error);
      return respondError(res, 500, 'LOGIN_FAILED', 'Failed to login', error.message);
    }
  });

  // POST /api/v2/auth/logout
  router.post('/logout', (req, res) => {
    // Clear refresh + access cookies (no auth required - logout should always work).
    // maxAge is dropped: Express 4 would turn it into a future Expires and keep an
    // empty cookie alive for 30 days instead of deleting it.
    res.clearCookie(REFRESH_COOKIE_NAME, toClearOptions(getRefreshCookieOptions()));
    res.clearCookie(ACCESS_COOKIE_NAME, toClearOptions(getAccessCookieOptions()));
    // ...and any parent-domain copies left by another *.godcrm.ai box
    clearForeignSessionCookies(req, res);

    return respondSuccess(res, { status: 'logged_out' });
  });

  // GET /api/v2/auth/me
  router.get('/me', requireAuth, (req, res) => {
    // Generate new access token to refresh session
    const accessToken = jwt.sign(
      { id: req.user.id, email: req.user.email, role: req.user.role },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL }
    );

    // Refresh access_token cookie too (ADR-0016 — for <img> auth on /uploads)
    res.cookie(ACCESS_COOKIE_NAME, accessToken, getAccessCookieOptions());

    return respondSuccess(res, {
      accessToken,
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role
      }
    });
  });

  // POST /api/v2/auth/refresh
  router.post('/refresh', async (req, res) => {
    try {
      // Every cookie value the browser sent, not just the first (chat 3660):
      // a Domain=.godcrm.ai cookie from dev.godcrm.ai can precede the host-only
      // one and is signed with another box's secret. Body token stays a fallback.
      const candidates = getCookieValues(req, REFRESH_COOKIE_NAME);
      if (req.body?.refreshToken) candidates.push(req.body.refreshToken);

      if (candidates.length === 0) {
        return respondError(res, 401, 'NO_REFRESH_TOKEN', 'Refresh token is missing');
      }

      let decoded = null;
      let wrongType = false;
      let lastError = null;
      for (const candidate of candidates) {
        try {
          const payload = jwt.verify(candidate, JWT_SECRET);
          if (payload.type === 'refresh') { decoded = payload; break; }
          wrongType = true;
        } catch (err) {
          lastError = err;
        }
      }

      // Some value failed to verify: evict the parent-domain copies so the next
      // request does not carry the foreign cookie again (no-op where this box
      // issues domain cookies itself).
      const failedCount = candidates.length - (decoded ? 1 : 0);
      if (failedCount > 0 && clearForeignSessionCookies(req, res)) {
        authLogger.warn({ host: req.hostname, candidates: candidates.length, recovered: !!decoded },
          'Refresh: evicted parent-domain session cookies');
      }

      if (!decoded) {
        if (lastError) {
          authLogger.error({ err: lastError }, 'Token refresh error:', lastError);
          return respondError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
        }
        if (wrongType) {
          return respondError(res, 401, 'INVALID_TOKEN_TYPE', 'Invalid token type');
        }
      }

      // Get user from database
      const user = await dbGet('SELECT id, email, name, role FROM users WHERE id = ?', [decoded.id]);

      if (!user) {
        return respondError(res, 401, 'USER_NOT_FOUND', 'User not found');
      }

      // Create new access token
      const accessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_TTL }
      );

      // Rotate refresh token — issue a new one so mobile clients stay logged in
      const newRefreshToken = createRefreshToken(user);
      res.cookie(REFRESH_COOKIE_NAME, newRefreshToken, getRefreshCookieOptions());
      // Refresh access_token cookie too (ADR-0016 — for <img> auth on /uploads)
      res.cookie(ACCESS_COOKIE_NAME, accessToken, getAccessCookieOptions());

      return respondSuccess(res, { accessToken, refreshToken: newRefreshToken, user });

    } catch (error) {
      authLogger.error({ err: error }, 'Token refresh error:', error);
      return respondError(res, 401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
    }
  });

  // PATCH /api/v2/auth/password - Change password
  router.patch('/password', requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id;

      // Validation
      if (!currentPassword || !newPassword) {
        return respondError(res, 400, 'VALIDATION_ERROR', 'Current password and new password are required');
      }

      if (newPassword.length < 8) {
        return respondError(res, 400, 'WEAK_PASSWORD', 'New password must be at least 8 characters long');
      }

      // Import bcrypt and database
      const bcrypt = await import('bcrypt');
      const { dbGet, dbRun } = await import('../../../database/connection.js');

      // Get user
      const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);

      if (!user) {
        return respondError(res, 404, 'USER_NOT_FOUND', 'User not found');
      }

      // Verify current password
      const isValidPassword = await bcrypt.default.compare(currentPassword, user.password_hash);

      if (!isValidPassword) {
        return respondError(res, 401, 'INVALID_PASSWORD', 'Current password is incorrect');
      }

      // Hash new password
      const newPasswordHash = await bcrypt.default.hash(newPassword, 10);

      // Update password
      await dbRun(
        'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newPasswordHash, userId]
      );

      return respondSuccess(res, { message: 'Password updated successfully' });

    } catch (error) {
      authLogger.error({ err: error }, 'Password change error:', error);
      return respondError(res, 500, 'PASSWORD_CHANGE_FAILED', 'Failed to change password', error.message);
    }
  });
}
