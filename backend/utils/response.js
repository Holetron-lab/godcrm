// backend/utils/response.js
// Response Helpers - ADR-015
// Created: 2026-01-08

/**
 * Send success response
 * @param {import('express').Response} res 
 * @param {any} data - Response data
 * @param {string|number} messageOrStatus - Message string or HTTP status code (default: 200)
 * @param {number} statusCode - HTTP status code when message provided (default: 200)
 */
export function success(res, data, messageOrStatus = 200, statusCode = 200) {
  let message = null;
  let status = 200;
  
  if (typeof messageOrStatus === 'string') {
    message = messageOrStatus;
    status = statusCode;
  } else if (typeof messageOrStatus === 'number') {
    status = messageOrStatus;
  }
  
  const response = {
    success: true,
    data,
    timestamp: new Date().toISOString()
  };
  
  if (message) {
    response.message = message;
  }
  
  return res.status(status).json(response);
}

/**
 * Send created response (201)
 * @param {import('express').Response} res 
 * @param {any} data
 * @param {string} message - Optional message
 */
export function created(res, data, message = null) {
  if (message) {
    return success(res, data, message, 201);
  }
  return success(res, data, 201);
}

/**
 * Send no content response (204)
 * @param {import('express').Response} res 
 */
export function noContent(res) {
  return res.status(204).end();
}

/**
 * Send error response
 * @param {import('express').Response} res 
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {any} details - Additional error details
 */
export function error(res, code, message, statusCode = 500, details = null) {
  const response = {
    success: false,
    error: { code, message },
    timestamp: new Date().toISOString()
  };
  
  if (details) {
    response.error.details = details;
  }
  
  return res.status(statusCode).json(response);
}

/**
 * Send bad request (400)
 * @param {import('express').Response} res 
 * @param {string} message
 * @param {string} code
 */
export function badRequest(res, message, code = 'BAD_REQUEST') {
  return error(res, code, message, 400);
}

/**
 * Send unauthorized (401)
 * @param {import('express').Response} res 
 * @param {string} message
 */
export function unauthorized(res, message = 'Unauthorized') {
  return error(res, 'UNAUTHORIZED', message, 401);
}

/**
 * Send forbidden (403)
 * @param {import('express').Response} res 
 * @param {string} message
 */
export function forbidden(res, message = 'Forbidden') {
  return error(res, 'FORBIDDEN', message, 403);
}

/**
 * Send not found (404)
 * @param {import('express').Response} res 
 * @param {string} resource - Resource type that was not found
 */
export function notFound(res, resource = 'Resource') {
  return error(res, 'NOT_FOUND', `${resource} not found`, 404);
}

/**
 * Send conflict (409)
 * @param {import('express').Response} res 
 * @param {string} message
 */
export function conflict(res, message = 'Resource already exists') {
  return error(res, 'CONFLICT', message, 409);
}

/**
 * Send unprocessable entity (422)
 * @param {import('express').Response} res 
 * @param {string} message
 * @param {any} details
 */
export function unprocessable(res, message, details = null) {
  return error(res, 'UNPROCESSABLE_ENTITY', message, 422, details);
}

/**
 * Send internal server error (500)
 * @param {import('express').Response} res 
 * @param {string} message
 */
export function serverError(res, message = 'Internal server error') {
  return error(res, 'INTERNAL_ERROR', message, 500);
}

/**
 * Send paginated response
 * @param {import('express').Response} res 
 * @param {Array} data - Array of items
 * @param {Object} pagination - Pagination info
 * @param {number} pagination.page - Current page
 * @param {number} pagination.limit - Items per page
 * @param {number} pagination.total - Total items count
 */
export function paginated(res, data, pagination) {
  const { page, limit, total } = pagination;
  const totalPages = Math.ceil(total / limit);
  
  return res.json({
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages
    },
    timestamp: new Date().toISOString()
  });
}

/**
 * Send accepted response (202) for async operations
 * @param {import('express').Response} res 
 * @param {Object} data - Contains tracking info like jobId
 */
export function accepted(res, data) {
  return success(res, data, 202);
}
