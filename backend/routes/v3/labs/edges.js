/**
 * Labs Edges Routes
 * CRUD for edges between nodes (both v4 and legacy)
 */
import { Router } from 'express';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, badRequest } from '../../../utils/response.js';
import { generateId } from './_helpers.js';

const router = Router();

// POST /labs/:id/edges - Create edge (supports both GOD CRM and MindWorkflow formats)
router.post('/:id/edges', async (req, res) => {
  try {
    const { id } = req.params;
    // Support both formats: GOD CRM (source_node_id) and MindWorkflow (from)
    const source_node_id = req.body.source_node_id || req.body.from;
    const target_node_id = req.body.target_node_id || req.body.to;
    const source_handle = req.body.source_handle || req.body.sourceHandle;
    const target_handle = req.body.target_handle || req.body.targetHandle;
    const label = req.body.label;

    if (!source_node_id || !target_node_id) return badRequest(res, 'source and target required');

    const edge_id = generateId('edge');
    await dbRun(
      `INSERT INTO labs_edges (lab_id, edge_id, source_node_id, target_node_id, source_handle, target_handle, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [id, edge_id, source_node_id, target_node_id, source_handle || null, target_handle || null]
    );

    // Also update the source node's edges array if using JSON storage
    try {
      const sourceNode = await dbGet(
        `SELECT * FROM "${id}" WHERE node_id = $1`,
        [source_node_id]
      );

      if (sourceNode) {
        let edges = [];
        try {
          edges = sourceNode.edges ? (typeof sourceNode.edges === 'string' ? JSON.parse(sourceNode.edges) : sourceNode.edges) : [];
        } catch (e) {
          edges = [];
        }

        // Add target to edges array if not already present
        if (!edges.includes(target_node_id)) {
          edges.push(target_node_id);
          await dbRun(
            `UPDATE "${id}" SET edges = $1 WHERE node_id = $2`,
            [JSON.stringify(edges), source_node_id]
          );
        }
      }
    } catch (tableErr) {
      // Table might not exist yet, that's ok
      apiLogger.debug({ tableErr }, 'Could not update node edges array');
    }

    const edge = await dbGet('SELECT * FROM labs_edges WHERE edge_id = $1', [edge_id]);

    // Return in MindWorkflow format
    const allEdges = await dbAll('SELECT * FROM labs_edges WHERE lab_id = $1', [id]);
    created(res, {
      edge,
      edges: allEdges.map(e => ({
        id: e.edge_id,
        from: e.source_node_id,
        to: e.target_node_id,
        sourceHandle: e.source_handle,
        targetHandle: e.target_handle
      }))
    }, 'Edge created');
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create edge');
    badRequest(res, 'Failed to create edge');
  }
});

// POST /projects/:id/edges (backward compatibility alias)
router.post('/projects/:id/edges', async (req, res) => {
  try {
    const { id } = req.params;
    const { source_node_id, target_node_id, source_handle, target_handle } = req.body;
    if (!source_node_id || !target_node_id) return badRequest(res, 'source and target required');
    const edge_id = generateId('edge');
    await dbRun(
      `INSERT INTO labs_edges (lab_id, edge_id, source_node_id, target_node_id, source_handle, target_handle, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [id, edge_id, source_node_id, target_node_id, source_handle || null, target_handle || null]
    );
    const edge = await dbGet('SELECT * FROM labs_edges WHERE edge_id = $1', [edge_id]);
    created(res, edge, 'Edge created');
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create edge');
    badRequest(res, 'Failed to create edge');
  }
});

// DELETE /edges/:edgeId
router.delete('/edges/:edgeId', async (req, res) => {
  try {
    const { edgeId } = req.params;
    await dbRun('DELETE FROM labs_edges WHERE edge_id = $1', [edgeId]);
    success(res, { deleted: true });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to delete edge');
    badRequest(res, 'Failed to delete edge');
  }
});

// DELETE /:labTableId/edges/:from/:to - Delete edge by source and target node IDs
router.delete('/:labTableId/edges/:from/:to', async (req, res) => {
  try {
    const { labTableId, from, to } = req.params;

    // Delete from labs_edges table
    await dbRun(
      'DELETE FROM labs_edges WHERE lab_id = $1 AND source_node_id = $2 AND target_node_id = $3',
      [labTableId, from, to]
    );

    // Also update the source node's edges array if using JSON storage
    const sourceNode = await dbGet(
      `SELECT * FROM "${labTableId}" WHERE node_id = $1`,
      [from]
    );

    if (sourceNode && sourceNode.edges) {
      let edges = [];
      try {
        edges = typeof sourceNode.edges === 'string' ? JSON.parse(sourceNode.edges) : sourceNode.edges;
      } catch (e) {
        edges = [];
      }

      // Remove the target from edges array
      const updatedEdges = edges.filter(e => e !== to && e.to !== to);

      await dbRun(
        `UPDATE "${labTableId}" SET edges = $1 WHERE node_id = $2`,
        [JSON.stringify(updatedEdges), from]
      );
    }

    // Return updated edges list
    const remainingEdges = await dbAll(
      'SELECT * FROM labs_edges WHERE lab_id = $1',
      [labTableId]
    );

    success(res, { edges: remainingEdges });
  } catch (err) {
    apiLogger.error({ err, labTableId: req.params.labTableId }, 'Failed to delete edge');
    badRequest(res, 'Failed to delete edge');
  }
});

export default router;
