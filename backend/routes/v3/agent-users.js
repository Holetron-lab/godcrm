/**
 * Agent User Routes
 * ADR-023: Agent-as-User & Infinite Chat Architecture
 * 
 * Endpoints for creating and managing AI agent users:
 * - POST /api/v3/users/create-agent-user - Create user linked to agent
 * - GET /api/v3/users/agents - List all agent users
 * - POST /api/v3/users/:id/generate-api-key - Generate API key for user
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     AgentUser:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         email:
 *           type: string
 *         is_agent:
 *           type: boolean
 *         agent_table_id:
 *           type: integer
 *         agent_row_id:
 *           type: integer
 */

import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { authenticate } from '../../middleware/auth.js';
import { dbGet, dbAll, dbRun, safeJsonParse } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound, forbidden, unauthorized, conflict } from '../../utils/response.js';
import { issuePassport, revokePassport } from '../../services/agent-users.js';
import { resolvePassportAuthority } from '../../services/passportAuthority.js';

const router = Router();

/**
 * Generate a unique agent email
 * @param {string} agentName - Name of the agent
 * @returns {string} Email in format: agent-name-hash@agents.godcrm.local
 */
function generateAgentEmail(agentName) {
  const slug = agentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const hash = crypto.randomBytes(4).toString('hex');
  return `${slug}-${hash}@agents.godcrm.local`;
}

/**
 * Generate API key for agent
 * @returns {string} API key in format: sk-agent-xxxxx
 */
function generateApiKey() {
  const key = crypto.randomBytes(32).toString('base64url');
  return `sk-agent-${key}`;
}

/**
 * Hash an API key for storage. Must stay byte-identical to hashApiKey() in
 * backend/middleware/auth.js and backend/routes/v3/api-keys.js — the auth path
 * looks a key up by `key_hash = sha256(key)`, so any other digest here silently
 * issues keys that never authenticate.
 * @param {string} key
 * @returns {string} hex sha256 digest
 */
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Create an agent user linked to an agent row
 * @param {Object} params - Creation parameters
 * @param {number} params.agentTableId - ID of the AI Agents table
 * @param {number} params.agentRowId - ID of the agent row
 * @param {string} [params.email] - Custom email (optional)
 * @param {string} [params.name] - Custom name (optional)
 * @param {Object} [params.agentConfig] - Agent configuration (optional)
 * @param {number} params.createdBy - ID of the user creating this agent user
 * @returns {Promise<Object>} Result with created user or error
 */
export async function createAgentUser({
  agentTableId,
  agentRowId,
  email,
  name,
  agentConfig,
  createdBy
}) {
  try {
    // Verify agent exists
    const agentRow = await dbGet(`
      SELECT tr.id, tr.data, ut.name as table_name
      FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      WHERE tr.id = $1 AND tr.table_id = $2
    `, [agentRowId, agentTableId]);
    
    if (!agentRow) {
      return { success: false, error: 'Agent not found' };
    }
    
    const agentData = safeJsonParse(agentRow.data) || {};
    const agentName = name || agentData.name || 'AI Agent';
    const agentEmail = email || generateAgentEmail(agentName);
    
    // Check if email already exists
    const existingUser = await dbGet(`
      SELECT id FROM users WHERE email = $1
    `, [agentEmail]);
    
    if (existingUser) {
      return { success: false, error: 'Email already exists' };
    }
    
    // Generate a random password (agent users authenticate via API key)
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 10);
    
    // Create encryption key (required by users table)
    const encryptionKey = crypto.randomBytes(32).toString('hex');
    
    // Build agent config
    const defaultConfig = {
      auto_respond: true,
      respond_only_when_mentioned: false,
      competence_check: { enabled: false },
      ignore_patterns: [],
      max_response_tokens: 2000,
      context_settings: {
        max_history: 50,
        include_summaries: true
      }
    };
    
    const finalConfig = { ...defaultConfig, ...agentConfig };
    
    // Insert user
    const result = await dbRun(`
      INSERT INTO users (
        email, password_hash, name, role, user_type,
        managed_by_agent_table_id, managed_by_agent_row_id,
        agent_config, encryption_key_encrypted,
        created_at, updated_at
      ) VALUES ($1, $2, $3, 'user', 'agent', $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, email, name, user_type, managed_by_agent_table_id, managed_by_agent_row_id, agent_config
    `, [
      agentEmail,
      passwordHash,
      agentName,
      agentTableId,
      agentRowId,
      JSON.stringify(finalConfig),
      encryptionKey
    ]);
    
    const userId = result.id || result.lastInsertRowid;
    
    // Fetch created user
    const user = await dbGet(`
      SELECT id, email, name, user_type, managed_by_agent_table_id, 
             managed_by_agent_row_id, agent_config, created_at
      FROM users WHERE id = $1
    `, [userId]);
    
    if (user && user.agent_config) {
      user.agent_config = safeJsonParse(user.agent_config);
    }
    
    apiLogger.info({ 
      context: 'AgentUser', 
      userId, 
      agentRowId, 
      email: agentEmail 
    }, 'Created agent user');
    
    return { success: true, user };
  } catch (error) {
    apiLogger.error({ err: error, context: 'AgentUser' }, 'Failed to create agent user');
    return { success: false, error: error.message };
  }
}

/**
 * Get all agent users
 * @param {Object} [options] - Query options
 * @param {number} [options.spaceId] - Filter by space
 * @returns {Promise<Object>} Result with users array
 */
export async function getAgentUsers(options = {}) {
  try {
    let query = `
      SELECT u.id, u.email, u.name, u.user_type, u.avatar, u.handle,
             u.managed_by_agent_table_id, u.managed_by_agent_row_id,
             u.agent_config, u.created_at, u.updated_at,
             tr.data as agent_data
      FROM users u
      LEFT JOIN table_rows tr ON tr.id = u.managed_by_agent_row_id
      WHERE u.user_type = 'agent'
    `;
    
    const params = [];
    
    if (options.spaceId) {
      query += `
        AND EXISTS (
          SELECT 1 FROM universal_tables ut
          JOIN projects p ON ut.project_id = p.id
          WHERE ut.id = u.managed_by_agent_table_id
          AND p.space_id = $1
        )
      `;
      params.push(options.spaceId);
    }
    
    query += ` ORDER BY u.created_at DESC`;
    
    const users = await dbAll(query, params);
    
    // Parse JSON fields
    const parsedUsers = users.map(user => ({
      ...user,
      agent_config: safeJsonParse(user.agent_config),
      agent_data: safeJsonParse(user.agent_data)
    }));
    
    return { success: true, users: parsedUsers };
  } catch (error) {
    apiLogger.error({ err: error, context: 'AgentUser' }, 'Failed to get agent users');
    return { success: false, error: error.message, users: [] };
  }
}

/**
 * Generate API key for a user
 * @param {number} userId - User ID
 * @param {Object} options - Options
 * @param {number} options.createdBy - ID of user creating the key
 * @param {string} [options.name] - Key name/description
 * @param {number} [options.projectId] - Project the key belongs to; defaults to
 *        the project that owns the agent's residence table
 * @returns {Promise<Object>} Result with API key
 */
export async function generateUserApiKey(userId, options = {}) {
  try {
    // Verify user exists
    const user = await dbGet(`
      SELECT u.id, u.name, u.user_type, u.agent_config, t.project_id
      FROM users u LEFT JOIN universal_tables t ON t.id = u.managed_by_agent_table_id
      WHERE u.id = $1
    `, [userId]);

    if (!user) {
      return { success: false, error: 'User not found' };
    }
    
    const projectId = options.projectId ?? user.project_id;
    if (!projectId) return { success: false, error: 'User has no agent project for API key' };

    const apiKey = generateApiKey();
    // Hash and prefix MUST match what authenticateApiKey() looks the key up by
    // (backend/middleware/auth.js): sha256 of the whole key, and the first 7
    // chars as the prefix. This used to store a bcrypt digest under a 15-char
    // prefix — both halves of the lookup missed, so a key issued here could
    // never authenticate. 15 of the 18 `agent` rows on master A still carry the
    // bcrypt shape and are dead; they need reissuing, not migrating.
    const keyHash = hashApiKey(apiKey);
    const keyName = options.name || `API Key for ${user.name}`;
    const keyPrefix = apiKey.substring(0, 7);

    // Check if api_keys table exists
    const apiKeysTable = await dbGet(`
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'api_keys'
    `);

    if (apiKeysTable) {
      // Store key hash in api_keys table
      await dbRun(`
        INSERT INTO api_keys (user_id, key_prefix, key_hash, name, key_type, project_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'agent', $5, NOW(), NOW())
      `, [userId, keyPrefix, keyHash, keyName, projectId]);
    } else {
      apiLogger.warn({ context: 'AgentUser' }, 'api_keys table not found, storing key in user record');
      // Fallback: store in agent_config
      const currentConfig = safeJsonParse(user.agent_config) || {};
      currentConfig.api_key_hash = keyHash;
      
      await dbRun(`
        UPDATE users SET agent_config = $1, updated_at = NOW()
        WHERE id = $2
      `, [JSON.stringify(currentConfig), userId]);
    }
    
    apiLogger.info({ context: 'AgentUser', userId }, 'Generated API key');
    
    return { 
      success: true, 
      apiKey,
      message: 'Store this key securely - it will not be shown again'
    };
  } catch (error) {
    apiLogger.error({ err: error, context: 'AgentUser' }, 'Failed to generate API key');
    return { success: false, error: error.message };
  }
}

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/v3/users/create-agent-user
 * Create a new user linked to an AI agent
 * @swagger
 * /api/v3/users/create-agent-user:
 *   post:
 *     summary: Create a new user linked to an AI agent
 *     tags: [Agent Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [agentTableId, agentRowId]
 *             properties:
 *               agentTableId:
 *                 type: integer
 *               agentRowId:
 *                 type: integer
 *               email:
 *                 type: string
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Agent user created
 */
/**
 * GET /api/v3/users
 * List all system users (for access management, user pickers, etc.)
 */
router.get('/', async (req, res) => {
  try {
    const users = await dbAll(`
      SELECT u.id, u.name, u.email, u.avatar, u.avatar as avatar_url, u.role, u.user_type,
             u.managed_by_agent_table_id, u.managed_by_agent_row_id,
             COALESCE(ar.data->>'color', u.color) AS color, ar.data->>'icon' AS agent_icon
      FROM users u
      LEFT JOIN table_rows ar ON ar.id = u.managed_by_agent_row_id AND ar.table_id = u.managed_by_agent_table_id
      WHERE u.status IS NULL OR u.status != 'deleted'
      ORDER BY u.name
    `);
    success(res, users || []);
  } catch (err) {
    apiLogger.error({ err }, 'GET /users error');
    error(res, 'Failed to fetch users');
  }
});

router.post('/create-agent-user', async (req, res) => {
  try {
    const { agentTableId, agentRowId, email, name, agentConfig } = req.body;
    const userId = req.user?.id;
    
    if (!agentTableId || !agentRowId) {
      return badRequest(res, 'agentTableId and agentRowId are required');
    }
    
    const result = await createAgentUser({
      agentTableId: Number(agentTableId),
      agentRowId: Number(agentRowId),
      email,
      name,
      agentConfig,
      createdBy: userId
    });
    
    if (!result.success) {
      return badRequest(res, result.error);
    }
    
    success(res, result.user);
  } catch (err) {
    apiLogger.error({ err, context: 'AgentUser Route' }, 'Error creating agent user');
    error(res, 'Failed to create agent user');
  }
});

/**
 * GET /api/v3/users/agents
 * List all agent users
 * @swagger
 * /api/v3/users/agents:
 *   get:
 *     summary: List all agent users
 *     tags: [Agent Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: spaceId
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of agent users
 */
router.get('/agents', async (req, res) => {
  try {
    const { spaceId } = req.query;
    
    const result = await getAgentUsers({
      spaceId: spaceId ? Number(spaceId) : undefined
    });
    
    success(res, result.users);
  } catch (err) {
    apiLogger.error({ err, context: 'AgentUser Route' }, 'Error fetching agent users');
    error(res, 'Failed to fetch agent users');
  }
});

/**
 * POST /api/v3/users/:id/generate-api-key
 * Generate API key for a user (typically an agent user)
 */
router.post('/:id/generate-api-key', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user?.id;
    
    const result = await generateUserApiKey(Number(id), {
      createdBy: userId,
      name,
      projectId: req.user?.projectId,
    });
    
    if (!result.success) {
      return badRequest(res, result.error);
    }
    
    success(res, { apiKey: result.apiKey, message: result.message });
  } catch (err) {
    apiLogger.error({ err, context: 'AgentUser Route' }, 'Error generating API key');
    error(res, 'Failed to generate API key');
  }
});

/**
 * GET /api/v3/users/:id/agent-info
 * Get agent information for an agent user
 */
router.get('/:id/agent-info', async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await dbGet(`
      SELECT u.id, u.name, u.user_type, u.managed_by_agent_table_id,
             u.managed_by_agent_row_id, u.agent_config,
             tr.data as agent_data
      FROM users u
      LEFT JOIN table_rows tr ON tr.id = u.managed_by_agent_row_id
      WHERE u.id = $1
    `, [id]);
    
    if (!user) {
      return notFound(res, 'User not found');
    }
    
    if (user.user_type !== 'agent') {
      return badRequest(res, 'User is not an agent');
    }
    
    success(res, {
      id: user.id,
      name: user.name,
      user_type: user.user_type,
      agent_config: safeJsonParse(user.agent_config),
      agent_data: safeJsonParse(user.agent_data)
    });
  } catch (err) {
    apiLogger.error({ err, context: 'AgentUser Route' }, 'Error fetching agent info');
    error(res, 'Failed to fetch agent info');
  }
});

// ─── ADR-165 WP-4 — naturalization, gated by passport authority ─────────
//
// The only authorized path for issuing/revoking a passport. The tool path
// (issue_passport / revoke_passport) is refused for every principal by the
// OWNER_ONLY set in executeTool(), so without these routes there would be no
// issuance path at all.
//
// Who may act (conversation 3692): the same human must be a global admin
// (users.role owner|admin) AND an admin of the agent's residence space —
// see services/passportAuthority.js. The residence is derived from the
// target user, never from the request body.

const PASSPORT_DENIAL_MESSAGES = {
  not_authenticated: 'Authentication required',
  agent_principal: 'Agents cannot issue or revoke passports',
  global_role_required: 'A global admin role is required to manage passports',
  space_admin_required: "Admin access in the agent's space is required to manage passports",
};

/**
 * Passport authority gate for the issue/revoke routes. Returns true when the
 * caller may act; otherwise writes the refusal (403 with the machine-readable
 * reason, 404 for an unresolvable residence) and returns false.
 */
async function requirePassportAuthority(req, res, userId) {
  if (!req.user?.id) {
    forbidden(res, PASSPORT_DENIAL_MESSAGES.not_authenticated);
    return false;
  }
  const authority = await resolvePassportAuthority({ actorUserId: req.user.id, userId });
  if (authority.allowed) return true;
  if (authority.reason === 'residence_not_found') {
    notFound(res, 'Agent passport');
    return false;
  }
  error(res, 'PASSPORT_FORBIDDEN', PASSPORT_DENIAL_MESSAGES[authority.reason] || 'Forbidden', 403, {
    reason: authority.reason,
    authority,
  });
  return false;
}

/**
 * GET /api/v3/users/passport-authority?row_id=|user_id=|space_id=
 * The UI contract for both passport gates (agent settings, roster): returns
 * the same decision the issue/revoke routes enforce. A denial is a 200 with
 * `allowed:false` + `reason` — the decision is the payload, not an error.
 */
router.get('/passport-authority', async (req, res) => {
  if (!req.user?.id) return forbidden(res, PASSPORT_DENIAL_MESSAGES.not_authenticated);
  const targets = {};
  for (const [param, key] of [['row_id', 'rowId'], ['user_id', 'userId'], ['space_id', 'spaceId']]) {
    if (req.query[param] === undefined) continue;
    const n = Number(req.query[param]);
    if (!Number.isInteger(n) || n <= 0) return badRequest(res, `Invalid ${param}`);
    targets[key] = n;
  }
  if (Object.keys(targets).length === 0) return badRequest(res, 'One of row_id, user_id or space_id is required');
  try {
    const authority = await resolvePassportAuthority({
      actorUserId: req.user.id, rowId: targets.rowId, userId: targets.userId, spaceId: targets.spaceId,
    });
    return success(res, authority);
  } catch (err) {
    apiLogger.error({ err, context: 'AgentUser Route' }, 'Passport authority check failed');
    return error(res, 'PASSPORT_AUTHORITY_FAILED', 'Failed to resolve passport authority', 500);
  }
});

/**
 * Map a service-level refusal onto an HTTP status. The service returns
 * structured `{ ok:false, error, message }` rather than throwing.
 */
function passportFailure(res, result) {
  if (result.error === 'residence_not_found' || result.error === 'passport_not_found') {
    return notFound(res, 'Agent passport');
  }
  if (result.error === 'handle_taken') {
    return conflict(res, result.message);
  }
  return badRequest(res, result.message || result.error, result.error);
}

/**
 * POST /api/v3/users/:id/passport
 * Naturalize an agent user — grant the global `<<@handle>>` passport.
 * Body: { handle?: string }  (falls back to the agent row's slug/name)
 */
router.post('/:id/passport', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return badRequest(res, 'Invalid user id');
    }
    if (!(await requirePassportAuthority(req, res, userId))) return;
    // `audit_req` threads the real request into the hash-chained audit row the
    // service writes (WP-4 D4) — same entry the tool path produces, but signed
    // by an actual human session rather than by the channel.
    const result = await issuePassport({
      user_id: userId,
      handle: req.body?.handle,
      actor: req.user.id,
      audit_req: req,
    });
    if (!result.ok) return passportFailure(res, result);
    return success(res, result);
  } catch (err) {
    apiLogger.error({ err, context: 'AgentUser Route' }, 'Passport issue failed');
    return error(res, 'PASSPORT_ISSUE_FAILED', 'Failed to issue passport', 500);
  }
});

/**
 * DELETE /api/v3/users/:id/passport
 * Soft-revoke the passport: the handle is cleared, the user row is kept.
 */
router.delete('/:id/passport', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return badRequest(res, 'Invalid user id');
    }
    if (!(await requirePassportAuthority(req, res, userId))) return;
    const result = await revokePassport({ user_id: userId, actor: req.user.id, audit_req: req });
    if (!result.ok) return passportFailure(res, result);
    return success(res, result);
  } catch (err) {
    apiLogger.error({ err, context: 'AgentUser Route' }, 'Passport revoke failed');
    return error(res, 'PASSPORT_REVOKE_FAILED', 'Failed to revoke passport', 500);
  }
});

export default router;
