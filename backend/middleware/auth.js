import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { dbGet, dbRun } from '../database/connection.js';
import { authLogger } from '../utils/logger.js';

/**
 * Hash API key for secure storage/comparison
 */
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Authenticate via API key
 * Supports: X-API-Key header or Authorization: Bearer sk-xxx
 * Returns: { success: boolean, user?: object, error?: string, details?: object }
 */
async function authenticateApiKey(apiKey) {
  // API keys start with 'sk-' prefix followed by 32 random chars
  // Format: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  if (!apiKey || !apiKey.startsWith('sk-')) {
    return { 
      success: false, 
      error: 'Invalid API key format',
      details: { expected: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }
    };
  }

  const keyPrefix = apiKey.substring(0, 7); // sk-xxxx
  const keyHash = hashApiKey(apiKey);

  // Find API key in database
  const keyRecord = await dbGet(`
    SELECT ak.*, u.id as user_id, u.email, u.name, u.role
    FROM api_keys ak
    JOIN users u ON ak.user_id = u.id
    WHERE ak.key_prefix = ? AND ak.key_hash = ?
  `, [keyPrefix, keyHash]);

  if (!keyRecord) {
    return { 
      success: false, 
      error: 'API key not found',
      details: { prefix: keyPrefix }
    };
  }

  // Check if key is active
  if (!keyRecord.is_active) {
    return { 
      success: false, 
      error: 'API key is disabled',
      details: { keyId: keyRecord.id, keyName: keyRecord.name }
    };
  }

  // Check expiration
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return { 
      success: false, 
      error: 'API key has expired',
      details: { 
        keyId: keyRecord.id, 
        keyName: keyRecord.name, 
        expiredAt: keyRecord.expires_at 
      }
    };
  }

  // Update usage stats (async, don't wait)
  dbRun(`
    UPDATE api_keys 
    SET last_used_at = CURRENT_TIMESTAMP, request_count = request_count + 1
    WHERE id = ?
  `, [keyRecord.id]).catch(err => authLogger.error({ err }, 'Failed to update API key usage stats'));

  // Return user object similar to JWT decode
  return {
    success: true,
    user: {
      id: keyRecord.user_id,
      email: keyRecord.email,
      name: keyRecord.name,
      role: keyRecord.role,
      apiKeyId: keyRecord.id,
      apiKeyName: keyRecord.name,
      scopes: JSON.parse(keyRecord.scopes || '["*"]'),
      // Access restrictions
      allowedSpaces: keyRecord.allowed_spaces ? JSON.parse(keyRecord.allowed_spaces) : null,
      allowedProjects: keyRecord.allowed_projects ? JSON.parse(keyRecord.allowed_projects) : null,
      allowedTables: keyRecord.allowed_tables ? JSON.parse(keyRecord.allowed_tables) : null
    }
  };
}

export async function authenticate(req, res, next) {
  // SEC-9: Removed debug logging for /tree paths
  
  // 1. Check for API Key in X-API-Key header
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader) {
    const result = await authenticateApiKey(apiKeyHeader);
    if (result.success) {
      req.user = result.user;
      req.authMethod = 'api_key';
      return next();
    }
    return res.status(401).json({ 
      success: false,
      error: {
        code: 'API_KEY_INVALID',
        message: result.error || 'Invalid API key',
        details: result.details || null
      }
    });
  }

  // 2. Check Authorization header (Bearer token - can be JWT or API key)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    
    // Check if it's an API key (starts with sk-)
    if (token.startsWith('sk-')) {
      const result = await authenticateApiKey(token);
      if (result.success) {
        req.user = result.user;
        req.authMethod = 'api_key';
        return next();
      }
      return res.status(401).json({ 
        success: false,
        error: {
          code: 'API_KEY_INVALID',
          message: result.error || 'Invalid API key',
          details: result.details || null
        }
      });
    }
    
    // Otherwise treat as JWT
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      req.authMethod = 'jwt';
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  // 3. Check JWT token in cookies (for browser sessions)
  const accessToken = req.cookies?.access_token;
  if (accessToken) {
    try {
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      req.user = decoded;
      req.authMethod = 'cookie';
      return next();
    } catch (error) {
      // Token expired or invalid - let it fall through to 401
    }
  }

  // 4. Check query param token (for SSE/EventSource which can't send headers)
  const queryToken = req.query?.token;
  if (queryToken) {
    try {
      const decoded = jwt.verify(queryToken, process.env.JWT_SECRET);
      req.user = decoded;
      req.authMethod = 'query_token';
      return next();
    } catch (error) {
      // Invalid token - fall through to 401
    }
  }

  // 5. No authentication provided
  return res.status(401).json({ error: 'No authentication provided. Use X-API-Key header or Authorization: Bearer <token>' });
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Middleware to check API key scopes
 * Usage: requireScope('tables:write')
 */
export function requireScope(scope) {
  return (req, res, next) => {
    // JWT/Cookie users have all permissions
    if (req.authMethod === 'jwt' || req.authMethod === 'cookie') {
      return next();
    }
    
    // Check API key scopes
    const scopes = req.user.scopes || [];
    if (scopes.includes('*') || scopes.includes(scope)) {
      return next();
    }
    
    return res.status(403).json({ 
      success: false,
      error: {
        code: 'INSUFFICIENT_SCOPE',
        message: `API key does not have required permission: ${scope}`,
        required: scope,
        available: scopes,
        keyName: req.user.apiKeyName || 'unknown'
      }
    });
  };
}

/**
 * Middleware to check access to specific resource (space/project/table)
 * Usage: requireResourceAccess('table', (req) => req.params.id)
 */
export function requireResourceAccess(resourceType, getResourceId) {
  return async (req, res, next) => {
    // JWT/Cookie users have all permissions
    if (req.authMethod === 'jwt' || req.authMethod === 'cookie') {
      return next();
    }
    
    const resourceId = typeof getResourceId === 'function' ? getResourceId(req) : getResourceId;
    if (!resourceId) {
      return next(); // No resource to check
    }
    
    const user = req.user;
    
    // Check based on resource type
    if (resourceType === 'space') {
      if (user.allowedSpaces && !user.allowedSpaces.includes(Number(resourceId))) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED_SPACE',
            message: `API key does not have access to space ${resourceId}`,
            resourceType: 'space',
            resourceId: resourceId,
            keyName: user.apiKeyName || 'unknown',
            allowedSpaces: user.allowedSpaces
          }
        });
      }
    }
    
    if (resourceType === 'project') {
      if (user.allowedProjects && !user.allowedProjects.includes(Number(resourceId))) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED_PROJECT',
            message: `API key does not have access to project ${resourceId}`,
            resourceType: 'project',
            resourceId: resourceId,
            keyName: user.apiKeyName || 'unknown',
            allowedProjects: user.allowedProjects
          }
        });
      }
    }
    
    if (resourceType === 'table') {
      if (user.allowedTables && !user.allowedTables.includes(Number(resourceId))) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED_TABLE',
            message: `API key does not have access to table ${resourceId}`,
            resourceType: 'table',
            resourceId: resourceId,
            keyName: user.apiKeyName || 'unknown',
            allowedTables: user.allowedTables
          }
        });
      }
    }
    
    return next();
  };
}

// Alias for compatibility
export const authMiddleware = authenticate;
