/**
 * AIAgentsPackService - Creates AI Agents project with all necessary tables
 * 
 * Creates:
 * - API Keys table
 * - Agents table
 * - Prompts Library
 * - Message Logs
 * - Variable Mappings
 * - AI Analytics
 */

import { dbGet, dbRun, dbAll } from '../database/connection.js';
import { aiLogger } from '../utils/logger.js';

/**
 * Generate unique base_id for rows
 */
function generateBaseId(prefix = 'row') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const AI_TABLES_TO_COPY = [
  'ai_operators',
  'ai_agents',
  'ai_chat_history',
  'ai_run_logs',
  'ai_usage_analytics',
  'ai_feedback',
  'ai_api_keys',
  'ai_models',
  'ai_tools',
  'api_keys_list'
];

const AI_TABLES_SKIP_ROWS = new Set(['ai_chat_history']);

function normalizeTableName(name) {
  if (!name) return '';
  return String(name).trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Get table schema columns from PostgreSQL information_schema
 */
async function getTableSchemaColumns(tableName) {
  const rows = await dbAll(`
    SELECT column_name as name
    FROM information_schema.columns
    WHERE table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);
  return rows.map((row) => row.name);
}

function normalizeRowData(data, oldIdToName, newNameToId) {
  if (!data || typeof data !== 'object') return data;
  const normalized = {};

  Object.entries(data).forEach(([key, value]) => {
    if (oldIdToName[key]) {
      return;
    }
    normalized[key] = value;
  });

  Object.entries(oldIdToName).forEach(([oldId, columnName]) => {
    if (data[oldId] === undefined) return;
    const newId = newNameToId[columnName];
    if (newId && normalized[newId] === undefined) {
      normalized[newId] = data[oldId];
    }
    if (normalized[columnName] === undefined) {
      normalized[columnName] = data[oldId];
    }
  });

  return normalized;
}

async function copyAIAgentsTablesFromSystemData(targetProjectId) {
  // Find Development space (admin system space with maintained AI Agents tables)
  const sourceSpace = await dbGet(
    "SELECT id FROM spaces WHERE LOWER(name) = 'development' LIMIT 1"
  );
  
  if (!sourceSpace) {
    throw new Error('Development space not found - cannot copy AI Agents tables');
  }

  // Find System Data project (contains AI Agents template tables)
  let sourceProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data' ORDER BY id ASC LIMIT 1",
    [sourceSpace.id]
  );

  // Fallback: find any project with AI tables
  if (!sourceProject) {
    const tableList = AI_TABLES_TO_COPY.map((name) => `'${name}'`).join(', ');
    sourceProject = await dbGet(
      `
        SELECT DISTINCT ut.project_id as id
        FROM universal_tables ut
        JOIN projects p ON p.id = ut.project_id
        WHERE p.space_id = ?
          AND LOWER(REPLACE(ut.name, ' ', '_')) IN (${tableList})
        ORDER BY ut.project_id ASC
        LIMIT 1
      `,
      [sourceSpace.id]
    );
  }

  if (!sourceProject) {
    throw new Error('System Data project not found in Development/NeoMetal space');
  }

  const sourceTables = await dbAll(
    'SELECT * FROM universal_tables WHERE project_id = ?',
    [sourceProject.id]
  );
  const tablesByName = new Map();
  sourceTables.forEach((table) => {
    const normalized = normalizeTableName(table.name || table.display_name);
    if (normalized) {
      tablesByName.set(normalized, table);
    }
  });

  const tableSchema = await getTableSchemaColumns('universal_tables');
  const tableCopyFields = tableSchema.filter((col) => !['id', 'project_id'].includes(col));
  const tableInsertSql = `
    INSERT INTO universal_tables (project_id, ${tableCopyFields.join(',')})
    VALUES (?, ${tableCopyFields.map(() => '?').join(',')})
  `;

  const columnSchema = await getTableSchemaColumns('table_columns');
  const columnCopyFields = columnSchema.filter((col) => !['id', 'table_id'].includes(col));
  const columnInsertSql = `
    INSERT INTO table_columns (table_id, ${columnCopyFields.join(',')})
    VALUES (?, ${columnCopyFields.map(() => '?').join(',')})
  `;

  const rowSchema = await getTableSchemaColumns('table_rows');
  const rowCopyFields = rowSchema.filter((col) => !['id', 'table_id'].includes(col));
  const rowInsertSql = `
    INSERT INTO table_rows (table_id, ${rowCopyFields.join(',')})
    VALUES (?, ${rowCopyFields.map(() => '?').join(',')})
  `;

  const createdTables = {};

  for (const tableName of AI_TABLES_TO_COPY) {
    const sourceTable = tablesByName.get(tableName);
    if (!sourceTable) {
      aiLogger.warn({ tableName }, 'Source table not found in System Data');
      continue;
    }

    const tableValues = tableCopyFields.map((field) => sourceTable[field]);
    const tableResult = await dbRun(tableInsertSql, [targetProjectId, ...tableValues]);
    const targetTableId = tableResult.lastInsertRowid || tableResult.lastID;
    createdTables[tableName] = targetTableId;

    const sourceColumns = await dbAll(
      'SELECT * FROM table_columns WHERE table_id = ? ORDER BY order_index ASC, id ASC',
      [sourceTable.id]
    );
    const oldIdToName = {};
    for (const col of sourceColumns) {
      if (col.column_name) {
        oldIdToName[col.id] = col.column_name;
      }
      const values = columnCopyFields.map((field) => col[field]);
      await dbRun(columnInsertSql, [targetTableId, ...values]);
    }

    const newColumns = await dbAll(
      'SELECT id, column_name FROM table_columns WHERE table_id = ?',
      [targetTableId]
    );
    const newNameToId = {};
    newColumns.forEach((col) => {
      if (col.column_name) {
        newNameToId[col.column_name] = col.id;
      }
    });

    if (tableName === 'ai_agents' && !newNameToId.context_settings) {
      const maxOrder = await dbGet(
        'SELECT MAX(order_index) as maxOrder FROM table_columns WHERE table_id = ?',
        [targetTableId]
      );
      const nextOrder = (maxOrder?.maxOrder || 0) + 1;
      await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, is_required, config, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, NULL, ?, datetime('now'), datetime('now'))`,
        [targetTableId, 'context_settings', 'Context Settings', 'long_text', nextOrder]
      );
      const contextColumn = await dbGet(
        'SELECT id FROM table_columns WHERE table_id = ? AND column_name = ?',
        [targetTableId, 'context_settings']
      );
      if (contextColumn?.id) {
        newNameToId.context_settings = contextColumn.id;
      }
    }

    if (AI_TABLES_SKIP_ROWS.has(tableName)) {
      aiLogger.debug({ tableName }, 'Skipping rows');
      continue;
    }

    const sourceRows = await dbAll(
      'SELECT * FROM table_rows WHERE table_id = ?',
      [sourceTable.id]
    );
    for (const row of sourceRows) {
      let dataValue = row.data;
      if (typeof dataValue === 'string') {
        try {
          const parsed = JSON.parse(dataValue);
          dataValue = JSON.stringify(normalizeRowData(parsed, oldIdToName, newNameToId));
        } catch {
          dataValue = row.data;
        }
      }
      const rowValues = rowCopyFields.map((field) => (field === 'data' ? dataValue : row[field]));
      await dbRun(rowInsertSql, [targetTableId, ...rowValues]);
    }

    aiLogger.debug({ table: sourceTable.name, targetTableId, rowCount: sourceRows.length }, 'Copied table');
  }

  return { sourceProjectId: sourceProject.id, createdTables };
}

/**
 * Create a project within a space
 */
async function createProject(spaceId, name, type, icon, description, ownerId) {
  const result = await dbRun(`
    INSERT INTO projects (name, type, icon, description, owner_id, space_id, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '{}', datetime('now'), datetime('now'))
  `, [name, type, icon, description, ownerId, spaceId]);
  
  aiLogger.info({ name, projectId: result.lastInsertRowid }, 'Created project');
  return result.lastInsertRowid;
}

/**
 * Create a table within a project
 */
async function createTable(projectId, name, icon, description) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, icon, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [projectId, name, icon, description]);
  
  aiLogger.debug({ name, tableId: result.lastInsertRowid }, 'Created table');
  return result.lastInsertRowid;
}

/**
 * Create columns for a table
 */
async function createColumns(tableId, columns) {
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const config = {
      icon: col.icon || null,
      ...(col.settings || {})
    };
    await dbRun(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      tableId,
      col.key || col.name.toLowerCase().replace(/\s+/g, '_'),
      col.name,
      col.type,
      JSON.stringify(config),
      col.width || 150,
      col.required ? 1 : 0,
      i + 1
    ]);
  }
  aiLogger.debug({ count: columns.length }, 'Added columns');
}

/**
 * Create rows for a table
 */
async function createRows(tableId, rows, createdBy) {
  for (const row of rows) {
    await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [tableId, generateBaseId(), JSON.stringify(row), createdBy]);
  }
  aiLogger.debug({ count: rows.length }, 'Added sample rows');
}

/**
 * Create AI Agents Pack for a space
 */
export async function createAIAgentsPack(spaceId, ownerId) {
  aiLogger.info({ spaceId }, 'Creating AI Agents Pack');
  
  const projectId = await createProject(
    spaceId,
    'AI Agents',
    'ai_agents',
    '🤖',
    'AI agents management, prompts and message logs',
    ownerId
  );

  const copied = await copyAIAgentsTablesFromSystemData(projectId);

  aiLogger.info({ projectId, sourceProjectId: copied.sourceProjectId }, 'AI Agents Pack copied from System Data');

  return {
    success: true,
    projectId
  };
}

/**
 * Ensure Agents table has required columns (tags, vector, response_mode)
 * Call this to upgrade existing tables.
 * ADR-091 Phase 1 Task 2: adds response_mode select column with default 'mention_only'.
 */
export async function ensureAgentsTableColumns(tableId) {
  aiLogger.info({ tableId }, 'Ensuring Agents table has required columns');
  
  // Get existing columns
  const existingColumns = await dbAll(
    'SELECT column_name FROM table_columns WHERE table_id = ?',
    [tableId]
  );
  const existingNames = new Set(existingColumns.map(c => c.column_name));
  
  // Get max order_index
  const maxOrderRow = await dbGet(
    'SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?',
    [tableId]
  );
  let nextOrder = (maxOrderRow?.max_order || 0) + 1;
  
  const columnsToAdd = [];
  
  // Check for tags column
  if (!existingNames.has('tags')) {
    columnsToAdd.push({
      key: 'tags',
      name: 'Tags',
      type: 'multi_select',
      icon: '🏷️',
      order: nextOrder++,
      settings: {
        options: [
          { value: 'assistant', label: 'Assistant', color: '#3B82F6' },
          { value: 'builder', label: 'Builder', color: '#10B981' },
          { value: 'analyst', label: 'Analyst', color: '#8B5CF6' },
          { value: 'creative', label: 'Creative', color: '#F59E0B' },
          { value: 'code', label: 'Code', color: '#EF4444' },
          { value: 'data', label: 'Data', color: '#06B6D4' },
          { value: 'utility', label: 'Utility', color: '#6B7280' }
        ]
      }
    });
  }
  
  // Check for vector column
  if (!existingNames.has('vector')) {
    columnsToAdd.push({
      key: 'vector',
      name: 'Vector',
      type: 'vector',
      icon: '🧬',
      order: nextOrder++,
      settings: {
        formula: '{{name}} | {{description}} | {{system_prompt}}',
        agent_id: null,
        auto_generate: true
      }
    });
  }

  // Check for response_mode column (ADR-091: Unified Conversation Model)
  if (!existingNames.has('response_mode')) {
    columnsToAdd.push({
      key: 'response_mode',
      name: 'Response Mode',
      type: 'select',
      icon: '💬',
      order: nextOrder++,
      settings: {
        options: [
          { value: 'always', label: 'Always respond' },
          { value: 'topic_only', label: 'Topic only' },
          { value: 'mention_only', label: 'Mention only' }
        ],
        defaultValue: 'mention_only'
      }
    });
  }
  
  // Add missing columns
  for (const col of columnsToAdd) {
    const config = { icon: col.icon, ...col.settings };
    await dbRun(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 150, 0, ?, datetime('now'), datetime('now'))
    `, [tableId, col.key, col.name, col.type, JSON.stringify(config), col.order]);
    
    aiLogger.info({ tableId, column: col.key }, 'Added missing column to Agents table');
  }
  
  return {
    added: columnsToAdd.map(c => c.key),
    existed: [...existingNames]
  };
}

/**
 * Upgrade all Agents tables in all spaces with missing columns
 */
export async function upgradeAllAgentsTables() {
  aiLogger.info({}, 'Upgrading all Agents tables');
  
  // Find all Agents tables — match various naming conventions
  const agentsTables = await dbAll(`
    SELECT ut.id, ut.name, p.name as project_name, s.name as space_name
    FROM universal_tables ut
    JOIN projects p ON ut.project_id = p.id
    JOIN spaces s ON p.space_id = s.id
    WHERE LOWER(ut.name) = 'agents'
      OR LOWER(ut.name) = 'ai agents'
      OR LOWER(ut.name) LIKE '%ai_agents%'
      OR ut.name LIKE '%Agents%'
      OR ut.name LIKE '%agents%'
  `);
  
  const results = [];
  for (const table of agentsTables) {
    try {
      const result = await ensureAgentsTableColumns(table.id);
      results.push({
        tableId: table.id,
        tableName: table.name,
        spaceName: table.space_name,
        ...result
      });
    } catch (error) {
      aiLogger.error({ err: error, tableId: table.id }, 'Failed to upgrade Agents table');
      results.push({
        tableId: table.id,
        error: error.message
      });
    }
  }
  
  return results;
}

/**
 * Install AI Agents Pack for a user
 * Creates a space and adds AI Agents project
 */
export async function installAIAgentsPackForUser(userId) {
  aiLogger.info({ userId }, 'Installing AI Agents Pack for User');
  
  try {
    // Check if user already has AI Agents space
    const existingSpace = await dbGet(`
      SELECT id FROM spaces WHERE owner_id = ? AND name = 'AI Agents'
    `, [userId]);
    
    if (existingSpace) {
      aiLogger.debug({ userId }, 'User already has AI Agents space, skipping');
      return { success: true, spaceId: existingSpace.id, existing: true };
    }
    
    // Create space for AI Agents
    const spaceResult = await dbRun(`
      INSERT INTO spaces (name, type, icon, description, owner_id, settings, created_at, updated_at)
      VALUES ('AI Agents', 'business', '🤖', 'AI Agents workspace with chat, prompts and analytics', ?, '{}', datetime('now'), datetime('now'))
    `, [userId]);
    
    const spaceId = spaceResult.lastInsertRowid;
    aiLogger.info({ spaceId }, 'Created AI Agents space');
    
    // Create AI Agents Pack
    const result = await createAIAgentsPack(spaceId, userId);
    
    return {
      success: true,
      spaceId,
      projectId: result.projectId
    };
  } catch (error) {
    aiLogger.error({ err: error, userId }, 'Failed to install AI Agents Pack');
    throw error;
  }
}

export default {
  createAIAgentsPack,
  installAIAgentsPackForUser,
  ensureAgentsTableColumns,
  upgradeAllAgentsTables
};
