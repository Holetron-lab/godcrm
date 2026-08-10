/**
 * Labs Node Execution Operations Routes
 * Rerun and split operations for lab nodes
 * @see ADR-043: MindWorkflow Integration
 */
import { Router } from 'express';
import crypto from 'crypto';
import { apiLogger } from '../../../utils/logger.js';
import { success } from '../../../utils/response.js';
import { LabsService } from '../../../services/labs/index.js';
import {
  getTableRows,
  insertRow,
  updateRowByField
} from './_helpers.js';

const router = Router();

/**
 * POST /api/v3/labs/:labTableId/nodes/:nodeId/rerun
 * Re-execute node with optional clone
 */
router.post('/:labTableId/nodes/:nodeId/rerun', async (req, res) => {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const logs = [];

  try {
    const { labTableId, nodeId } = req.params;
    const { input, context = {}, clone = false } = req.body;

    logs.push(`[${new Date().toISOString()}] Starting node re-execution (clone: ${clone})`);

    // Get the node data
    const rows = await getTableRows(labTableId);
    const nodeRow = rows.find(row => row.node_id === nodeId);

    if (!nodeRow) {
      logs.push(`[${new Date().toISOString()}] Node not found: ${nodeId}`);
      return success(res, {
        status: 'error',
        nodeId,
        content: null,
        contentType: null,
        logs,
        runId,
        cloned: false,
        executionTime: Date.now() - startTime
      });
    }

    logs.push(`[${new Date().toISOString()}] Found node: ${nodeRow.title} (type: ${nodeRow.type_key})`);

    let targetNodeId = nodeId;
    let cloned = false;

    // If clone requested, create a copy of the node
    if (clone) {
      const newNodeId = crypto.randomUUID();
      const clonedNodeData = {
        node_id: newNodeId,
        type_key: nodeRow.type_key,
        title: `${nodeRow.title} (copy)`,
        content: nodeRow.content || '',
        position_x: (nodeRow.position_x || 0) + 50,
        position_y: (nodeRow.position_y || 0) + 50,
        width: nodeRow.width,
        height: nodeRow.height,
        edges: [], // Don't copy edges for cloned node
        ai_agent_id: nodeRow.ai_agent_id,
        config: nodeRow.config,
        order_index: (nodeRow.order_index || 0) + 1
      };

      await insertRow(labTableId, clonedNodeData, req.user?.id);
      targetNodeId = newNodeId;
      cloned = true;
      logs.push(`[${new Date().toISOString()}] Created clone: ${newNodeId}`);
    }

    // Parse config if it's a string
    if (typeof nodeRow.config === 'string') {
      try {
        nodeRow.config = JSON.parse(nodeRow.config);
      } catch (e) {
        nodeRow.config = {};
      }
    }

    // Enhanced context with input
    const enhancedContext = {
      ...context,
      input
    };

    // Execute the node
    logs.push(`[${new Date().toISOString()}] Executing node...`);
    const result = await LabsService.executeNode(nodeRow, enhancedContext);

    const executionTime = Date.now() - startTime;
    logs.push(`[${new Date().toISOString()}] Execution completed in ${executionTime}ms`);

    if (result.success) {
      logs.push(`[${new Date().toISOString()}] Result: success`);

      // Update the target node with the result
      if (result.output || result.content) {
        await updateRowByField(labTableId, 'node_id', targetNodeId, {
          content: result.output || result.content
        });
        logs.push(`[${new Date().toISOString()}] Updated node content`);
      }
    } else {
      logs.push(`[${new Date().toISOString()}] Result: error - ${result.error || 'Unknown error'}`);
    }

    apiLogger.info({
      nodeId,
      targetNodeId,
      runId,
      type: nodeRow.type_key,
      success: result.success,
      cloned,
      tokensUsed: result.tokensUsed,
      executionTime
    }, 'Node rerun completed');

    // Return MindWorkflow RunResponse format
    success(res, {
      status: result.success ? 'success' : 'error',
      nodeId,
      targetNodeId,
      content: result.output || result.content || null,
      contentType: result.contentType || nodeRow.type_key || null,
      logs,
      runId,
      cloned,
      tokensUsed: result.tokensUsed || result.usage?.totalTokens || undefined,
      executionTime,
      provider: result.provider || undefined,
      model: result.model || undefined
    });
  } catch (err) {
    const executionTime = Date.now() - startTime;
    logs.push(`[${new Date().toISOString()}] Error: ${err.message}`);
    apiLogger.error({ err, runId }, 'Failed to rerun lab node');

    success(res, {
      status: 'error',
      nodeId: req.params.nodeId,
      content: null,
      contentType: null,
      logs,
      runId,
      cloned: false,
      executionTime
    });
  }
});

/**
 * POST /api/v3/labs/:labTableId/nodes/:nodeId/split
 * Split text node into multiple nodes
 */
router.post('/:labTableId/nodes/:nodeId/split', async (req, res) => {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const logs = [];

  try {
    const { labTableId, nodeId } = req.params;
    const { separator = '\n\n' } = req.body;

    logs.push(`[${new Date().toISOString()}] Starting node split (separator: ${JSON.stringify(separator)})`);

    // Get the node data
    const rows = await getTableRows(labTableId);
    const nodeRow = rows.find(row => row.node_id === nodeId);

    if (!nodeRow) {
      logs.push(`[${new Date().toISOString()}] Node not found: ${nodeId}`);
      return success(res, {
        status: 'error',
        nodeId,
        content: null,
        contentType: null,
        logs,
        runId,
        createdNodes: [],
        executionTime: Date.now() - startTime
      });
    }

    logs.push(`[${new Date().toISOString()}] Found node: ${nodeRow.title} (type: ${nodeRow.type_key})`);

    // Get content to split
    const content = nodeRow.content || '';
    if (!content.trim()) {
      logs.push(`[${new Date().toISOString()}] Node has no content to split`);
      return success(res, {
        status: 'error',
        nodeId,
        content: null,
        contentType: null,
        logs,
        runId,
        createdNodes: [],
        executionTime: Date.now() - startTime
      });
    }

    // Split content
    const parts = content.split(separator).filter(part => part.trim());
    logs.push(`[${new Date().toISOString()}] Split into ${parts.length} parts`);

    if (parts.length <= 1) {
      logs.push(`[${new Date().toISOString()}] Content cannot be split (only 1 part)`);
      return success(res, {
        status: 'success',
        nodeId,
        content: content,
        contentType: nodeRow.type_key,
        logs,
        runId,
        createdNodes: [],
        executionTime: Date.now() - startTime
      });
    }

    // Parse config if it's a string
    let nodeConfig = nodeRow.config;
    if (typeof nodeConfig === 'string') {
      try {
        nodeConfig = JSON.parse(nodeConfig);
      } catch (e) {
        nodeConfig = {};
      }
    }

    // Create new nodes for each part
    const createdNodes = [];
    const baseX = nodeRow.position_x || 0;
    const baseY = nodeRow.position_y || 0;
    const offsetY = (nodeRow.height || 150) + 30; // Vertical spacing

    for (let i = 0; i < parts.length; i++) {
      const newNodeId = crypto.randomUUID();
      const partContent = parts[i].trim();

      // Generate title from first line or first 50 chars
      const firstLine = partContent.split('\n')[0];
      const title = firstLine.length > 50
        ? firstLine.substring(0, 47) + '...'
        : firstLine || `Part ${i + 1}`;

      const newNodeData = {
        node_id: newNodeId,
        type_key: nodeRow.type_key,
        title: title,
        content: partContent,
        position_x: baseX,
        position_y: baseY + (offsetY * (i + 1)),
        width: nodeRow.width,
        height: nodeRow.height,
        edges: [],
        ai_agent_id: nodeRow.ai_agent_id,
        config: nodeConfig,
        order_index: (nodeRow.order_index || 0) + i + 1
      };

      await insertRow(labTableId, newNodeData, req.user?.id);

      createdNodes.push({
        node_id: newNodeId,
        type: nodeRow.type_key,
        title: title
      });

      logs.push(`[${new Date().toISOString()}] Created node ${i + 1}: ${newNodeId}`);
    }

    const executionTime = Date.now() - startTime;
    logs.push(`[${new Date().toISOString()}] Split completed in ${executionTime}ms`);

    apiLogger.info({
      nodeId,
      runId,
      partsCount: parts.length,
      createdNodesCount: createdNodes.length,
      executionTime
    }, 'Node split completed');

    // Return MindWorkflow RunResponse format
    success(res, {
      status: 'success',
      nodeId,
      content: content,
      contentType: nodeRow.type_key,
      logs,
      runId,
      createdNodes,
      executionTime
    });
  } catch (err) {
    const executionTime = Date.now() - startTime;
    logs.push(`[${new Date().toISOString()}] Error: ${err.message}`);
    apiLogger.error({ err, runId }, 'Failed to split lab node');

    success(res, {
      status: 'error',
      nodeId: req.params.nodeId,
      content: null,
      contentType: null,
      logs,
      runId,
      createdNodes: [],
      executionTime
    });
  }
});

export default router;
