// API Routes v3: Data Sources Management
/**
 * @swagger
 * components:
 *   schemas:
 *     DataSource:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         type:
 *           type: string
 *           enum: [postgres, mysql, sqlite, api, csv]
 *         workspace_id:
 *           type: integer
 *         config:
 *           type: object
 */
import express from 'express';
import DataSourceService from '../../services/DataSourceService.js';
// SEC-6: Use connection.js instead of init.js for database operations
import { dbRun, dbGet, dbAll } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound, forbidden, unauthorized } from '../../utils/response.js';
// ADR-064 Task 5: Encrypt data source credentials
import { encryptCredential, sanitizeCredentialsForResponse } from '../../utils/encryption.js';

const router = express.Router();
const dataSourceService = new DataSourceService();

/**
 * SEC-2: Check if user has access to space (owner or admin)
 */
async function checkSpaceAccess(spaceId, userId, userRole) {
  if (!spaceId) return { allowed: false, error: 'Space ID required', status: 400 };
  
  const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [spaceId]);
  
  if (!space) {
    return { allowed: false, error: 'Space not found', status: 404 };
  }
  
  const isOwner = space.owner_id === userId;
  const isAdmin = userRole === 'admin' || userRole === 'owner';
  
  if (!isOwner && !isAdmin) {
    return { allowed: false, error: 'Access denied to this workspace', status: 403 };
  }
  
  return { allowed: true, space };
}

/**
 * SEC-2: Check access via project_id (resolve to space first)
 */
async function checkProjectAccess(projectId, userId, userRole) {
  if (!projectId) return { allowed: false, error: 'Project ID required', status: 400 };
  
  const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [projectId]);
  
  if (!project) {
    return { allowed: false, error: 'Project not found', status: 404 };
  }
  
  return checkSpaceAccess(project.space_id, userId, userRole);
}

/**
 * GET /api/v3/data-sources?workspace_id={id}
 * List all data sources for a workspace
 * @swagger
 * /api/v3/data-sources:
 *   get:
 *     summary: List all data sources for a workspace
 *     tags: [Data Sources]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: workspace_id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of data sources
 */
router.get('/', async (req, res) => {
  try {
    const { workspace_id, project_id } = req.query;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    
    // Support both workspace_id (space_id) and project_id
    let spaceId = workspace_id;
    
    if (!spaceId && !project_id) {
      return badRequest(res, 'workspace_id or project_id query parameter is required');
    }
    
    // If project_id is provided, or workspace_id looks like a project, resolve to space_id
    if (project_id || workspace_id) {
      // First try to find as space
      const space = await dbGet('SELECT id FROM spaces WHERE id = ?', [workspace_id || project_id]);
      if (!space) {
        // Not a space, try as project
        const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [workspace_id || project_id]);
        if (project) {
          spaceId = project.space_id;
        }
      }
    }
    
    if (!spaceId) {
      return notFound(res, 'Workspace or project not found');
    }

    // SEC-2: Verify user has access to this workspace
    const access = await checkSpaceAccess(spaceId, userId, userRole);
    if (!access.allowed) {
      if (access.status === 403) return forbidden(res, access.error);
      if (access.status === 404) return notFound(res, access.error);
      return badRequest(res, access.error);
    }

    const dataSources = await dataSourceService.list(spaceId);

    // ADR-064: Sanitize credentials before returning in API response
    const sanitized = dataSources.map(ds => sanitizeCredentialsForResponse(ds));

    return success(res, sanitized);
  } catch (err) {
    apiLogger.error('Error listing data sources:', err);
    return error(res, err.message);
  }
});

/**
 * GET /api/v3/data-sources/:id
 * Get a single data source by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const dataSource = await dataSourceService.get(id);
    
    if (!dataSource) {
      return notFound(res, `Data source with id '${id}' not found`);
    }

    // ADR-064: Sanitize credentials before returning in API response
    return success(res, sanitizeCredentialsForResponse(dataSource));
  } catch (err) {
    apiLogger.error('Error getting data source:', err);
    return error(res, err.message);
  }
});

/**
 * POST /api/v3/data-sources
 * Create a new data source
 * @swagger
 * /api/v3/data-sources:
 *   post:
 *     summary: Create a new data source
 *     tags: [Data Sources]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DataSource'
 *     responses:
 *       201:
 *         description: Data source created
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    
    apiLogger.debug('[POST /data-sources] Request received:', {
      userId,
      body: req.body
    });
    
    if (!userId) {
      apiLogger.error('[POST /data-sources] No user ID');
      return unauthorized(res, 'User not authenticated');
    }

    // Map frontend format to backend format
    const { 
      workspace_id, // This is actually project_id from frontend
      table_id, // Optional: link to specific table
      name, 
      description, 
      type, 
      host, 
      port, 
      database, 
      username, 
      password = '', // Default to empty string for root without password
      use_ssh,
      ssh_host,
      ssh_port,
      ssh_user,
      ssh_private_key
    } = req.body;

    apiLogger.debug('[POST /data-sources] Parsed fields:', {
      workspace_id, name, type, host, port, database, username, use_ssh
    });

    // Validate required fields
    if (!workspace_id || !name || !type || !host || !database || !username) {
      apiLogger.error('[POST /data-sources] Validation failed');
      return badRequest(res, 'Missing required fields: workspace_id, name, type, host, database, username');
    }

    // SEC-2: Verify user has access to project's workspace
    const access = await checkProjectAccess(workspace_id, userId, userRole);
    if (!access.allowed) {
      if (access.status === 403) return forbidden(res, access.error);
      if (access.status === 404) return notFound(res, access.error);
      return badRequest(res, access.error);
    }

    // Get space_id from project_id (workspace_id is actually project_id)
    const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [workspace_id]);
    const spaceId = project?.space_id || workspace_id;
    
    apiLogger.debug('[POST /data-sources] Resolved spaceId:', spaceId, 'from projectId:', workspace_id);

    // ADR-064: Encrypt credentials before storing in database
    const encryptedPwd = encryptCredential(password);
    const encryptedSshKey = (use_ssh && ssh_private_key) ? encryptCredential(ssh_private_key) : null;

    const params = {
      workspaceId: spaceId, // Use space_id as workspace_id
      projectId: workspace_id, // Keep original project_id for table creation
      userId,
      name,
      description,
      type,
      sshHost: use_ssh ? ssh_host : null,
      sshPort: use_ssh ? (ssh_port || 22) : null,
      sshUsername: use_ssh ? ssh_user : null,
      sshKeyName: use_ssh ? 'ssh_key_temp' : null, // Placeholder for now
      dbHost: host,
      dbPort: port,
      dbName: database,
      dbUsername: username,
      dbPasswordEncrypted: encryptedPwd, // ADR-064: AES-256-GCM encrypted
      dbPasswordKey: `pwd_${Date.now()}`, // Keep for backward compat
      sshPrivateKeyEncrypted: encryptedSshKey // ADR-064: encrypted SSH key
    };

    apiLogger.debug('[POST /data-sources] Calling DataSourceService.create with:', params);

    const dataSource = await dataSourceService.create(params);
    
    // If table_id provided, link data source to table
    if (table_id) {
      apiLogger.debug('[POST /data-sources] Linking to table:', table_id);
      await dbRun(
        'UPDATE universal_tables SET data_source_id = ? WHERE id = ?',
        [dataSource.id, table_id]
      );
      apiLogger.debug('[POST /data-sources] Linked successfully');
    }
    
    apiLogger.info('[POST /data-sources] Created successfully:', { id: dataSource.id, name: dataSource.name });

    // ADR-064: Sanitize credentials before returning
    return created(res, sanitizeCredentialsForResponse(dataSource));
  } catch (err) {
    apiLogger.error('[POST /data-sources] Error creating data source:', err);
    
    // Validation errors
    if (err.message.includes('required') || err.message.includes('Invalid')) {
      return badRequest(res, err.message);
    }
    
    return error(res, err.message);
  }
});

/**
 * PUT /api/v3/data-sources/:id
 * Update a data source
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // ADR-064: If password is being updated, encrypt it
    if (updates.password !== undefined) {
      updates.db_password_encrypted = encryptCredential(updates.password);
      delete updates.password;
    }

    const dataSource = await dataSourceService.update(id, updates);

    // ADR-064: Sanitize credentials before returning
    return success(res, sanitizeCredentialsForResponse(dataSource));
  } catch (err) {
    apiLogger.error('Error updating data source:', err);
    
    if (err.message.includes('not found')) {
      return notFound(res, err.message);
    }
    
    return error(res, err.message);
  }
});

/**
 * DELETE /api/v3/data-sources/:id
 * Delete a data source
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await dataSourceService.delete(id);
    
    return success(res, { message: 'Data source deleted successfully' });
  } catch (err) {
    apiLogger.error('Error deleting data source:', err);
    
    if (err.message.includes('not found')) {
      return notFound(res, err.message);
    }
    
    return error(res, err.message);
  }
});

/**
 * POST /api/v3/data-sources/:id/test
 * Test connection to a data source
 */
router.post('/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await dataSourceService.testConnection(id);
    
    return success(res, result);
  } catch (err) {
    apiLogger.error('Error testing connection:', err);
    
    return error(res, err.message);
  }
});

/**
 * GET /api/v3/data-sources/:id/tables
 * Get list of tables from data source
 */
router.get('/:id/tables', async (req, res) => {
  try {
    const { id } = req.params;
    
    const tables = await dataSourceService.listTables(id);
    
    return success(res, tables);
  } catch (err) {
    apiLogger.error('Error listing tables:', err);
    
    return error(res, err.message);
  }
});

/**
 * GET /api/v3/data-sources/:id/tables/:tableName/columns
 * Get list of columns from a specific table in data source
 */
router.get('/:id/tables/:tableName/columns', async (req, res) => {
  try {
    const { id, tableName } = req.params;
    
    const columns = await dataSourceService.listTableColumns(id, tableName);
    
    return success(res, columns);
  } catch (err) {
    apiLogger.error('Error listing table columns:', err);
    
    return error(res, err.message);
  }
});

/**
 * POST /api/v3/data-sources/:id/import
 * Import tables from data source into CRM
 */
router.post('/:id/import', async (req, res) => {
  try {
    const { id } = req.params;
    const { project_id, tables: tableNames } = req.body;
    const userId = req.user?.id;

    if (!project_id || !tableNames || !Array.isArray(tableNames)) {
      return badRequest(res, 'project_id and tables array are required');
    }

    apiLogger.debug('[POST /data-sources/:id/import] Importing tables:', {
      dataSourceId: id,
      projectId: project_id,
      tables: tableNames,
      userId
    });

    const importedTables = await dataSourceService.importTables(id, project_id, tableNames, userId);

    return success(res, importedTables);
  } catch (err) {
    apiLogger.error('Error importing tables:', err);
    
    return error(res, err.message);
  }
});

export default router;
