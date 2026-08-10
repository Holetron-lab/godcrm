// backend/middleware/publicAccess.js
// ADR-105: Public Access Middleware for External Space Visibility
// Created: 2026-02-26

import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { getPublicSpaceBySlug, verifyPassword } from '../services/SpaceVisibilityService.js';
import { apiLogger } from '../utils/logger.js';
import { error, notFound, unauthorized } from '../utils/response.js';

// ============================================================
// ADR-105 AC11: Abuse-aware rate limiting for public routes
// ============================================================

/**
 * In-memory store for repeat offenders.
 * Key: IP string → { strikes: number, blockedUntil: number (epoch ms) }
 *
 * After 3 rate-limit hits within ABUSE_WINDOW_MS the IP is temporarily
 * blocked for BLOCK_DURATION_MS.  The store is periodically pruned so it
 * does not grow unbounded.
 */
const abuseStore = new Map();
const ABUSE_STRIKES_THRESHOLD = 3;
const ABUSE_WINDOW_MS = 5 * 60 * 1000;   // 5 minutes
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15-minute temp block
const PRUNE_INTERVAL_MS = 10 * 60 * 1000; // prune every 10 min

// Periodic cleanup so the Map doesn't leak memory
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of abuseStore) {
    if (now - entry.firstSeen > ABUSE_WINDOW_MS && now > (entry.blockedUntil || 0)) {
      abuseStore.delete(ip);
    }
  }
}, PRUNE_INTERVAL_MS).unref();

/**
 * Test-only helper: clear both the abuse-strike store and the rate-limit
 * counters so a long test file doesn't trip 30 req/min after a few cases.
 * Called from beforeEach() in `backend/routes/v3/__tests__/public.test.js`.
 */
export function __resetPublicAccessForTests() {
  abuseStore.clear();
  for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) {
    try { publicRateLimit.resetKey?.(ip); } catch { /* ignore */ }
  }
}

/**
 * Middleware: temporary IP block for repeat abusers.
 * Must be placed BEFORE the standard rate limiter.
 */
export function publicAbuseGuard(req, res, next) {
  // Bypass the abuse store under TEST_MODE so a long test file can hit many
  // public routes without tripping the 3-strike block (which would otherwise
  // shadow real failures behind 429s).
  if (process.env.TEST_MODE === 'true') return next();
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const entry = abuseStore.get(ip);
  const now = Date.now();

  if (entry && entry.blockedUntil && now < entry.blockedUntil) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      error: {
        code: 'PUBLIC_IP_BLOCKED',
        message: 'Your IP has been temporarily blocked due to excessive requests'
      },
      retryAfterSeconds: retryAfter,
      timestamp: new Date().toISOString()
    });
  }

  next();
}

/**
 * Stricter rate limiter for public (unauthenticated) routes.
 * 200 requests per minute per IP. Bypassed entirely under TEST_MODE so the
 * supertest harness can exercise many routes without re-keying the
 * internal counter (resetKey is async + unreliable across windows in
 * express-rate-limit v8).
 *
 * Why 200 and not 30: a single public-space page load fans out a full
 * read-only dashboard — getSpace + tree + dashboard + per-widget config
 * + per-widget data/documents/atoms — which is easily 20-40 requests for
 * one visit. The old 30/min ceiling tripped mid-load (→ generic
 * "Failed to load space"), and on carrier-grade NAT (mobile/LTE) a single
 * shared IP serves many visitors, so the limit was hit almost immediately.
 * Three trips in 5 min then escalated to a 15-min IP block (publicAbuseGuard),
 * producing the intermittent "sometimes opens, sometimes not" behaviour.
 */
export const publicRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.TEST_MODE === 'true',
  handler: (req, res) => {
    // Record strike for this IP (ADR-105 AC11: abuse detection)
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = abuseStore.get(ip);

    if (!entry || now - entry.firstSeen > ABUSE_WINDOW_MS) {
      entry = { strikes: 1, firstSeen: now, blockedUntil: 0 };
    } else {
      entry.strikes += 1;
    }

    if (entry.strikes >= ABUSE_STRIKES_THRESHOLD) {
      entry.blockedUntil = now + BLOCK_DURATION_MS;
      apiLogger.warn({ ip, strikes: entry.strikes }, '[PublicAccess] IP temporarily blocked for abuse');
    }

    abuseStore.set(ip, entry);

    res.status(429).json({
      success: false,
      error: {
        code: 'PUBLIC_RATE_LIMITED',
        message: 'Too many requests, please try again later'
      },
      timestamp: new Date().toISOString()
    });
  },
  validate: { xForwardedForHeader: false }
});

/**
 * Middleware: resolve public space by :slug parameter.
 *
 * 1. Extracts :slug from the URL.
 * 2. Looks up the space via SpaceVisibilityService.getPublicSpaceBySlug().
 * 3. If the space is password-protected, validates a session cookie.
 * 4. Attaches `req.publicSpace` on success.
 *
 * Error responses:
 * - 404 if slug not found or space is not external
 * - 401 with { requiresPassword: true } if password required and no valid session
 */
export async function publicSpaceAccess(req, res, next) {
  try {
    const { slug } = req.params;

    if (!slug) {
      return notFound(res, 'Space');
    }

    const space = await getPublicSpaceBySlug(slug);

    if (!space) {
      return notFound(res, 'Space');
    }

    // If space has a password, validate session cookie
    if (space.has_password) {
      const cookieName = `public_space_${space.id}`;
      const sessionToken = req.cookies?.[cookieName];

      if (!sessionToken) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'PASSWORD_REQUIRED',
            message: 'This space requires a password'
          },
          requiresPassword: true,
          timestamp: new Date().toISOString()
        });
      }

      // Validate session token format: <spaceId>:<hex>
      // We verify that the token was generated for this specific space
      const isValid = validateSessionToken(sessionToken, space.id);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'SESSION_EXPIRED',
            message: 'Your session has expired, please re-enter the password'
          },
          requiresPassword: true,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Attach space to request for downstream handlers
    req.publicSpace = space;
    next();
  } catch (err) {
    apiLogger.error({ err }, 'publicSpaceAccess middleware error');
    error(res, 'PUBLIC_ACCESS_ERROR', err.message, 500);
  }
}

/**
 * Handler: verify password for a protected public space.
 *
 * Expects :slug in params and { password } in request body.
 * On success: sets an httpOnly cookie with a session token and returns 200.
 * On failure: returns 401.
 */
export async function publicPasswordVerify(req, res) {
  try {
    const { slug } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Password is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    const space = await getPublicSpaceBySlug(slug);

    if (!space) {
      return notFound(res, 'Space');
    }

    const isCorrect = await verifyPassword(space.id, password);

    if (!isCorrect) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_PASSWORD',
          message: 'Incorrect password'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Generate session token and set cookie
    const sessionToken = generateSessionToken(space.id);
    const cookieName = `public_space_${space.id}`;

    res.cookie(cookieName, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/'
    });

    return res.status(200).json({
      success: true,
      data: { message: 'Password verified successfully' },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    apiLogger.error({ err }, 'publicPasswordVerify handler error');
    error(res, 'PASSWORD_VERIFY_ERROR', err.message, 500);
  }
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Generate a session token for a given space.
 * Format: <spaceId>:<hmac-hex>
 *
 * The HMAC is computed over `<spaceId>:<timestamp>` using a server secret,
 * ensuring tokens cannot be forged without access to the secret.
 */
function generateSessionToken(spaceId) {
  const secret = process.env.JWT_SECRET || 'default-public-session-secret';
  const timestamp = Date.now().toString(36);
  const payload = `${spaceId}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}:${hmac}`;
}

/**
 * Validate a session token for a given space.
 *
 * Token format: <spaceId>:<timestamp-base36>:<hmac-hex>
 * Checks:
 * 1. Token structure is correct.
 * 2. Space ID in token matches the expected spaceId.
 * 3. HMAC is valid (token was generated by this server).
 * 4. Token has not expired (24 hours).
 */
function validateSessionToken(token, spaceId) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const parts = token.split(':');
  if (parts.length !== 3) {
    return false;
  }

  const [tokenSpaceId, timestamp, providedHmac] = parts;

  // Check space ID matches
  if (String(tokenSpaceId) !== String(spaceId)) {
    return false;
  }

  // Verify HMAC
  const secret = process.env.JWT_SECRET || 'default-public-session-secret';
  const payload = `${tokenSpaceId}:${timestamp}`;
  const expectedHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(providedHmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
    return false;
  }

  // Check expiration (24 hours)
  const tokenTime = parseInt(timestamp, 36);
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  if (isNaN(tokenTime) || now - tokenTime > maxAge) {
    return false;
  }

  return true;
}
