// backend/utils/logger.js
// LOG-001: Pino Logger - ADR-015
// Created: 2026-01-08

import pino from 'pino';
import crypto from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || process.env.TEST_MODE === 'true';

/**
 * Main application logger
 * Structured JSON logging with Pino
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : isTest ? 'silent' : 'debug'),
  
  // Pretty print in development only
  transport: (!isProduction && !isTest) ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined,
  
  // Base fields for all logs
  base: {
    service: 'godcrm',
    version: process.env.npm_package_version || '0.0.0',
    env: process.env.NODE_ENV || 'development'
  },
  
  // Redact sensitive information
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'password',
      'password_hash',
      'refreshToken',
      'accessToken',
      'token',
      'apiKey',
      'api_key',
      'secret',
      'encryption_key',
      'encryption_key_encrypted'
    ],
    remove: true
  },

  // Serializers for common objects
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      ip: req.ip || req.headers['x-forwarded-for'],
      userId: req.user?.id
    }),
    res: (res) => ({
      statusCode: res.statusCode
    }),
    err: pino.stdSerializers.err
  }
});

// ============================================================
// Module-specific child loggers
// ============================================================

export const dbLogger = logger.child({ module: 'database' });
export const authLogger = logger.child({ module: 'auth' });
export const apiLogger = logger.child({ module: 'api' });
export const webhookLogger = logger.child({ module: 'webhooks' });
export const fileLogger = logger.child({ module: 'files' });
export const aiLogger = logger.child({ module: 'ai' });
export const syncLogger = logger.child({ module: 'sync' });

// ============================================================
// Request logging middleware
// ============================================================

/**
 * Express middleware for request logging
 * Adds requestId and logs request/response
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requestLogger(req, res, next) {
  const startTime = Date.now();
  
  // Generate request ID if not present
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  
  // Create request-scoped logger
  req.log = apiLogger.child({ requestId: req.id });
  
  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      userId: req.user?.id,
      ip: req.ip || req.headers['x-forwarded-for']?.split(',')[0]
    };
    
    if (res.statusCode >= 500) {
      apiLogger.error(logData, 'Request error');
    } else if (res.statusCode >= 400) {
      apiLogger.warn(logData, 'Request warning');
    } else {
      apiLogger.info(logData, 'Request completed');
    }
  });
  
  next();
}

// ============================================================
// Utility functions
// ============================================================

/**
 * Create a child logger for a specific operation
 * @param {string} operation - Operation name
 * @param {Object} context - Additional context
 * @returns {pino.Logger}
 */
export function createOperationLogger(operation, context = {}) {
  return logger.child({ operation, ...context });
}

/**
 * Log database query (with timing)
 * @param {string} query - SQL query (sanitized)
 * @param {number} duration - Query duration in ms
 * @param {Object} context - Additional context
 */
export function logQuery(query, duration, context = {}) {
  dbLogger.debug({ query: query.substring(0, 200), duration, ...context }, 'SQL Query');
}

/**
 * Log authentication event
 * @param {string} event - Event type (login, logout, failed_login, etc.)
 * @param {Object} context - Event context
 */
export function logAuthEvent(event, context = {}) {
  authLogger.info({ event, ...context }, `Auth: ${event}`);
}

export default logger;
