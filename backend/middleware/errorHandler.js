// backend/middleware/errorHandler.js
// Global Error Handler - ADR-015
// Created: 2026-01-08

import { logger } from '../utils/logger.js';
import { sendErrorAlert } from '../services/TelegramService.js';

/**
 * Application Error class with code and status
 * Use this for operational errors that should be shown to users
 */
export class AppError extends Error {
  /**
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   */
  constructor(code, message, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Not Found Error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

/**
 * Validation Error (400)
 */
export class ValidationError extends AppError {
  constructor(message, details = []) {
    super('VALIDATION_ERROR', message, 400);
    this.details = details;
  }
}

/**
 * Unauthorized Error (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

/**
 * Forbidden Error (403)
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

/**
 * Conflict Error (409)
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super('CONFLICT', message, 409);
  }
}

/**
 * Rate Limit Error (429)
 */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super('RATE_LIMITED', message, 429);
  }
}

/**
 * Database Error (500)
 */
export class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super('DATABASE_ERROR', message, 500);
  }
}

/**
 * Global error handling middleware
 * Must be registered LAST in Express middleware chain
 * 
 * @param {Error} err - Error object
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function errorHandler(err, req, res, next) {
  // Default values
  // BUG FIX: body-parser (express.json) sets err.status, not err.statusCode
  // Without checking err.status, JSON parse errors (SyntaxError) fall through to 500
  let statusCode = err.statusCode || err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred';
  let details = err.details || null;

  // Handle CORS errors — these are scanner/bot probes, not real 500s
  if (err.message === 'Not allowed by CORS' || err.message === 'CORS not configured') {
    statusCode = 403;
    code = 'CORS_BLOCKED';
    message = err.message;
    err.isOperational = true;
  }

  // Handle body-parser SyntaxError (malformed JSON in request body)
  // Mark as operational so production filter doesn't override status back to 500
  if (err.type === 'entity.parse.failed' && err instanceof SyntaxError) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON in request body';
    details = err.message;
    err.isOperational = true;
  }

  // Log the error
  const logContext = {
    err,
    requestId: req.id,
    method: req.method,
    path: req.path,
    userId: req.user?.id
  };

  if (statusCode >= 500) {
    logger.error(logContext, message);
  } else {
    logger.warn(logContext, message);
  }

  // Don't leak internal error details in production
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !err.isOperational) {
    message = 'An unexpected error occurred';
    code = 'INTERNAL_ERROR';
    statusCode = 500;
    details = null;
  }

  // Build error response
  const errorResponse = {
    success: false,
    error: { code, message },
    timestamp: new Date().toISOString()
  };

  if (details) {
    errorResponse.error.details = details;
  }

  // Include stack trace in development
  if (!isProduction && err.stack) {
    errorResponse.error.stack = err.stack.split('\n').slice(0, 5);
  }

  res.status(statusCode).json(errorResponse);

  // Send Telegram alert for 500+ errors (non-blocking)
  if (statusCode >= 500) {
    sendErrorAlert({
      method: req.method,
      path: req.path,
      statusCode,
      message: err.message || 'Unknown error',
      userId: req.user?.id,
      requestId: req.id,
      stack: err.stack
    }).catch(telegramErr => {
      logger.warn({ err: telegramErr.message }, 'Failed to send Telegram error alert');
    });
  }
}

/**
 * Async handler wrapper to catch errors in async route handlers
 * @param {Function} fn - Async route handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Not found handler for undefined routes
 */
export function notFoundHandler(req, res, next) {
  next(new NotFoundError('Route'));
}
