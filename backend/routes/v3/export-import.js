/**
 * API v3: Export/Import Routes
 * ADR-020: Export/Import — Quick Backup & Restore
 * 
 * Endpoints:
 * - POST /tables/:tableId/export        - Export single table
 * - POST /projects/:projectId/export    - Export project with tables
 * - POST /spaces/:spaceId/export        - Export entire space
 * - POST /projects/:projectId/import/table   - Import table to project
 * - POST /spaces/:spaceId/import/project     - Import project to space
 * - POST /import/space                  - Import space as new
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ExportOptions:
 *       type: object
 *       properties:
 *         mode:
 *           type: string
 *           enum: [full, schema_only, sanitized]
 *         format:
 *           type: string
 *           enum: [json]
 */

import express from 'express';
import { ExportService } from '../../services/ExportService.js';
import { ImportService } from '../../services/ImportService.js';
import { apiLogger } from '../../utils/logger.js';

const router = express.Router();

// ============================================================
// Response Helpers
// ============================================================
const respondSuccess = (res, data, status = 200) =>
  res.status(status).json({
    success: true,
    data,
    timestamp: new Date().toISOString()
  });

const respondError = (res, status, code, message) =>
  res.status(status).json({
    success: false,
    error: { code, message },
    timestamp: new Date().toISOString()
  });

// ============================================================
// EXPORT ENDPOINTS
// ============================================================

/**
 * POST /api/v3/tables/:tableId/export
 * Export a single table
 * 
 * Request Body:
 * {
 *   "mode": "full" | "schema_only" | "sanitized",
 *   "format": "json"  // MVP: только JSON
 * }
 */
router.post('/tables/:tableId/export', async (req, res) => {
  try {
    const { tableId } = req.params;
    const { mode = 'full' } = req.body;
    const userId = req.user?.id;
    
    // Check access
    if (userId) {
      const canExport = await ExportService.canExport(userId, 'table', tableId);
      if (!canExport) {
        return respondError(res, 403, 'ACCESS_DENIED', 'You do not have permission to export this table');
      }
    }
    
    const exported = await ExportService.exportTable(tableId, { mode });
    
    apiLogger.info({ tableId, mode, userId }, 'Table exported');
    
    return respondSuccess(res, exported);
  } catch (error) {
    apiLogger.error({ err: error }, 'POST /tables/:tableId/export error');
    return respondError(res, 500, 'EXPORT_FAILED', error.message);
  }
});

/**
 * POST /api/v3/tables/:tableId/sensitive-columns
 * Get sensitive columns info for a table (for UI warning)
 */
router.post('/tables/:tableId/sensitive-columns', async (req, res) => {
  try {
    const { tableId } = req.params;
    
    const sensitiveInfo = await ExportService.detectSensitiveColumns(tableId);
    
    return respondSuccess(res, sensitiveInfo);
  } catch (error) {
    apiLogger.error({ err: error }, 'POST /tables/:tableId/sensitive-columns error');
    return respondError(res, 500, 'DETECTION_FAILED', error.message);
  }
});

/**
 * POST /api/v3/projects/:projectId/export
 * Export a project with selected tables
 * 
 * Request Body:
 * {
 *   "tables": {
 *     "customers": "full",
 *     "api_keys": "sanitized",
 *     "logs": "exclude"
 *   },
 *   "includeDocuments": true
 * }
 */
router.post('/projects/:projectId/export', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { tables = {}, includeDocuments = true } = req.body;
    const userId = req.user?.id;
    
    // Check access
    if (userId) {
      const canExport = await ExportService.canExport(userId, 'project', projectId);
      if (!canExport) {
        return respondError(res, 403, 'ACCESS_DENIED', 'You do not have permission to export this project');
      }
    }
    
    const exported = await ExportService.exportProject(projectId, {
      tables,
      includeDocuments
    });
    
    apiLogger.info({ projectId, tableCount: exported.tables.length, userId }, 'Project exported');
    
    return respondSuccess(res, exported);
  } catch (error) {
    apiLogger.error({ err: error }, 'POST /projects/:projectId/export error');
    return respondError(res, 500, 'EXPORT_FAILED', error.message);
  }
});

/**
 * POST /api/v3/spaces/:spaceId/export
 * Export an entire space
 * 
 * Request Body:
 * {
 *   "projects": {
 *     "crm": { "tables": { "customers": "full" } },
 *     "analytics": { "tables": { "*": "full" } }
 *   },
 *   "includeSettings": true
 * }
 */
router.post('/spaces/:spaceId/export', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { projects = {}, includeSettings = true } = req.body;
    const userId = req.user?.id;
    
    const exported = await ExportService.exportSpace(spaceId, {
      projects,
      includeSettings
    }, { userId });
    
    apiLogger.info({ spaceId, projectCount: exported.projects.length, userId }, 'Space exported');
    
    return respondSuccess(res, exported);
  } catch (error) {
    if (error.message.includes('Access denied')) {
      return respondError(res, 403, 'ACCESS_DENIED', error.message);
    }
    apiLogger.error({ err: error }, 'POST /spaces/:spaceId/export error');
    return respondError(res, 500, 'EXPORT_FAILED', error.message);
  }
});

// ============================================================
// IMPORT ENDPOINTS
// ============================================================

/**
 * POST /api/v3/projects/:projectId/import/table
 * Import a table to a project
 * 
 * Request Body:
 * {
 *   "data": { ... exported table data ... },
 *   "mode": "create" | "replace",
 *   "newName": "customers_copy",
 *   "targetTableId": null  // for replace mode
 * }
 */
router.post('/projects/:projectId/import/table', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { data, mode = 'create', newName, targetTableId } = req.body;
    const userId = req.user?.id;
    
    if (!data) {
      return respondError(res, 400, 'MISSING_DATA', 'Export data is required');
    }
    
    // Check access (user must be able to export to import)
    if (userId) {
      const canExport = await ExportService.canExport(userId, 'project', projectId);
      if (!canExport) {
        return respondError(res, 403, 'ACCESS_DENIED', 'You do not have permission to import to this project');
      }
    }
    
    const result = await ImportService.importTable(projectId, data, {
      mode,
      newName,
      targetTableId
    });
    
    apiLogger.info({ projectId, tableId: result.tableId, rowsImported: result.rowsImported, userId }, 'Table imported');
    
    return respondSuccess(res, result, 201);
  } catch (error) {
    apiLogger.error({ err: error }, 'POST /projects/:projectId/import/table error');
    return respondError(res, 500, 'IMPORT_FAILED', error.message);
  }
});

/**
 * POST /api/v3/spaces/:spaceId/import/project
 * Import a project to a space
 * 
 * Request Body:
 * {
 *   "data": { ... exported project data ... },
 *   "mode": "create",
 *   "newName": "CRM Copy"
 * }
 */
router.post('/spaces/:spaceId/import/project', async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { data, mode = 'create', newName } = req.body;
    const userId = req.user?.id;
    
    if (!data) {
      return respondError(res, 400, 'MISSING_DATA', 'Export data is required');
    }
    
    // Check access
    if (userId) {
      const canExport = await ExportService.canExport(userId, 'space', spaceId);
      if (!canExport) {
        return respondError(res, 403, 'ACCESS_DENIED', 'You do not have permission to import to this space');
      }
    }
    
    const result = await ImportService.importProject(spaceId, data, {
      mode,
      newName
    });
    
    apiLogger.info({ spaceId, projectId: result.projectId, tablesImported: result.tablesImported, userId }, 'Project imported');
    
    return respondSuccess(res, result, 201);
  } catch (error) {
    apiLogger.error({ err: error }, 'POST /spaces/:spaceId/import/project error');
    return respondError(res, 500, 'IMPORT_FAILED', error.message);
  }
});

/**
 * POST /api/v3/import/space
 * Import a space as new
 * 
 * Request Body:
 * {
 *   "data": { ... exported space data ... },
 *   "newName": "Imported Space"
 * }
 */
router.post('/import/space', async (req, res) => {
  try {
    const { data, newName } = req.body;
    const userId = req.user?.id;
    
    if (!data) {
      return respondError(res, 400, 'MISSING_DATA', 'Export data is required');
    }
    
    if (!userId) {
      return respondError(res, 401, 'UNAUTHORIZED', 'Authentication required to import space');
    }
    
    const result = await ImportService.importSpace(data, {
      newName,
      ownerId: userId
    });
    
    apiLogger.info({ spaceId: result.spaceId, projectsImported: result.projectsImported, userId }, 'Space imported');
    
    return respondSuccess(res, result, 201);
  } catch (error) {
    apiLogger.error({ err: error }, 'POST /import/space error');
    return respondError(res, 500, 'IMPORT_FAILED', error.message);
  }
});

export default router;
