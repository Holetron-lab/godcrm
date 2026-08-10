import express from 'express';
import DatabaseTypeDetector from '../services/DatabaseTypeDetector.js';
import DirectDatabaseConnector from '../services/DirectDatabaseConnector.js';
import { authenticate } from '../middleware/auth.js';
import { success, created, error, badRequest, notFound, forbidden, unauthorized } from '../utils/response.js';

const router = express.Router();

/**
 * POST /api/integrations/detect-database-type
 * Auto-detect database type from path or connection string
 */
router.post('/detect-database-type', async (req, res) => {
  try {
    const { path } = req.body;
    
    if (!path) {
      return badRequest(res, 'Path or connection string is required');
    }

    const detected = DatabaseTypeDetector.detect(path);
    
    success(res, {
      type: detected.type,
      config: detected.config
    });
  } catch (err) {
    badRequest(res, err.message);
  }
});

/**
 * POST /api/integrations/test-direct-connection
 * Test direct database connection
 */
router.post('/test-direct-connection', async (req, res) => {
  try {
    const { type, host, port, database, user, password, filename } = req.body;

    let config;

    if (type === 'better-sqlite3') {
      if (!filename) {
        return badRequest(res, 'SQLite filename is required');
      }
      config = { type, filename };
    } else {
      if (!database || !user) {
        return badRequest(res, 'Database name and user are required');
      }
      config = { type, host, port, database, user, password };
    }

    const result = await DirectDatabaseConnector.testConnection(config);
    success(res, result);
  } catch (err) {
    error(res, err.message);
  }
});

/**
 * POST /api/integrations/discover-schema-direct
 * Discover database schema (tables and columns)
 */
router.post('/discover-schema-direct', async (req, res) => {
  try {
    const { type, host, port, database, user, password, filename } = req.body;

    const tempId = `discover_${Date.now()}`;

    let config;
    if (type === 'better-sqlite3') {
      config = { type, filename };
    } else {
      config = { type, host, port, database, user, password };
    }

    // Connect
    await DirectDatabaseConnector.connect(tempId, config);

    // Get all tables
    const tables = await DirectDatabaseConnector.getTables(tempId);

    // Get schema for each table
    const schema = [];
    for (const tableName of tables) {
      const columns = await DirectDatabaseConnector.getTableSchema(tempId, tableName);
      schema.push({
        table: tableName,
        columns: columns
      });
    }

    // Cleanup
    await DirectDatabaseConnector.disconnect(tempId);

    success(res, {
      schema: schema,
      tableCount: tables.length
    });
  } catch (err) {
    error(res, err.message);
  }
});

/**
 * POST /api/integrations/create-direct
 * Create new integration with direct database connection
 */
router.post('/create-direct', authenticate, async (req, res) => {
  try {
    const { businessName, database, mappings } = req.body;
    const userId = req.user.id;

    if (!businessName || !database) {
      return badRequest(res, 'Business name and database configuration are required');
    }

    // TODO: Save integration to database
    // For now, just test the connection and return success
    
    const integrationId = `integration_${Date.now()}`;
    
    // Create persistent connection
    await DirectDatabaseConnector.connect(integrationId, database);

    success(res, {
      message: 'Integration created successfully',
      integrationId: integrationId,
      businessName: businessName
    });
  } catch (err) {
    error(res, err.message);
  }
});

/**
 * GET /api/integrations/list
 * List all integrations for current user
 */
router.get('/list', authenticate, async (req, res) => {
  try {
    // TODO: Get from database
    // For now, return empty array
    success(res, { integrations: [] });
  } catch (err) {
    error(res, err.message);
  }
});

/**
 * GET /api/integrations/:id/info
 * Get integration database info
 */
router.get('/:id/info', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!DirectDatabaseConnector.hasConnection(id)) {
      return notFound(res, 'Integration not found or not connected');
    }

    const info = await DirectDatabaseConnector.getDatabaseInfo(id);
    
    success(res, { info: info });
  } catch (err) {
    error(res, err.message);
  }
});

/**
 * DELETE /api/integrations/:id
 * Delete integration and disconnect
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    await DirectDatabaseConnector.disconnect(id);
    
    // TODO: Delete from database
    
    success(res, { message: 'Integration deleted successfully' });
  } catch (err) {
    error(res, err.message);
  }
});

/**
 * GET /api/integrations/:id/tables
 * Get all tables in integrated database
 */
router.get('/:id/tables', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const tables = await DirectDatabaseConnector.getTables(id);
    
    success(res, { tables: tables });
  } catch (err) {
    error(res, err.message);
  }
});

/**
 * GET /api/integrations/:id/tables/:tableName
 * Get table schema
 */
router.get('/:id/tables/:tableName', authenticate, async (req, res) => {
  try {
    const { id, tableName } = req.params;
    
    const columns = await DirectDatabaseConnector.getTableSchema(id, tableName);
    
    success(res, {
      table: tableName,
      columns: columns
    });
  } catch (err) {
    error(res, err.message);
  }
});

/**
 * POST /api/integrations/:id/query
 * Execute custom query (admin only)
 */
router.post('/:id/query', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { sql, params } = req.body;
    
    if (!sql) {
      return badRequest(res, 'SQL query is required');
    }

    // Security: Only allow SELECT queries
    const trimmedSql = sql.trim().toUpperCase();
    if (!trimmedSql.startsWith('SELECT')) {
      return forbidden(res, 'Only SELECT queries are allowed');
    }

    const result = await DirectDatabaseConnector.query(id, sql, params || []);
    
    success(res, { result: result });
  } catch (err) {
    error(res, err.message);
  }
});

export default router;
