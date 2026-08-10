/**
 * @swagger
 * components:
 *   schemas:
 *     ApiKey:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         key_prefix:
 *           type: string
 *         scopes:
 *           type: string
 *         rate_limit:
 *           type: integer
 *         expires_at:
 *           type: string
 *           format: date-time
 */
import { Router } from 'express';
import crypto from 'crypto';
import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, notFound, badRequest, forbidden, error } from '../../utils/response.js';

const router = Router();

/**
 * Generate a secure API key
 * Format: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (32 random hex chars)
 */
function generateApiKey() {
  const randomPart = crypto.randomBytes(16).toString('hex');
  return `sk-${randomPart}`;
}

/**
 * Hash API key for secure storage
 */
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Find api_keys_list table in System Data project of the space
 * @param {number} projectId - The current project ID
 * @returns {number|null} - Table ID or null if not found
 */
async function findApiKeysTable(projectId) {
  // First, get the space_id of the current project
  const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [projectId]);
  if (!project) return null;

  // Find System Data project in this space
  const systemDataProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [project.space_id]
  );
  if (!systemDataProject) return null;

  // Find api_keys_list table in System Data
  const apiKeysTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'api_keys_list'",
    [systemDataProject.id]
  );

  return apiKeysTable?.id || null;
}

/**
 * Find or create api_keys_list table in System Data project of the space
 * @param {number} projectId - The current project ID
 * @returns {number|null} - Table ID or null if failed
 */
async function findOrCreateApiKeysTable(projectId) {
  // First try to find existing table
  const existingTable = await findApiKeysTable(projectId);
  if (existingTable) return existingTable;

  // Get the space_id of the current project
  const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [projectId]);
  if (!project) return null;

  // Find System Data project in this space
  let systemDataProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [project.space_id]
  );

  // If no System Data project, create one
  if (!systemDataProject) {
    const now = new Date().toISOString();
    const result = await dbRun(
      "INSERT INTO projects (name, space_id, created_at, updated_at) VALUES ('System Data', ?, ?, ?)",
      [project.space_id, now, now]
    );
    systemDataProject = { id: result.lastInsertRowid };
    apiLogger.info(`[api-keys] Created System Data project ${systemDataProject.id} for space ${project.space_id}`);
  }

  // Create api_keys_list table
  const now = new Date().toISOString();
  const tableResult = await dbRun(
    "INSERT INTO universal_tables (name, display_name, project_id, created_at, updated_at) VALUES ('api_keys_list', 'API Keys', ?, ?, ?)",
    [systemDataProject.id, now, now]
  );
  const tableId = tableResult.lastInsertRowid;
  apiLogger.info(`[api-keys] Created api_keys_list table ${tableId} in project ${systemDataProject.id}`);

  // Create columns for the table
  const columns = [
    { column_name: 'name', display_name: 'Name', type: 'text', order_index: 0, is_visible: 1, is_required: 1 },
    { column_name: 'key_prefix', display_name: 'Key Prefix', type: 'text', order_index: 1, is_visible: 1, is_required: 0 },
    { column_name: 'key_hash', display_name: 'Key Hash', type: 'text', order_index: 2, is_visible: 0, is_required: 0 },
    { column_name: 'scopes', display_name: 'Scopes', type: 'text', order_index: 3, is_visible: 1, is_required: 0 },
    { column_name: 'rate_limit', display_name: 'Rate Limit', type: 'number', order_index: 4, is_visible: 1, is_required: 0 },
    { column_name: 'request_count', display_name: 'Requests', type: 'number', order_index: 5, is_visible: 1, is_required: 0 },
    { column_name: 'last_used_at', display_name: 'Last Used', type: 'date', order_index: 6, is_visible: 1, is_required: 0 },
    { column_name: 'expires_at', display_name: 'Expires At', type: 'date', order_index: 7, is_visible: 1, is_required: 0 },
    { column_name: 'is_active', display_name: 'Active', type: 'checkbox', order_index: 8, is_visible: 1, is_required: 0 },
    { column_name: 'created_at', display_name: 'Created At', type: 'date', order_index: 9, is_visible: 1, is_required: 0 },
    { column_name: 'agent_id', display_name: 'Agent', type: 'link', order_index: 10, is_visible: 1, is_required: 0 },
    { column_name: 'user_id', display_name: 'User', type: 'number', order_index: 11, is_visible: 0, is_required: 0 }
  ];

  for (const col of columns) {
    await dbRun(
      `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, is_required) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tableId, col.column_name, col.display_name, col.type, col.order_index, col.is_visible, col.is_required]
    );
  }

  apiLogger.info(`[api-keys] Created ${columns.length} columns for api_keys_list table`);
  return tableId;
}

/**
 * GET /api/v3/api-keys
 * List all API keys for a project (from api_keys_list table in System Data)
 * Query params: project_id (required) - filter by project
 * @swagger
 * /api/v3/api-keys:
 *   get:
 *     summary: List all API keys for a project
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: project_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of API keys
 */
router.get('/', async (req, res) => {
  try {
    const { project_id } = req.query;
    
    if (!project_id) {
      return badRequest(res, 'project_id is required');
    }

    // Find api_keys_list table for this space
    const tableId = await findApiKeysTable(project_id);
    if (!tableId) {
      apiLogger.debug(`[api-keys] api_keys_list table not found for project ${project_id}`);
      return success(res, []);
    }

    // Get all rows from api_keys_list
    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at DESC',
      [tableId]
    );

    // Parse data and return
    const keys = rows.map(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return {
        id: row.id,
        key_prefix: data.key_prefix || '',
        name: data.name || '',
        scopes: data.scopes ? (typeof data.scopes === 'string' ? JSON.parse(data.scopes) : data.scopes) : ['*'],
        rate_limit: data.rate_limit || 1000,
        request_count: data.request_count || 0,
        last_used_at: data.last_used_at || null,
        expires_at: data.expires_at || null,
        is_active: data.is_active !== false,
        created_at: data.created_at || null,
        agent_id: data.agent_id || null,
        user_id: data.user_id || null
      };
    });

    success(res, keys);
  } catch (err) {
    apiLogger.error('Error listing API keys:', err);
    error(res, 'INTERNAL_ERROR', 'Failed to list API keys', 500);
  }
});

/**
 * POST /api/v3/api-keys
 * Create a new API key (stores in api_keys_list table in System Data)
 * @swagger
 * /api/v3/api-keys:
 *   post:
 *     summary: Create a new API key
 *     tags: [API Keys]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, project_id]
 *             properties:
 *               name:
 *                 type: string
 *               project_id:
 *                 type: integer
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *               expires_in_days:
 *                 type: integer
 *     responses:
 *       201:
 *         description: API key created
 */
router.post('/', async (req, res) => {
  try {
    apiLogger.debug('[api-keys POST] Request body:', JSON.stringify(req.body));
    const { name, scopes = ['*'], expires_in_days, rate_limit = 1000, project_id, agent_id } = req.body;

    if (!name || name.trim().length === 0) {
      return badRequest(res, 'Name is required');
    }

    if (!project_id) {
      return badRequest(res, 'project_id is required');
    }

    // Find or create api_keys_list table for this space
    const tableId = await findOrCreateApiKeysTable(project_id);
    if (!tableId) {
      return error(res, 'INTERNAL_ERROR', 'Failed to create api_keys_list table in System Data.', 500);
    }

    // Generate API key
    const apiKey = generateApiKey();
    const keyPrefix = apiKey.substring(0, 7); // sk-xxxx
    const keyHash = hashApiKey(apiKey);

    // Calculate expiration date if specified
    let expiresAt = null;
    if (expires_in_days && expires_in_days > 0) {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + expires_in_days);
      expiresAt = expDate.toISOString();
    }

    const now = new Date().toISOString();

    // Create row data
    const rowData = {
      name: name.trim(),
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes: JSON.stringify(scopes),
      rate_limit: rate_limit,
      request_count: 0,
      last_used_at: null,
      expires_at: expiresAt,
      is_active: true,
      created_at: now,
      agent_id: agent_id || null,
      user_id: req.user.id
    };

    // Generate unique base_id for the row
    const baseId = `apikey_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Insert into table_rows
    const result = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [tableId, baseId, JSON.stringify(rowData), req.user.id, now, now]
    );

    // Return the full key ONLY on creation (never stored/shown again)
    created(res, {
      id: result.lastInsertRowid,
      key: apiKey, // ⚠️ IMPORTANT: Only shown once!
      key_prefix: keyPrefix,
      name: name.trim(),
      scopes,
      rate_limit,
      expires_at: expiresAt,
      created_at: now,
      message: '⚠️ Save this API key now! It will not be shown again.'
    });
  } catch (err) {
    apiLogger.error('Error creating API key:', err);
    error(res, 'INTERNAL_ERROR', 'Failed to create API key', 500);
  }
});

/**
 * PATCH /api/v3/api-keys/:id
 * Update API key (name, scopes, active status)
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, scopes, is_active, rate_limit, project_id } = req.body;

    if (!project_id) {
      return badRequest(res, 'project_id is required');
    }

    // Find api_keys_list table
    const tableId = await findApiKeysTable(project_id);
    if (!tableId) {
      return notFound(res, 'api_keys_list table');
    }

    // Get existing row
    const existingRow = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [id, tableId]
    );

    if (!existingRow) {
      return notFound(res, 'API key');
    }

    // Parse existing data
    const data = typeof existingRow.data === 'string' ? JSON.parse(existingRow.data) : existingRow.data;

    // Check ownership
    if (data.user_id !== req.user.id) {
      return forbidden(res, 'You can only edit your own API keys');
    }

    // Update fields
    if (name !== undefined) data.name = name.trim();
    if (scopes !== undefined) data.scopes = JSON.stringify(scopes);
    if (is_active !== undefined) data.is_active = is_active;
    if (rate_limit !== undefined) data.rate_limit = rate_limit;

    // Save
    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), id]
    );

    success(res, {
      id: parseInt(id),
      key_prefix: data.key_prefix,
      name: data.name,
      scopes: typeof data.scopes === 'string' ? JSON.parse(data.scopes) : data.scopes,
      rate_limit: data.rate_limit,
      is_active: data.is_active,
      expires_at: data.expires_at,
      created_at: data.created_at
    });
  } catch (err) {
    apiLogger.error('Error updating API key:', err);
    error(res, 'INTERNAL_ERROR', 'Failed to update API key', 500);
  }
});

/**
 * DELETE /api/v3/api-keys/:id
 * Delete (revoke) an API key
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { project_id } = req.query;

    if (!project_id) {
      return badRequest(res, 'project_id is required');
    }

    // Find api_keys_list table
    const tableId = await findApiKeysTable(project_id);
    if (!tableId) {
      return notFound(res, 'api_keys_list table');
    }

    // Get existing row
    const existingRow = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [id, tableId]
    );

    if (!existingRow) {
      return notFound(res, 'API key');
    }

    // Parse data and check ownership
    const data = typeof existingRow.data === 'string' ? JSON.parse(existingRow.data) : existingRow.data;
    if (data.user_id !== req.user.id) {
      return forbidden(res, 'You can only delete your own API keys');
    }

    await dbRun('DELETE FROM table_rows WHERE id = ?', [id]);

    success(res, { message: `API key "${data.name}" has been revoked` });
  } catch (err) {
    apiLogger.error('Error deleting API key:', err);
    error(res, 'INTERNAL_ERROR', 'Failed to delete API key', 500);
  }
});

/**
 * POST /api/v3/api-keys/:id/regenerate
 * Regenerate an API key (creates new key, invalidates old)
 */
router.post('/:id/regenerate', async (req, res) => {
  try {
    const { id } = req.params;
    const { project_id } = req.body;

    if (!project_id) {
      return badRequest(res, 'project_id is required');
    }

    // Find api_keys_list table
    const tableId = await findApiKeysTable(project_id);
    if (!tableId) {
      return notFound(res, 'api_keys_list table');
    }

    // Get existing row
    const existingRow = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [id, tableId]
    );

    if (!existingRow) {
      return notFound(res, 'API key');
    }

    // Parse data and check ownership
    const data = typeof existingRow.data === 'string' ? JSON.parse(existingRow.data) : existingRow.data;
    if (data.user_id !== req.user.id) {
      return forbidden(res, 'You can only regenerate your own API keys');
    }

    // Generate new key
    const apiKey = generateApiKey();
    const keyPrefix = apiKey.substring(0, 7);
    const keyHash = hashApiKey(apiKey);

    // Update data
    data.key_prefix = keyPrefix;
    data.key_hash = keyHash;
    data.request_count = 0;

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), id]
    );

    success(res, {
      id: parseInt(id),
      key: apiKey, // ⚠️ Only shown once!
      key_prefix: keyPrefix,
      name: data.name,
      scopes: typeof data.scopes === 'string' ? JSON.parse(data.scopes) : data.scopes,
      rate_limit: data.rate_limit,
      expires_at: data.expires_at,
      message: '⚠️ Save this new API key now! The old key has been invalidated.'
    });
  } catch (err) {
    apiLogger.error('Error regenerating API key:', err);
    error(res, 'INTERNAL_ERROR', 'Failed to regenerate API key', 500);
  }
});

export default router;
