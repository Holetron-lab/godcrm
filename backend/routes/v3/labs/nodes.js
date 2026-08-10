/**
 * Labs Nodes Routes (v4 table-based)
 * CRUD for nodes in labs_nodes table
 * Legacy node endpoints are in legacy.js
 */
import { Router } from 'express';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, notFound, badRequest } from '../../../utils/response.js';
import { LabsService } from '../../../services/labs/index.js';
import { getNodeType } from '../../../services/labs/node-types/index.js';
import { generateId, toFlowNode } from './_helpers.js';

const router = Router();

/**
 * GET /api/v3/labs/:labTableId/nodes
 * Get all nodes from lab's table (uses labs_nodes table)
 */
router.get('/:labTableId/nodes', async (req, res) => {
  try {
    const { labTableId } = req.params;
    apiLogger.info({ labTableId }, 'Getting lab nodes for table');

    // Get nodes from labs_nodes table
    const nodes = await dbAll(`
      SELECT * FROM labs_nodes
      WHERE lab_id = $1
      ORDER BY created_at
    `, [labTableId]);

    // Get edges for connections
    const edges = await dbAll('SELECT * FROM labs_edges WHERE lab_id = $1', [labTableId]);

    // Transform nodes to MindWorkflow FlowNode format
    const parsedNodes = nodes.map(node => toFlowNode(node, edges));

    apiLogger.info({ labTableId, count: parsedNodes.length }, 'Lab nodes fetched');
    success(res, parsedNodes);
  } catch (err) {
    apiLogger.error({ err, labTableId: req.params.labTableId }, 'Failed to get lab nodes');
    badRequest(res, 'Failed to get lab nodes');
  }
});

/**
 * POST /api/v3/labs/:labTableId/nodes
 * Create node in lab's table
 */
router.post('/:labTableId/nodes', async (req, res) => {
  try {
    const { labTableId } = req.params;
    const nodeData = req.body;
    const userId = req.user?.id;

    // Support both MindWorkflow format (type) and GOD CRM format (type_key)
    const typeKey = nodeData.type_key || nodeData.type || 'text';

    // Validate node type exists
    const nodeType = getNodeType(typeKey);
    if (!nodeType) {
      return badRequest(res, `Invalid node type: ${typeKey}`);
    }

    // Create node with defaults from node type
    const completeNodeData = LabsService.createNodeWithDefaults(typeKey, nodeData);

    // Validate the complete node data
    const validation = LabsService.validateNode(completeNodeData);
    if (!validation.valid) {
      return badRequest(res, `Validation failed: ${validation.errors.join(', ')}`);
    }

    // Insert into labs_nodes table (not table_rows)
    const nodeId = completeNodeData.node_id || generateId('node');

    // Get position from various sources
    const posX = completeNodeData.position?.x ?? completeNodeData.position_x ?? 0;
    const posY = completeNodeData.position?.y ?? completeNodeData.position_y ?? 0;

    // Get edges as array (not stringified)
    const edgesArray = Array.isArray(completeNodeData.edges) ? completeNodeData.edges : [];

    // Get config as object (not stringified)
    const configObj = typeof completeNodeData.config === 'object' && completeNodeData.config !== null
      ? completeNodeData.config
      : {};

    // Build meta object with position, dimensions, edges, etc.
    const meta = {
      position: { x: posX, y: posY },
      width: completeNodeData.width || nodeType.defaultWidth || 300,
      height: completeNodeData.height || nodeType.defaultHeight || 200,
      edges: edgesArray,
      config: configObj,
      ...(completeNodeData.meta || {})
    };

    // Build ui_config object
    const uiConfig = completeNodeData.ui_config || {};

    // Build ai_config object
    const aiConfig = completeNodeData.ai_config || {};

    const result = await dbRun(`
      INSERT INTO labs_nodes (
        lab_id, node_id, type, title, content,
        meta, ai_config, ai_agent_id, ai_provider_id, ui_config,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        NOW(), NOW()
      )
    `, [
      labTableId,
      nodeId,
      typeKey,
      completeNodeData.title || nodeType.label || 'Untitled',
      completeNodeData.content || '',
      JSON.stringify(meta),
      JSON.stringify(aiConfig),
      completeNodeData.ai_agent_id || null,
      completeNodeData.ai_provider_id || null,
      JSON.stringify(uiConfig)
    ]);

    // Fetch the created node
    const node = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1', [nodeId]);

    if (!node) {
      return badRequest(res, 'Failed to fetch created node');
    }

    // Transform to MindWorkflow FlowNode format
    const flowNode = toFlowNode(node, []);

    apiLogger.info({ nodeType: typeKey, nodeId: flowNode.node_id }, 'Created lab node');

    created(res, flowNode);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create lab node');
    badRequest(res, 'Failed to create lab node');
  }
});

/**
 * Helper: build merged meta from existing node and updates
 */
function buildMergedMeta(existingMeta, updates) {
  const newMeta = { ...existingMeta };

  // Handle position updates
  if (updates.position) {
    newMeta.position = {
      x: updates.position.x ?? existingMeta.position?.x ?? 0,
      y: updates.position.y ?? existingMeta.position?.y ?? 0
    };
  }
  if (updates.position_x !== undefined || updates.position_y !== undefined) {
    newMeta.position = {
      x: updates.position_x ?? existingMeta.position?.x ?? 0,
      y: updates.position_y ?? existingMeta.position?.y ?? 0
    };
  }

  // Handle MindWorkflow ui.bbox format
  if (updates.ui?.bbox) {
    newMeta.position = {
      x: updates.ui.bbox.x1 ?? existingMeta.position?.x ?? 0,
      y: updates.ui.bbox.y1 ?? existingMeta.position?.y ?? 0
    };
    newMeta.width = (updates.ui.bbox.x2 - updates.ui.bbox.x1) || existingMeta.width || 300;
    newMeta.height = (updates.ui.bbox.y2 - updates.ui.bbox.y1) || existingMeta.height || 200;
  }

  // Handle dimensions
  if (updates.width !== undefined) newMeta.width = updates.width;
  if (updates.height !== undefined) newMeta.height = updates.height;

  // Handle edges array
  if (updates.edges !== undefined) {
    newMeta.edges = Array.isArray(updates.edges) ? updates.edges : [];
  }

  // Handle config object
  if (updates.config !== undefined) {
    newMeta.config = typeof updates.config === 'object' ? updates.config : {};
  }

  // Handle meta/config updates (MindWorkflow sends meta as config)
  if (updates.meta !== undefined) {
    newMeta.config = typeof updates.meta === 'object' ? updates.meta : {};
  }

  return newMeta;
}

/**
 * Helper: parse existing meta from node
 */
function parseExistingMeta(node) {
  if (!node.meta) return {};
  if (typeof node.meta === 'string') {
    try { return JSON.parse(node.meta); } catch (e) { return {}; }
  }
  return node.meta;
}

/**
 * PUT /api/v3/labs/:labTableId/nodes/:nodeId
 * Update node in labs_nodes table
 */
router.put('/:labTableId/nodes/:nodeId', async (req, res) => {
  try {
    const { labTableId, nodeId } = req.params;
    const updates = req.body;

    const existingNode = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1 AND lab_id = $2', [nodeId, labTableId]);
    if (!existingNode) {
      return notFound(res, 'Node not found');
    }

    const existingMeta = parseExistingMeta(existingNode);
    const newMeta = buildMergedMeta(existingMeta, updates);

    // Build dynamic UPDATE query
    const directFields = ['type', 'title', 'content', 'ai_agent_id', 'ai_provider_id', 'ai_visible'];
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const field of directFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
        paramIndex++;
      }
    }

    // Always update meta with merged values
    setClauses.push(`meta = $${paramIndex}`);
    values.push(JSON.stringify(newMeta));
    paramIndex++;

    if (updates.ai_config !== undefined) {
      setClauses.push(`ai_config = $${paramIndex}`);
      values.push(JSON.stringify(updates.ai_config));
      paramIndex++;
    }

    if (updates.ui_config !== undefined) {
      setClauses.push(`ui_config = $${paramIndex}`);
      values.push(JSON.stringify(updates.ui_config));
      paramIndex++;
    }

    if (updates.ai_routing_config !== undefined) {
      setClauses.push(`ai_routing_config = $${paramIndex}`);
      values.push(JSON.stringify(updates.ai_routing_config));
      paramIndex++;
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(nodeId);

    await dbRun(`
      UPDATE labs_nodes
      SET ${setClauses.join(', ')}
      WHERE node_id = $${paramIndex}
    `, values);

    const node = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1', [nodeId]);
    if (!node) {
      return notFound(res, 'Node not found after update');
    }

    const edges = await dbAll('SELECT * FROM labs_edges WHERE lab_id = $1', [labTableId]);
    const flowNode = toFlowNode(node, edges);

    success(res, flowNode);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to update lab node');
    badRequest(res, 'Failed to update lab node');
  }
});

// PATCH is alias for PUT (MindWorkflow uses PATCH for node updates)
router.patch('/:labTableId/nodes/:nodeId', async (req, res) => {
  try {
    const { labTableId, nodeId } = req.params;
    const updates = req.body;

    const existingNode = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1 AND lab_id = $2', [nodeId, labTableId]);
    if (!existingNode) {
      return notFound(res, 'Node not found');
    }

    const existingMeta = parseExistingMeta(existingNode);
    const newMeta = buildMergedMeta(existingMeta, updates);

    // Build dynamic UPDATE query
    const directFields = ['type', 'title', 'content', 'ai_agent_id', 'ai_provider_id', 'ai_visible'];
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const field of directFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = $${paramIndex}`);
        values.push(updates[field]);
        paramIndex++;
      }
    }

    setClauses.push(`meta = $${paramIndex}`);
    values.push(JSON.stringify(newMeta));
    paramIndex++;

    // Handle ai_config (MindWorkflow sends as 'ai')
    if (updates.ai !== undefined || updates.ai_config !== undefined) {
      setClauses.push(`ai_config = $${paramIndex}`);
      values.push(JSON.stringify(updates.ai || updates.ai_config));
      paramIndex++;
    }

    // Handle ui_config
    if (updates.ui?.color !== undefined) {
      const existingUiConfig = existingNode.ui_config ?
        (typeof existingNode.ui_config === 'string' ? JSON.parse(existingNode.ui_config) : existingNode.ui_config) : {};
      setClauses.push(`ui_config = $${paramIndex}`);
      values.push(JSON.stringify({ ...existingUiConfig, color: updates.ui.color }));
      paramIndex++;
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(nodeId);

    await dbRun(`
      UPDATE labs_nodes
      SET ${setClauses.join(', ')}
      WHERE node_id = $${paramIndex}
    `, values);

    const node = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1', [nodeId]);
    if (!node) {
      return notFound(res, 'Node not found after update');
    }

    const edges = await dbAll('SELECT * FROM labs_edges WHERE lab_id = $1', [labTableId]);
    const flowNode = toFlowNode(node, edges);

    success(res, flowNode);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to update lab node (PATCH)');
    badRequest(res, 'Failed to update lab node');
  }
});

/**
 * DELETE /api/v3/labs/:labTableId/nodes/:nodeId
 * Delete node from labs_nodes table
 */
router.delete('/:labTableId/nodes/:nodeId', async (req, res) => {
  try {
    const { labTableId, nodeId } = req.params;

    const node = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1 AND lab_id = $2', [nodeId, labTableId]);
    if (!node) {
      return notFound(res, 'Node not found');
    }

    await dbRun('DELETE FROM labs_nodes WHERE node_id = $1', [nodeId]);
    await dbRun('DELETE FROM labs_edges WHERE source_node_id = $1 OR target_node_id = $1', [nodeId]);

    success(res, { deleted: true });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to delete lab node');
    badRequest(res, 'Failed to delete lab node');
  }
});

export default router;
