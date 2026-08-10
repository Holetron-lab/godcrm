/**
 * Labs Node Execution Routes
 * Execute and run operations for lab nodes
 * Rerun and split are in execution-ops.js
 */
import { Router } from 'express';
import crypto from 'crypto';
import { dbGet } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest } from '../../../utils/response.js';
import { LabsService } from '../../../services/labs/index.js';
import { getTableRows } from './_helpers.js';

const router = Router();

/**
 * POST /api/v3/labs/:labTableId/nodes/:nodeId/execute
 * Execute a specific node with routing support
 */
router.post('/:labTableId/nodes/:nodeId/execute', async (req, res) => {
  try {
    const { labTableId, nodeId } = req.params;
    const {
      input,
      context = {},
      routing_config,
      output_format
    } = req.body;

    // Get the node data from labs_nodes table
    const nodeRow = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1 AND lab_id = $2', [nodeId, labTableId]);

    if (!nodeRow) {
      return notFound(res, 'Node not found');
    }

    // Parse JSON fields
    if (typeof nodeRow.config === 'string') {
      try { nodeRow.config = JSON.parse(nodeRow.config); } catch (e) { nodeRow.config = {}; }
    }
    if (typeof nodeRow.ai_config === 'string') {
      try { nodeRow.ai_config = JSON.parse(nodeRow.ai_config); } catch (e) { nodeRow.ai_config = {}; }
    }
    if (typeof nodeRow.edges === 'string') {
      try { nodeRow.edges = JSON.parse(nodeRow.edges); } catch (e) { nodeRow.edges = []; }
    }

    // Map type to type_key for compatibility
    nodeRow.type_key = nodeRow.type;

    // Enhanced context with routing support
    const enhancedContext = {
      ...context,
      input,
      routing_config,
      output_format
    };

    // Execute the node
    const result = await LabsService.executeNode(nodeRow, enhancedContext);

    apiLogger.info({
      nodeId,
      type: nodeRow.type_key,
      success: result.success,
      selectedRoute: result.selectedRoute,
      detectedType: result.detectedType,
      tokensUsed: result.tokensUsed
    }, 'Node execution completed with routing');

    success(res, result);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to execute lab node');
    badRequest(res, 'Failed to execute lab node');
  }
});

/**
 * POST /api/v3/labs/:labTableId/nodes/:nodeId/run
 * Execute node and return MindWorkflow RunResponse format
 * @see ADR-043: MindWorkflow Integration
 */
router.post('/:labTableId/nodes/:nodeId/run', async (req, res) => {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const logs = [];

  try {
    const { labTableId, nodeId } = req.params;
    const { input, context = {} } = req.body;

    logs.push(`[${new Date().toISOString()}] Starting node execution`);

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
        executionTime: Date.now() - startTime
      });
    }

    logs.push(`[${new Date().toISOString()}] Found node: ${nodeRow.title} (type: ${nodeRow.type_key})`);

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
    } else {
      logs.push(`[${new Date().toISOString()}] Result: error - ${result.error || 'Unknown error'}`);
    }

    apiLogger.info({
      nodeId,
      runId,
      type: nodeRow.type_key,
      success: result.success,
      tokensUsed: result.tokensUsed,
      executionTime
    }, 'Node run completed');

    // Return MindWorkflow RunResponse format
    success(res, {
      status: result.success ? 'success' : 'error',
      nodeId,
      content: result.output || result.content || null,
      contentType: result.contentType || nodeRow.type_key || null,
      logs,
      runId,
      tokensUsed: result.tokensUsed || result.usage?.totalTokens || undefined,
      executionTime,
      provider: result.provider || undefined,
      model: result.model || undefined
    });
  } catch (err) {
    const executionTime = Date.now() - startTime;
    logs.push(`[${new Date().toISOString()}] Error: ${err.message}`);
    apiLogger.error({ err, runId }, 'Failed to run lab node');

    success(res, {
      status: 'error',
      nodeId: req.params.nodeId,
      content: null,
      contentType: null,
      logs,
      runId,
      executionTime
    });
  }
});

export default router;
