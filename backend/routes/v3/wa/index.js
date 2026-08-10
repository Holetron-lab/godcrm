/**
 * WorkAdventure Admin API Routes - ADR-063
 * Provides room access control and presence tracking for WorkAdventure
 * 
 * Endpoints:
 * - GET /api/v3/wa/map - Get map URL for user
 * - GET /api/v3/wa/room/access - Check room access
 * - GET /api/v3/wa/member - Get member info/tags
 * - POST /api/v3/wa/webhook - Receive join/leave events
 * - GET /api/v3/wa/presence - Get online users
 */

import express from 'express';
import crypto from 'crypto';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, badRequest, notFound, unauthorized, created } from '../../../utils/response.js';
import { getSecret } from '../../../services/secrets/getSecret.js';

const router = express.Router();

// ADR-0040: webhook secret resolved lazily via vault (env fallback during
// transition). The legacy 'test-webhook-secret' default is preserved for
// dev environments that never set the env var.
async function getWaWebhookSecret() {
  return (await getSecret('wa_webhook_secret', 'WA_WEBHOOK_SECRET')) || 'test-webhook-secret';
}

// Default map URL
const DEFAULT_MAP_URL = process.env.WA_DEFAULT_MAP_URL || '/maps/office/main.json';

// WorkAdventure URL
const WA_URL = process.env.WA_URL || 'https://wa.hltrn.cc';

// Token expiry time (5 minutes)
const TOKEN_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Parse room ID from playUri
 * @param {string} playUri - Full play URI (e.g., https://play.workadventure.localhost/@/crm/office/main)
 * @returns {string} Room ID (e.g., @/crm/office/main)
 */
function parseRoomId(playUri) {
  try {
    const url = new URL(playUri);
    return url.pathname;
  } catch {
    return playUri;
  }
}

/**
 * Check if room pattern matches room ID
 * @param {string} pattern - Room pattern (e.g., @/crm/public/*)
 * @param {string} roomId - Room ID (e.g., @/crm/public/lobby)
 * @returns {boolean} True if matches
 */
function matchRoomPattern(pattern, roomId) {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\*/g, '.*')
    .replace(/\//g, '\\/');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(roomId);
}

/**
 * Extract space ID from playUri or roomId
 * @param {string} playUri - Play URI (e.g., /_/global/wa.hltrn.cc/maps/space/123/office.json)
 * @returns {number|null} Space ID or null
 */
function extractSpaceId(playUri) {
  if (!playUri) return null;

  // Match /maps/space/{id}/ pattern
  const match = playUri.match(/\/maps\/space\/(\d+)\//);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Get user's role in a space
 * @param {number} userId - User ID
 * @param {number} spaceId - Space ID
 * @returns {Promise<string|null>} Role: 'owner', 'admin', 'editor', 'viewer', or null
 */
async function getUserSpaceRole(userId, spaceId) {
  // 1. Check if user is space owner
  const space = await dbGet('SELECT owner_id, access_control FROM spaces WHERE id = ?', [spaceId]);
  if (!space) return null;

  if (space.owner_id === userId) {
    return 'owner';
  }

  // 2. Check access_control for role
  if (space.access_control) {
    try {
      const ac = typeof space.access_control === 'string'
        ? JSON.parse(space.access_control)
        : space.access_control;

      // Old format: members array
      if (ac.members && Array.isArray(ac.members)) {
        const member = ac.members.find(m => m.user_id === userId);
        if (member) {
          return member.role || 'viewer';
        }
      }

      // New format: users_table_id with role_mappings
      if (ac.enabled && ac.users_table_id) {
        const userRow = await dbGet(
          `SELECT data FROM table_rows WHERE table_id = ? AND json_extract(data, '$.system_user_id') = ?`,
          [ac.users_table_id, userId]
        );

        if (userRow) {
          const data = typeof userRow.data === 'string' ? JSON.parse(userRow.data) : userRow.data;
          const roleColumnId = ac.role_column_id || ac.roleColumnId || 'role';
          const roleValue = data[roleColumnId];

          // Map role value to access level
          if (ac.role_mappings) {
            const mapping = ac.role_mappings.find(m => m.columnValue === roleValue);
            if (mapping) {
              return mapping.accessLevel;
            }
          }
          return roleValue || 'viewer';
        }
      }
    } catch (e) {
      apiLogger.warn({ spaceId, error: e.message }, 'Failed to parse access_control');
    }
  }

  return null;
}

/**
 * Get user tags based on role and space membership
 * @param {Object} user - User object
 * @param {number|null} spaceId - Space ID (optional, extracted from playUri)
 * @returns {Promise<string[]>} Array of tags
 */
async function getUserTags(user, spaceId = null) {
  const tags = [];

  // Global role-based tags
  if (user.role === 'admin' || user.role === 'owner') {
    tags.push('admin');
    tags.push('editor'); // Global admins can edit maps
  }

  if (user.role === 'user') {
    tags.push('member');
  }

  // Add user type tag
  if (user.user_type === 'agent') {
    tags.push('agent');
  }

  // Space-specific editor tag
  if (spaceId && !tags.includes('editor')) {
    const spaceRole = await getUserSpaceRole(user.id, spaceId);
    if (spaceRole === 'owner' || spaceRole === 'admin') {
      tags.push('editor');
      apiLogger.debug({ userId: user.id, spaceId, spaceRole }, 'User granted editor tag for space');
    }
  }

  return tags;
}

/**
 * GET /api/v3/wa/map
 * Returns the map URL for a user based on the requested room
 */
router.get('/map', async (req, res) => {
  try {
    // Check authentication
    if (!req.user) {
      return unauthorized(res, 'Authentication required');
    }

    const { playUri, userIdentifier } = req.query;
    const roomId = playUri ? parseRoomId(playUri) : null;

    apiLogger.debug({ roomId, userIdentifier }, 'WA map request');

    // Find matching room access rule
    let mapUrl = DEFAULT_MAP_URL;
    
    if (roomId) {
      const rules = await dbAll('SELECT * FROM wa_room_access ORDER BY id');
      
      for (const rule of rules) {
        if (matchRoomPattern(rule.room_pattern, roomId)) {
          if (rule.map_url) {
            mapUrl = rule.map_url;
          }
          break;
        }
      }
    }

    return success(res, { mapUrl });

  } catch (error) {
    apiLogger.error({ err: error }, 'WA map endpoint error');
    return badRequest(res, 'Failed to get map URL');
  }
});

/**
 * GET /api/v3/wa/room/access
 * Checks if a user has access to a specific room
 */
router.get('/room/access', async (req, res) => {
  try {
    // Check authentication
    if (!req.user) {
      return unauthorized(res, 'Authentication required');
    }

    const { playUri, userIdentifier } = req.query;
    const roomId = playUri ? parseRoomId(playUri) : null;

    if (!roomId) {
      return badRequest(res, 'playUri is required');
    }

    // Get user info
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return notFound(res, 'User');
    }

    // Extract spaceId for editor tag
    const spaceId = extractSpaceId(playUri);
    const userTags = await getUserTags(user, spaceId);

    apiLogger.debug({ roomId, userId: user.id, spaceId, userTags }, 'WA room access check');

    // Find matching room access rule
    const rules = await dbAll('SELECT * FROM wa_room_access ORDER BY id');
    
    let accessGranted = true;
    let reason = null;
    let ruleMatched = false;

    for (const rule of rules) {
      if (matchRoomPattern(rule.room_pattern, roomId)) {
        ruleMatched = true;
        
        // Check if room is public
        if (rule.is_public) {
          accessGranted = true;
          break;
        }

        // Check role requirement
        if (rule.required_role) {
          const requiredRoles = rule.required_role.split(',').map(r => r.trim());
          const hasRole = requiredRoles.some(role => 
            user.role === role || 
            (role === 'user' && ['user', 'admin', 'owner'].includes(user.role)) ||
            (role === 'admin' && ['admin', 'owner'].includes(user.role))
          );
          
          if (!hasRole) {
            accessGranted = false;
            reason = `Requires role: ${rule.required_role}`;
            break;
          }
        }

        // Check tag requirement
        if (rule.required_tags) {
          const requiredTags = JSON.parse(rule.required_tags || '[]');
          const hasTags = requiredTags.every(tag => userTags.includes(tag));
          
          if (!hasTags) {
            accessGranted = false;
            reason = `Requires tags: ${requiredTags.join(', ')}`;
            break;
          }
        }

        break;
      }
    }

    // If no explicit rule matched, check for restricted path patterns
    // Rooms with /admin/ in the path require admin role by default
    if (!ruleMatched && roomId.includes('/admin/')) {
      const isAdmin = user.role === 'admin' || user.role === 'owner';
      if (!isAdmin) {
        accessGranted = false;
        reason = 'Requires role: admin';
      }
    }

    return success(res, {
      access: accessGranted,
      tags: userTags,
      reason: accessGranted ? null : reason
    });

  } catch (error) {
    apiLogger.error({ err: error }, 'WA room access endpoint error');
    return badRequest(res, 'Failed to check room access');
  }
});

/**
 * GET /api/v3/wa/member
 * Returns member info including tags for WorkAdventure
 */
router.get('/member', async (req, res) => {
  try {
    // Check authentication
    if (!req.user) {
      return unauthorized(res, 'Authentication required');
    }

    const { userIdentifier, playUri } = req.query;

    // Get user by email or ID
    let user;
    if (userIdentifier) {
      user = await dbGet(
        'SELECT * FROM users WHERE email = ? OR id = ?',
        [userIdentifier, parseInt(userIdentifier) || 0]
      );
    } else {
      user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
    }

    if (!user) {
      return notFound(res, 'User');
    }

    // Extract spaceId for editor tag
    const spaceId = extractSpaceId(playUri);
    const tags = await getUserTags(user, spaceId);

    // Build textures array (custom character skins)
    const textures = [];
    if (user.avatar) {
      textures.push({
        id: 'avatar',
        url: user.avatar
      });
    }

    return success(res, {
      email: user.email,
      name: user.name,
      tags,
      textures,
      userRoomToken: null, // Can be used for room-specific tokens
      visitCardUrl: null,  // URL to user's profile card
      messages: []         // System messages to display
    });

  } catch (error) {
    apiLogger.error({ err: error }, 'WA member endpoint error');
    return badRequest(res, 'Failed to get member info');
  }
});

/**
 * POST /api/v3/wa/webhook
 * Receives join/leave events from WorkAdventure
 */
router.post('/webhook', async (req, res) => {
  try {
    // Validate webhook secret
    const webhookSecret = req.headers['x-wa-webhook-secret'];
    const expected = await getWaWebhookSecret();
    if (!webhookSecret || webhookSecret !== expected) {
      return unauthorized(res, 'Invalid webhook secret');
    }

    const { event, data } = req.body;

    apiLogger.debug({ event, data }, 'WA webhook received');

    if (!event || !data) {
      return badRequest(res, 'event and data are required');
    }

    // Get user by identifier
    const user = await dbGet(
      'SELECT * FROM users WHERE email = ?',
      [data.userIdentifier]
    );

    if (!user && (event === 'user.join' || event === 'user.leave')) {
      apiLogger.warn({ userIdentifier: data.userIdentifier }, 'Unknown user in webhook');
      return success(res, { processed: false, reason: 'unknown_user' });
    }

    switch (event) {
      case 'user.join': {
        // Record user joining a room
        await dbRun(
          `INSERT INTO wa_presence (user_id, room_id, status, joined_at, last_activity_at)
           VALUES (?, ?, 'online', ?, ?)`,
          [user.id, data.roomId, data.timestamp || new Date().toISOString(), new Date().toISOString()]
        );
        
        apiLogger.info({ userId: user.id, roomId: data.roomId }, 'User joined room');
        return success(res, { processed: true });
      }

      case 'user.leave': {
        // Update user leaving a room
        await dbRun(
          `UPDATE wa_presence 
           SET left_at = ?, status = 'offline'
           WHERE user_id = ? AND room_id = ? AND left_at IS NULL`,
          [data.timestamp || new Date().toISOString(), user.id, data.roomId]
        );
        
        apiLogger.info({ userId: user.id, roomId: data.roomId }, 'User left room');
        return success(res, { processed: true });
      }

      case 'user.move': {
        // Update user position (optional)
        if (data.position) {
          await dbRun(
            `UPDATE wa_presence 
             SET position_x = ?, position_y = ?, last_activity_at = ?
             WHERE user_id = ? AND room_id = ? AND left_at IS NULL`,
            [data.position.x, data.position.y, new Date().toISOString(), user.id, data.roomId]
          );
        }
        return success(res, { processed: true });
      }

      default:
        apiLogger.debug({ event }, 'Unknown webhook event');
        return success(res, { processed: false, reason: 'unknown_event' });
    }

  } catch (error) {
    apiLogger.error({ err: error }, 'WA webhook error');
    return badRequest(res, 'Failed to process webhook');
  }
});

/**
 * GET /api/v3/wa/presence
 * Returns online users, optionally filtered by room
 */
router.get('/presence', async (req, res) => {
  try {
    // Check authentication
    if (!req.user) {
      return unauthorized(res, 'Authentication required');
    }

    const { roomId } = req.query;

    let query = `
      SELECT 
        p.id,
        p.user_id,
        p.room_id,
        p.status,
        p.position_x,
        p.position_y,
        p.joined_at,
        p.last_activity_at,
        u.email,
        u.name,
        u.avatar,
        u.role
      FROM wa_presence p
      JOIN users u ON p.user_id = u.id
      WHERE p.status = 'online' AND p.left_at IS NULL
    `;
    const params = [];

    if (roomId) {
      query += ' AND p.room_id = ?';
      params.push(roomId);
    }

    query += ' ORDER BY p.joined_at DESC';

    const presenceRecords = await dbAll(query, params);

    const users = presenceRecords.map(record => ({
      userId: record.user_id,
      email: record.email,
      name: record.name,
      avatar: record.avatar,
      role: record.role,
      roomId: record.room_id,
      status: record.status,
      position: record.position_x !== null ? { x: record.position_x, y: record.position_y } : null,
      joinedAt: record.joined_at,
      lastActivityAt: record.last_activity_at
    }));

    return success(res, { users });

  } catch (error) {
    apiLogger.error({ err: error }, 'WA presence endpoint error');
    return badRequest(res, 'Failed to get presence');
  }
});

/**
 * POST /api/v3/wa/auth-token
 * Generates a one-time token for SSO login to WorkAdventure
 * Returns a URL that will auto-login the user
 */
router.post('/auth-token', async (req, res) => {
  try {
    // Check authentication
    if (!req.user) {
      return unauthorized(res, 'Authentication required');
    }

    // Generate secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

    // Store token in database
    await dbRun(
      `INSERT INTO wa_auth_tokens (token, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [token, req.user.id, expiresAt.toISOString()]
    );

    apiLogger.info({ userId: req.user.id }, 'WA auth token generated');

    // Return the login URL
    const loginUrl = `${WA_URL}/login-callback?token=${token}`;
    
    return created(res, {
      token,
      loginUrl,
      expiresAt: expiresAt.toISOString()
    }, 'Auth token generated');

  } catch (error) {
    apiLogger.error({ err: error }, 'WA auth-token endpoint error');
    return badRequest(res, 'Failed to generate auth token');
  }
});

/**
 * GET /api/v3/wa/login
 * Validates token and redirects to WorkAdventure with session
 * This is called by WorkAdventure's login-callback
 */
router.get('/login', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return badRequest(res, 'Token is required');
    }

    // Find and validate token
    const tokenRecord = await dbGet(
      `SELECT t.*, u.email, u.name, u.avatar, u.role
       FROM wa_auth_tokens t
       JOIN users u ON t.user_id = u.id
       WHERE t.token = $1 AND t.used_at IS NULL`,
      [token]
    );

    if (!tokenRecord) {
      apiLogger.warn({ token: token.substring(0, 8) + '...' }, 'Invalid or used WA token');
      return unauthorized(res, 'Invalid or expired token');
    }

    // Check expiry
    if (new Date(tokenRecord.expires_at) < new Date()) {
      apiLogger.warn({ userId: tokenRecord.user_id }, 'Expired WA token');
      return unauthorized(res, 'Token has expired');
    }

    // Mark token as used
    await dbRun(
      `UPDATE wa_auth_tokens SET used_at = $1 WHERE id = $2`,
      [new Date().toISOString(), tokenRecord.id]
    );

    apiLogger.info({ userId: tokenRecord.user_id }, 'WA token validated, returning user info');

    // Return user info for WorkAdventure to create session
    // Note: spaceId not available here, global roles only
    return success(res, {
      email: tokenRecord.email,
      name: tokenRecord.name,
      avatar: tokenRecord.avatar,
      tags: await getUserTags(tokenRecord),
      locale: 'en'
    });

  } catch (error) {
    apiLogger.error({ err: error }, 'WA login endpoint error');
    return badRequest(res, 'Failed to validate token');
  }
});

/**
 * GET /api/v3/wa/sso-url
 * Returns the WorkAdventure URL for the current user
 * WorkAdventure will handle OIDC authentication automatically
 * (redirecting to GOD CRM's /oauth/authorize endpoint)
 */
router.get('/sso-url', async (req, res) => {
  try {
    // Check authentication in CRM
    if (!req.user) {
      return unauthorized(res, 'Authentication required');
    }

    apiLogger.info({ userId: req.user.id }, 'WA SSO URL requested');

    // Return the plain WorkAdventure URL
    // WorkAdventure will detect unauthenticated user and redirect to OIDC provider (GOD CRM)
    // User is already logged in to CRM, so OIDC flow will auto-complete
    const ssoUrl = WA_URL;

    return success(res, {
      url: ssoUrl,
      note: 'WorkAdventure will redirect to GOD CRM OIDC for authentication'
    });

  } catch (error) {
    apiLogger.error({ err: error }, 'WA sso-url endpoint error');
    return badRequest(res, 'Failed to generate SSO URL');
  }
});

/**
 * GET /api/v3/wa/space-room/:spaceId
 * Returns WorkAdventure room URL for a specific CRM space
 * Each space gets its own isolated room (same map, different URL = different room)
 */
router.get('/space-room/:spaceId', async (req, res) => {
  try {
    if (!req.user) {
      return unauthorized(res, 'Authentication required');
    }

    const { spaceId } = req.params;

    if (!spaceId || isNaN(parseInt(spaceId))) {
      return badRequest(res, 'Valid spaceId is required');
    }

    // Verify space exists
    const space = await dbGet('SELECT id, name FROM spaces WHERE id = ?', [parseInt(spaceId)]);
    if (!space) {
      return notFound(res, 'Space');
    }

    // Build room URL — unique per space, served from same map template
    const roomUrl = `${WA_URL}/_/global/wa.hltrn.cc/maps/space/${space.id}/office.json`;

    apiLogger.info({ userId: req.user.id, spaceId: space.id, spaceName: space.name }, 'WA space room URL requested');

    return success(res, {
      roomUrl,
      spaceId: space.id,
      spaceName: space.name,
      mapUrl: `/maps/space/${space.id}/office.json`
    });

  } catch (error) {
    apiLogger.error({ err: error }, 'WA space-room endpoint error');
    return badRequest(res, 'Failed to get space room URL');
  }
});

export default router;
