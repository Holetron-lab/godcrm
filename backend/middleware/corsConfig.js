// backend/middleware/corsConfig.js
// ADR-064 Phase 1 Task 4: Strict CORS in Production
// Extracted CORS origin handler for testability and security

import { logger } from '../utils/logger.js';

/**
 * Parse CORS_ORIGINS environment variable into an array of allowed origins.
 * Returns null if not configured.
 * @returns {string[] | null}
 */
function parseAllowedOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return null;

  const origins = raw.split(',').map((origin) => origin.trim()).filter(Boolean);
  return origins.length > 0 ? origins : null;
}

/**
 * Create a CORS origin handler function compatible with the `cors` middleware.
 *
 * Behavior:
 * - Production + no CORS_ORIGINS: reject ALL requests with error (security fail-safe)
 * - Any env + no origin header (server-to-server, curl): allow
 * - Dev + no CORS_ORIGINS: allow all origins (permissive for local development)
 * - Whitelist configured: check origin against whitelist
 *
 * @returns {(origin: string | undefined, callback: Function) => void}
 */
export function createCorsOriginHandler() {
  const allowedOrigins = parseAllowedOrigins();
  const isProduction = process.env.NODE_ENV === 'production';

  return (origin, callback) => {
    // ADR-064: In production, CORS_ORIGINS must be set
    if (isProduction && (!allowedOrigins || !allowedOrigins.length)) {
      logger.error('CORS_ORIGINS not configured in production!');
      return callback(new Error('CORS not configured'));
    }

    // Allow requests with no origin (server-to-server, curl) or null origin (UXP desktop plugins, file://)
    if (!origin || origin === 'null') return callback(null, true);

    // Dev: allow all if no origins configured
    if (!allowedOrigins || !allowedOrigins.length) return callback(null, true);

    // Check whitelist
    if (allowedOrigins.includes(origin)) return callback(null, true);

    logger.warn({ origin }, 'Blocked CORS origin');
    return callback(new Error('Not allowed by CORS'));
  };
}
