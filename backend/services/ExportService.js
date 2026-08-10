/**
 * ExportService - Export functionality for GOD CRM
 * ADR-020: Export/Import — Quick Backup & Restore
 * 
 * Supports:
 * - Table export (full, schema_only, sanitized)
 * - Project export with multiple tables
 * - Space export with multiple projects
 * - Sensitive column detection
 * - Access control validation
 */

import { dbAll, dbGet, safeJsonParse } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

// Sensitive column types
const SENSITIVE_TYPES = ['password', 'apiKey', 'token', 'secret'];

// Sensitive column name patterns
const SENSITIVE_PATTERNS = [
  /password/i,
  /api.?key/i,
  /secret/i,
  /token/i,
  /credential/i,
  /private.?key/i
];

// Current version for export metadata
const GODCRM_VERSION = '3.0.0';

/**
 * ExportService class for handling data exports
 */
export class ExportService {
  
  /**
   * Detect sensitive columns in a table
   * Checks both column type and column name patterns
   * @param {number} tableId - Table ID
   * @returns {Promise<{hasSensitive: boolean, columns: Array}>}
   */
  static async detectSensitiveColumns(tableId) {
    const columns = await dbAll(
      'SELECT id, column_name as name, type FROM table_columns WHERE table_id = ? ORDER BY order_index',
      [tableId]
    );
    
    const sensitive = [];
    
    for (const col of columns) {
      // Check by type
      if (SENSITIVE_TYPES.includes(col.type)) {
        sensitive.push({ 
          name: col.name, 
          type: col.type, 
          reason: 'Column type is sensitive' 
        });
        continue;
      }
      
      // Check by name pattern
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(col.name)) {
          sensitive.push({ 
            name: col.name, 
            type: col.type, 
            reason: 'Column name matches sensitive pattern' 
          });
          break;
        }
      }
    }
    
    return { 
      hasSensitive: sensitive.length > 0, 
      columns: sensitive 
    };
  }
  
  /**
   * Export a single table
   * @param {number} tableId - Table ID
   * @param {Object} options - { mode: 'full' | 'schema_only' | 'sanitized' }
   * @returns {Promise<Object>} Export data
   */
  static async exportTable(tableId, options = {}) {
    const { mode = 'full' } = options;
    
    // Get table info
    const table = await dbGet(
      'SELECT id, name, description, icon, project_id FROM universal_tables WHERE id = ?',
      [tableId]
    );
    
    if (!table) {
      throw new Error(`Table not found: ${tableId}`);
    }
    
    // Get columns
    const columns = await dbAll(`
      SELECT 
        id, table_id, column_name as name, display_name, type as column_type,
        config, is_required, is_visible, order_index, default_value,
        formula, is_readonly, width
      FROM table_columns 
      WHERE table_id = ? 
      ORDER BY order_index
    `, [tableId]);
    
    // Get rows (if not schema_only)
    let rows = [];
    if (mode !== 'schema_only') {
      const rawRows = await dbAll(
        'SELECT id, data, created_at, updated_at FROM table_rows WHERE table_id = ? ORDER BY id',
        [tableId]
      );
      rows = rawRows.map(r => ({
        _id: r.id,
        _created_at: r.created_at,
        _updated_at: r.updated_at,
        ...safeJsonParse(r.data)
      }));
    }
    
    // Sanitize if needed
    let sanitizedColumns = [];
    if (mode === 'sanitized') {
      const sensitiveInfo = await this.detectSensitiveColumns(tableId);
      sanitizedColumns = sensitiveInfo.columns.map(c => c.name);
      
      rows = rows.map(row => {
        const sanitized = { ...row };
        for (const colName of sanitizedColumns) {
          if (colName in sanitized) {
            sanitized[colName] = null;
          }
        }
        return sanitized;
      });
    }
    
    return {
      type: 'table',
      table: {
        id: table.id,
        name: table.name,
        description: table.description,
        icon: table.icon
      },
      columns: columns.map(c => ({
        id: c.id,
        name: c.name,
        displayName: c.display_name,
        columnType: c.column_type,
        config: safeJsonParse(c.config),
        isRequired: Boolean(c.is_required),
        isVisible: Boolean(c.is_visible),
        orderIndex: c.order_index,
        defaultValue: c.default_value,
        formula: c.formula,
        isReadonly: Boolean(c.is_readonly),
        width: c.width
      })),
      rows,
      meta: {
        mode,
        exported_at: new Date().toISOString(),
        row_count: rows.length,
        column_count: columns.length,
        sanitizedColumns: mode === 'sanitized' ? sanitizedColumns : undefined,
        godcrm_version: GODCRM_VERSION
      }
    };
  }
  
  /**
   * Export a project with all its tables
   * @param {number} projectId - Project ID
   * @param {Object} options - { tables: {name: mode}, includeDocuments: boolean }
   * @returns {Promise<Object>} Export data
   */
  static async exportProject(projectId, options = {}) {
    const { tables = {}, includeDocuments = true } = options;
    
    // Get project info
    const project = await dbGet(
      'SELECT id, name, description, icon, type, space_id FROM projects WHERE id = ?',
      [projectId]
    );
    
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    // Get all tables
    const allTables = await dbAll(
      'SELECT id, name FROM universal_tables WHERE project_id = ? ORDER BY created_at',
      [projectId]
    );
    
    const exportedTables = [];
    
    for (const table of allTables) {
      // Determine mode for this table
      let mode = tables[table.name] || tables['*'] || 'full';
      
      if (mode === 'exclude') {
        continue;
      }
      
      const exported = await this.exportTable(table.id, { mode });
      exportedTables.push(exported);
    }
    
    // Get documents if requested (gracefully handle missing table)
    let documents = [];
    if (includeDocuments) {
      try {
        const rawDocs = await dbAll(
          'SELECT id, title, content, status, created_at, updated_at FROM documents WHERE project_id = ? ORDER BY id',
          [projectId]
        );
        documents = rawDocs.map(d => ({
          id: d.id,
          title: d.title,
          content: safeJsonParse(d.content),
          status: d.status,
          created_at: d.created_at,
          updated_at: d.updated_at
        }));
      } catch (e) {
        // Documents table might not exist
        documents = [];
      }
    }
    
    return {
      type: 'project',
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        icon: project.icon,
        type: project.type
      },
      tables: exportedTables,
      documents,
      meta: {
        exported_at: new Date().toISOString(),
        table_count: exportedTables.length,
        document_count: documents.length,
        godcrm_version: GODCRM_VERSION
      }
    };
  }
  
  /**
   * Export an entire space with all projects
   * @param {number} spaceId - Space ID
   * @param {Object} options - { projects: {...}, includeSettings: boolean }
   * @param {Object} context - { userId } for access control
   * @returns {Promise<Object>} Export data
   */
  static async exportSpace(spaceId, options = {}, context = {}) {
    const { userId } = context;
    
    // Access control check
    if (userId) {
      const canExport = await this.canExport(userId, 'space', spaceId);
      if (!canExport) {
        throw new Error('Access denied: only admin or owner can export');
      }
    }
    
    const { projects = {}, includeSettings = true } = options;
    
    // Get space info
    const space = await dbGet(
      'SELECT id, name, description, type, settings FROM spaces WHERE id = ?',
      [spaceId]
    );
    
    if (!space) {
      throw new Error(`Space not found: ${spaceId}`);
    }
    
    // Get all projects
    const allProjects = await dbAll(
      'SELECT id, name FROM projects WHERE space_id = ? ORDER BY created_at',
      [spaceId]
    );
    
    const exportedProjects = [];
    
    for (const project of allProjects) {
      const projectOptions = projects[project.name] || { tables: { '*': 'full' } };
      
      const exported = await this.exportProject(project.id, {
        tables: projectOptions.tables || { '*': 'full' },
        includeDocuments: projectOptions.includeDocuments !== false
      });
      exportedProjects.push(exported);
    }
    
    return {
      type: 'space',
      space: {
        id: space.id,
        name: space.name,
        description: space.description,
        type: space.type
      },
      projects: exportedProjects,
      settings: includeSettings ? safeJsonParse(space.settings) : undefined,
      meta: {
        exported_at: new Date().toISOString(),
        project_count: exportedProjects.length,
        godcrm_version: GODCRM_VERSION
      }
    };
  }
  
  /**
   * Check if user can export a resource
   * Only space owner and admin can export
   * @param {number} userId - User ID
   * @param {string} resourceType - 'table' | 'project' | 'space'
   * @param {number} resourceId - Resource ID
   * @returns {Promise<boolean>}
   */
  static async canExport(userId, resourceType, resourceId) {
    let spaceId;
    
    switch (resourceType) {
      case 'table': {
        const table = await dbGet(
          'SELECT project_id FROM universal_tables WHERE id = ?',
          [resourceId]
        );
        if (!table) return false;
        
        const tableProject = await dbGet(
          'SELECT space_id FROM projects WHERE id = ?',
          [table.project_id]
        );
        if (!tableProject) return false;
        spaceId = tableProject.space_id;
        break;
      }
        
      case 'project': {
        const project = await dbGet(
          'SELECT space_id FROM projects WHERE id = ?',
          [resourceId]
        );
        if (!project) return false;
        spaceId = project.space_id;
        break;
      }
        
      case 'space':
        spaceId = resourceId;
        break;
        
      default:
        return false;
    }
    
    // Check if user is owner of the space
    const space = await dbGet(
      'SELECT owner_id FROM spaces WHERE id = ?',
      [spaceId]
    );
    
    if (!space) return false;
    
    // Owner can always export
    if (space.owner_id === userId) {
      return true;
    }
    
    // TODO: Check space_members table for admin role when implemented
    // For now, only owner can export
    
    return false;
  }
}

export default ExportService;
