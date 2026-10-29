/**
 * ImportService - Import functionality for GOD CRM
 * ADR-020: Export/Import — Quick Backup & Restore
 * 
 * Supports:
 * - Table import (create new or replace existing)
 * - Project import with multiple tables
 * - Space import with multiple projects
 */

import { dbRun, dbGet, dbAll, toBool, withTransactionAsync } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { persistColumnType, validateColumnValue } from './ColumnService.js';
import { verifyContentValue } from './column-adapters/media-kind.js';
import { normalizeTypedCells, NORMALIZED_CELL_TYPES } from './cellNormalizers.js';

/**
 * Generate URL-friendly slug from text
 * @param {string} text - Text to slugify
 * @returns {string} Slug
 */
export function slugify(text) {
  const cyrillicToLatin = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
  };
  
  return text
    .toLowerCase()
    .split('')
    .map(char => cyrillicToLatin[char] || char)
    .join('')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * ImportService class for handling data imports
 */
export class ImportService {
  
  /**
   * Import a table from export data
   * @param {number} projectId - Target project ID
   * @param {Object} data - Exported table data
   * @param {Object} options - { mode: 'create' | 'replace', newName?, targetTableId? }
   * @returns {Promise<Object>} Import result
   */
  static async importTable(projectId, data, options = {}) {
    const { mode = 'create', newName, targetTableId } = options;
    
    // Validate data type
    if (data.type !== 'table') {
      throw new Error(`Invalid data type: expected 'table', got '${data.type}'`);
    }
    
    // Wrap import in transaction for atomicity
    return await withTransactionAsync(async (trx) => {
      let tableId;
    
      if (mode === 'create') {
      // Create new table
      const tableName = newName || data.table.name;
      
      const result = await trx.run(`
        INSERT INTO universal_tables (project_id, name, description, icon, is_system)
        VALUES (?, ?, ?, ?, ?)
      `, [
        projectId,
        tableName,
        data.table.description || null,
        data.table.icon || '📊',
        toBool(false)
      ]);
      
      tableId = result.lastInsertRowid || result.lastID;
      
      // Create columns
      for (const col of data.columns) {
        await trx.run(`
          INSERT INTO table_columns (
            table_id, column_name, display_name, type, config,
            is_required, is_visible, order_index, default_value,
            formula, is_readonly, width
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          tableId,
          col.name,
          col.displayName || col.name,
          persistColumnType(col.columnType === undefined ? 'text' : col.columnType),
          col.config ? JSON.stringify(col.config) : null,
          toBool(col.isRequired || false),
          toBool(col.isVisible !== false),
          col.orderIndex || 0,
          col.defaultValue || null,
          col.formula || null,
          toBool(col.isReadonly || false),
          col.width || null
        ]);
      }
    } else if (mode === 'replace' && targetTableId) {
      // Clear existing rows
      tableId = targetTableId;
      await trx.run('DELETE FROM table_rows WHERE table_id = ?', [tableId]);
    } else {
      throw new Error('Invalid import mode or missing targetTableId for replace mode');
    }
    
    // ADR-204 AC8: `content` cells are verified against real files on import.
    // Shape or media mismatch throws, so the whole import rolls back.
    const contentColumns = (await trx.all(
      "SELECT column_name FROM table_columns WHERE table_id = ? AND type = 'content'", [tableId]
    )).map((c) => c.column_name);
    // ADR-0035 / ADR-0035-A: geo_point + address cells go through the same
    // normalizer as every other write path; a bad value fails the whole import.
    const typedColumns = await trx.all(
      `SELECT id, column_name, type FROM table_columns WHERE table_id = ? AND type IN (${NORMALIZED_CELL_TYPES.map(() => '?').join(', ')})`,
      [tableId, ...NORMALIZED_CELL_TYPES]
    );

    // Import rows
    let rowsImported = 0;
    for (const row of data.rows || []) {
      // Remove internal metadata from row data
      const { _id, _created_at, _updated_at, ...rawRowData } = row;
      const typed = normalizeTypedCells(typedColumns, rawRowData);
      if (!typed.ok) throw new Error(typed.message);
      const rowData = typed.data;
      for (const name of contentColumns) {
        const value = rowData[name];
        if (value === null || value === undefined || value === '') continue;
        if (!validateColumnValue({ type: 'content', config: {} }, value)) {
          throw new Error(`Column "${name}": invalid content value`);
        }
        const problems = await verifyContentValue(value);
        if (problems.length) throw new Error(`Column "${name}": ${problems.join('; ')}`);
      }

      // Generate unique base_id
      const baseId = 'imp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      
      await trx.run(`
        INSERT INTO table_rows (table_id, base_id, data, created_by)
        VALUES (?, ?, ?, ?)
      `, [tableId, baseId, JSON.stringify(rowData), null]);
      
      rowsImported++;
    }
    
      apiLogger.info({ tableId, rowsImported, columnsCreated: data.columns.length }, 'Table imported');
    
      return {
        tableId,
        rowsImported,
        columnsCreated: data.columns.length
      };
    }); // end withTransactionAsync
  }
  
  /**
   * Import a project from export data
   * @param {number} spaceId - Target space ID
   * @param {Object} data - Exported project data
   * @param {Object} options - { mode: 'create' | 'merge', newName? }
   * @returns {Promise<Object>} Import result
   */
  static async importProject(spaceId, data, options = {}) {
    const { mode = 'create', newName } = options;
    
    // Validate data type
    if (data.type !== 'project') {
      throw new Error(`Invalid data type: expected 'project', got '${data.type}'`);
    }
    
    // Get space owner for project creation
    const space = await dbGet('SELECT owner_id FROM spaces WHERE id = ?', [spaceId]);
    if (!space) {
      throw new Error(`Space not found: ${spaceId}`);
    }
    
    // Wrap project+documents creation in transaction
    const projectName = newName || data.project.name;
    const txResult = await withTransactionAsync(async (trx) => {
      const projectResult = await trx.run(`
      INSERT INTO projects (space_id, owner_id, name, description, icon, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      spaceId,
      space.owner_id,
      projectName,
      data.project.description || null,
      data.project.icon || '📁',
      data.project.type || 'business'
    ]);
    
      const projectId = projectResult.lastInsertRowid || projectResult.lastID;

      // Import documents within transaction
      let documentsImported = 0;
      for (const doc of data.documents || []) {
        await trx.run(`
          INSERT INTO documents (project_id, title, content, status)
          VALUES (?, ?, ?, ?)
        `, [
          projectId,
          doc.title,
          JSON.stringify(doc.content || {}),
          doc.status || 'published'
        ]);
        documentsImported++;
      }

      return { projectId, documentsImported };
    }); // end withTransactionAsync

    // Import tables (each table has its own transaction)
    let tablesImported = 0;
    for (const tableData of data.tables || []) {
      await this.importTable(txResult.projectId, tableData, { mode: 'create' });
      tablesImported++;
    }
    
    apiLogger.info({ projectId: txResult.projectId, tablesImported, documentsImported: txResult.documentsImported }, 'Project imported');
    
    return {
      projectId: txResult.projectId,
      tablesImported,
      documentsImported: txResult.documentsImported
    };
  }
  
  /**
   * Import a space from export data
   * @param {Object} data - Exported space data
   * @param {Object} options - { newName?, ownerId }
   * @returns {Promise<Object>} Import result
   */
  static async importSpace(data, options = {}) {
    const { newName, ownerId } = options;
    
    // Validate data type
    if (data.type !== 'space') {
      throw new Error(`Invalid data type: expected 'space', got '${data.type}'`);
    }
    
    if (!ownerId) {
      throw new Error('ownerId is required for space import');
    }
    
    // Create space
    const spaceName = newName || data.space.name;
    const spaceResult = await dbRun(`
      INSERT INTO spaces (owner_id, name, description, type)
      VALUES (?, ?, ?, ?)
    `, [
      ownerId,
      spaceName,
      data.space.description || null,
      data.space.type || 'business'
    ]);
    
    const spaceId = spaceResult.lastInsertRowid || spaceResult.lastID;
    
    // Import projects
    let projectsImported = 0;
    for (const projectData of data.projects || []) {
      await this.importProject(spaceId, projectData, { mode: 'create' });
      projectsImported++;
    }
    
    apiLogger.info({ spaceId, projectsImported }, 'Space imported');
    
    return {
      spaceId,
      projectsImported
    };
  }
}

export default ImportService;
