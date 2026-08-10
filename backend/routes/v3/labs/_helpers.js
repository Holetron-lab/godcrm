/**
 * Shared helpers for Labs routes
 * Used by all sub-modules in the labs/ directory
 */
import { dbGet, dbRun, dbAll, sqlNow, toBool } from '../../../database/connection.js';
import { generateBaseId } from '../../../utils/baseId.js';

export function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateLabId() {
  return `lab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Transform a database node to MindWorkflow FlowNode format
 * @param {Object} node - Node from labs_nodes table
 * @param {Array} edges - All edges for the lab (optional, for connections)
 * @returns {Object} FlowNode format
 */
export function toFlowNode(node, edges = []) {
  // Parse JSONB fields
  let meta = {};
  let aiConfig = {};
  let uiConfig = {};

  if (node.meta) {
    meta = typeof node.meta === 'string' ? JSON.parse(node.meta) : node.meta;
  }
  if (node.ai_config) {
    aiConfig = typeof node.ai_config === 'string' ? JSON.parse(node.ai_config) : node.ai_config;
  }
  if (node.ui_config) {
    uiConfig = typeof node.ui_config === 'string' ? JSON.parse(node.ui_config) : node.ui_config;
  }

  // Extract position and dimensions from meta
  const posX = meta.position?.x || 0;
  const posY = meta.position?.y || 0;
  const width = meta.width || 300;
  const height = meta.height || 200;

  // Build connections from edges
  const incoming = edges
    .filter(e => e.target_node_id === node.node_id)
    .map(e => ({
      edge_id: e.edge_id || `${e.source_node_id}-${e.target_node_id}`,
      from: e.source_node_id,
      routing: e.source_handle || null
    }));

  const outgoing = edges
    .filter(e => e.source_node_id === node.node_id)
    .map(e => ({
      edge_id: e.edge_id || `${e.source_node_id}-${e.target_node_id}`,
      to: e.target_node_id,
      routing: e.target_handle || null
    }));

  // Return MindWorkflow FlowNode format
  return {
    node_id: node.node_id,
    type: node.type,
    title: node.title,
    content: node.content || '',
    content_type: meta.content_type || 'text/plain',
    meta: meta.config || {},
    ai: aiConfig,
    ui: {
      color: uiConfig.color || '#6366f1',
      bbox: {
        x1: posX,
        y1: posY,
        x2: posX + width,
        y2: posY + height
      }
    },
    ai_visible: node.ai_visible !== false,
    connections: { incoming, outgoing },
    // Also include raw data for compatibility
    position_x: posX,
    position_y: posY,
    width,
    height
  };
}

/**
 * Helper: Create lab nodes table with standard columns
 */
export async function createLabNodesTable(tableName, projectId, userId) {
  // Create the table
  const baseId = generateBaseId();
  const result = await dbRun(`
    INSERT INTO universal_tables (
      project_id,
      name,
      display_name,
      table_type,
      icon,
      base_id,
      created_by,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, 'lab_nodes', '🔬', ?, ?, ${sqlNow()}, ${sqlNow()})
  `, [projectId, tableName, tableName, baseId, userId]);

  const tableId = result.lastInsertRowid || result.lastID;

  // Create standard columns for lab nodes
  const columns = [
    { name: 'node_id', displayName: 'Node ID', type: 'text', required: true, order: 1 },
    { name: 'type_key', displayName: 'Type', type: 'text', required: true, order: 2 },
    { name: 'title', displayName: 'Title', type: 'text', required: true, order: 3 },
    { name: 'content', displayName: 'Content', type: 'text', required: false, order: 4 },
    { name: 'position_x', displayName: 'X', type: 'number', required: false, order: 5 },
    { name: 'position_y', displayName: 'Y', type: 'number', required: false, order: 6 },
    { name: 'width', displayName: 'Width', type: 'number', required: false, order: 7 },
    { name: 'height', displayName: 'Height', type: 'number', required: false, order: 8 },
    { name: 'edges', displayName: 'Edges', type: 'text', required: false, order: 9 }, // JSON array of node_ids
    { name: 'ai_agent_id', displayName: 'AI Agent', type: 'number', required: false, order: 10 },
    { name: 'config', displayName: 'Config', type: 'text', required: false, order: 11 }, // JSON
    { name: 'order_index', displayName: 'Order', type: 'number', required: false, order: 12 }
  ];

  for (const col of columns) {
    await dbRun(`
      INSERT INTO table_columns (
        table_id,
        column_name,
        display_name,
        type,
        is_required,
        order_index,
        is_visible,
        config,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [
      tableId,
      col.name,
      col.displayName,
      col.type,
      toBool(col.required),
      col.order,
      toBool(true),
      JSON.stringify({})
    ]);
  }

  return { id: tableId, name: tableName };
}

/**
 * Helper: Insert row into table
 */
export async function insertRow(tableId, data, userId = null) {
  const baseId = generateBaseId();
  const result = await dbRun(`
    INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
  `, [tableId, baseId, JSON.stringify(data), userId]);

  return { id: result.lastInsertRowid || result.lastID, ...data };
}

/**
 * Helper: Get table rows
 */
export async function getTableRows(tableId) {
  const rows = await dbAll(`
    SELECT id, base_id, data, created_at, updated_at
    FROM table_rows
    WHERE table_id = ?
    ORDER BY id
  `, [tableId]);

  return rows.map(row => {
    // JSONB may be auto-parsed or string
    const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    return {
      id: row.id,
      base_id: row.base_id,
      ...data,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  });
}

/**
 * Helper: Update row by field
 */
export async function updateRowByField(tableId, fieldName, fieldValue, updates) {
  // Handle special case where fieldName is 'id' (row ID)
  if (fieldName === 'id') {
    const row = await dbGet(`
      SELECT id, data FROM table_rows WHERE table_id = ? AND id = ?
    `, [tableId, fieldValue]);

    if (!row) {
      throw new Error(`Row with id=${fieldValue} not found`);
    }

    const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    const newData = { ...data, ...updates };

    await dbRun(`
      UPDATE table_rows SET data = ?, updated_at = ${sqlNow()}
      WHERE id = ?
    `, [JSON.stringify(newData), row.id]);

    return { id: row.id, ...newData };
  }

  // Original logic for data field matching
  const rows = await dbAll(`
    SELECT id, data FROM table_rows WHERE table_id = ?
  `, [tableId]);

  for (const row of rows) {
    // JSONB may be auto-parsed or string
    const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    if (data[fieldName] === fieldValue) {
      const newData = { ...data, ...updates };
      await dbRun(`
        UPDATE table_rows SET data = ?, updated_at = ${sqlNow()}
        WHERE id = ?
      `, [JSON.stringify(newData), row.id]);
      return { id: row.id, ...newData };
    }
  }

  throw new Error(`Row with ${fieldName}=${fieldValue} not found`);
}

/**
 * Helper: Delete row by field
 */
export async function deleteRowByField(tableId, fieldName, fieldValue) {
  // Handle special case where fieldName is 'id' (row ID)
  if (fieldName === 'id') {
    const result = await dbRun('DELETE FROM table_rows WHERE table_id = ? AND id = ?', [tableId, fieldValue]);
    return result.changes > 0;
  }

  // Original logic for data field matching
  const rows = await dbAll(`
    SELECT id, data FROM table_rows WHERE table_id = ?
  `, [tableId]);

  for (const row of rows) {
    // JSONB may be auto-parsed or string
    const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    if (data[fieldName] === fieldValue) {
      await dbRun('DELETE FROM table_rows WHERE id = ?', [row.id]);
      return true;
    }
  }

  return false;
}
