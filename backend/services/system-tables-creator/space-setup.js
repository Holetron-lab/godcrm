// system-tables-creator/space-setup.js
// Space-level system table orchestration

import { dbRun, dbGet } from '../../database/connection.js';
import {
  createUsersSystemTable,
  createProjectsSystemTable,
  createTablesSystemTable,
  createFilesSystemTable,
  createStorageProvidersSystemTable,
  createWidgetsSystemTable,
  createBugsTable
} from './system-tables.js';
import { createVariablesTable } from './feature-tables.js';

/**
 * Create system tables for Admin Owner's Space
 * @param {number} projectId - Admin Owner's Space project ID
 */
export async function createSystemTables(projectId) {
  await createUsersSystemTable(projectId);
  await createProjectsSystemTable(projectId);
  await createTablesSystemTable(projectId);
  await createFilesSystemTable(projectId);
  await createStorageProvidersSystemTable(projectId);
  await createWidgetsSystemTable(projectId);
  await createBugsTable(projectId);
}

/**
 * Ensure per-space System Data project has core system tables (Projects, Tables, Files, Variables)
 * ADR-026: Added Variables table for formulas and aggregations
 * @param {number} spaceId
 * @returns {Promise<{systemProjectId:number, projectsTableId:number, tablesTableId:number, filesTableId:number, variablesTableId:number}|null>}
 */
export async function ensureCoreSystemTablesForSpace(spaceId) {
  if (!spaceId) return null;

  const space = await dbGet('SELECT id, owner_id, name FROM spaces WHERE id = ?', [spaceId]);
  if (!space) return null;

  // Find or create System Data project in this space
  let systemProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [spaceId]
  );

  if (!systemProject) {
    const now = new Date().toISOString();
    const result = await dbRun(
      `INSERT INTO projects (
        space_id, name, description, icon, type, owner_id,
        theme_primary, theme_secondary, theme_tertiary,
        created_at, updated_at
      ) VALUES (?, 'System Data', 'System data for this space', '⚙️', 'system_data', ?, '#0ea5e9', '#8b5cf6', '#10b981', ?, ?)`,
      [spaceId, space.owner_id, now, now]
    );
    systemProject = { id: result.lastInsertRowid || result.lastID };
  }

  const ensureTable = async (tableName, creator) => {
    const existing = await dbGet(
      'SELECT id FROM universal_tables WHERE project_id = ? AND name = ?',
      [systemProject.id, tableName]
    );
    if (existing) return existing.id;
    return await creator(systemProject.id);
  };

  const projectsTableId = await ensureTable('Projects', createProjectsSystemTable);
  const tablesTableId = await ensureTable('Tables', createTablesSystemTable);
  const filesTableId = await ensureTable('Files', createFilesSystemTable);
  const variablesTableId = await ensureTable('Variables', createVariablesTable);
  const widgetsTableId = await ensureTable('Widgets', createWidgetsSystemTable);

  return {
    systemProjectId: systemProject.id,
    projectsTableId,
    tablesTableId,
    filesTableId,
    variablesTableId,
    widgetsTableId
  };
}
