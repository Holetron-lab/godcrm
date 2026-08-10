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
import { success, created, error, badRequest, notFound, forbidden, unauthorized } from '../../utils/response.js';

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
      SELECT u.id, u.email, u.name, u.user_type, u.avatar,
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
 * @returns {Promise<Object>} Result with API key
 */
export async function generateUserApiKey(userId, options = {}) {
  try {
    // Verify user exists
    const user = await dbGet(`
      SELECT id, name, user_type FROM users WHERE id = $1
    `, [userId]);
    
    if (!user) {
      return { success: false, error: 'User not found' };
    }
    
    const apiKey = generateApiKey();
    const keyHash = await bcrypt.hash(apiKey, 10);
    const keyName = options.name || `API Key for ${user.name}`;
    const keyPrefix = apiKey.substring(0, 15); // First 15 chars for prefix
    
    // Check if api_keys table exists
    const apiKeysTable = await dbGet(`
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'api_keys'
    `);
    
    if (apiKeysTable) {
      // Store key hash in api_keys table
      await dbRun(`
        INSERT INTO api_keys (user_id, key_prefix, key_hash, name, key_type, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'agent', NOW(), NOW())
      `, [userId, keyPrefix, keyHash, keyName]);
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
      SELECT id, name, email, avatar, avatar as avatar_url, role, user_type,
             managed_by_agent_table_id, managed_by_agent_row_id
      FROM users
      WHERE status IS NULL OR status != 'deleted'
      ORDER BY name
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
      name
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

export default router;
