// backend/middleware/rateLimiter.js
// SEC-020: Rate Limiting - ADR-015, ADR-064
// Created: 2026-01-08

import rateLimit from 'express-rate-limit';

const isProduction = process.env.NODE_ENV === 'production';

// Trusted IPs — bypass global & auth rate limiting (admin, server-to-server)
const TRUSTED_IPS = new Set([
  '<ADMIN_IP>',      // Admin
  '<LEGACY_IP>',   // PROD server
  '<DEV_IP>',    // DEV server
  '127.0.0.1',         // localhost
  '::1',               // localhost IPv6
  '::ffff:127.0.0.1',  // localhost IPv4-mapped
]);

function isTrustedIP(req) {
  return TRUSTED_IPS.has(req.ip);
}

// ADR-064: Environment-aware rate limit configuration
export const RATE_LIMIT_CONFIG = {
  global: { windowMs: 15 * 60 * 1000, max: isProduction ? 10000 : 15000 },
  auth: { windowMs: 15 * 60 * 1000, max: isProduction ? 50 : 100 }
};

/**
 * Global API rate limiter
 * Production: 1000 requests per 15 minutes per IP
 * Development: 3000 requests per 15 minutes per IP
 */
export const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.global.windowMs,
  max: RATE_LIMIT_CONFIG.global.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTrustedIP,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later'
    },
    timestamp: new Date().toISOString()
  },
  // Using default IP-based key generator (handles IPv6 correctly)
  validate: { xForwardedForHeader: false }
});

/**
 * Auth endpoints rate limiter
 * Production: 10 attempts per 15 minutes per IP
 * Development: 100 attempts per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
  max: RATE_LIMIT_CONFIG.auth.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isTrustedIP,
  message: {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMITED',
      message: 'Too many login attempts, please try again later'
    },
    timestamp: new Date().toISOString()
  },
  skipSuccessfulRequests: true // Don't count successful logins
});

/**
 * API Key rate limiter factory
 * 100 requests per minute per API key
 * @returns {import('express').RequestHandler}
 */
export function createApiKeyLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { 
        code: 'API_KEY_RATE_LIMITED', 
        message: 'API key rate limit exceeded, please slow down' 
      },
      timestamp: new Date().toISOString()
    },
    // Using default key generator, API key validation happens in middleware
    validate: { xForwardedForHeader: false }
  });
}

/**
 * Strict limiter for sensitive operations (password reset, etc)
 * 3 attempts per hour per IP
 */
export const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { 
      code: 'STRICT_RATE_LIMITED', 
      message: 'Too many attempts, please try again in an hour' 
    },
    timestamp: new Date().toISOString()
  }
});

/**
 * File upload limiter
 * 20 uploads per 10 minutes per IP
 */
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { 
      code: 'UPLOAD_RATE_LIMITED', 
      message: 'Too many uploads, please try again later' 
    },
    timestamp: new Date().toISOString()
  }
});

/**
 * Code execution rate limiter (ADR-032)
 * 30 executions per minute per IP
 * Prevents abuse of code execution resources
 */
export const codeExecutionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { 
      code: 'CODE_EXECUTION_RATE_LIMITED', 
      message: 'Too many code executions, please wait before trying again' 
    },
    timestamp: new Date().toISOString()
  }
});
