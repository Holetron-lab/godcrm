/**
 * Labs Projects Routes (v4)
 * CRUD for lab projects (both registry-based and MindWorkflow direct)
 */
import { Router } from 'express';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, notFound, badRequest, error } from '../../../utils/response.js';
import {
  generateId,
  slugify,
  toFlowNode,
  createLabNodesTable,
  insertRow,
  getTableRows,
  updateRowByField,
  deleteRowByField
} from './_helpers.js';

const router = Router();

/**
 * GET /api/v3/labs/projects
 * List labs - supports two modes:
 * 1. With registry_table_id - uses table_rows (legacy)
 * 2. Without registry_table_id - uses labs table directly (MindWorkflow)
 */
router.get('/projects', async (req, res) => {
  try {
    const { registry_table_id, space_id } = req.query;

    // Mode 1: Registry-based (legacy)
    if (registry_table_id) {
      const labs = await getTableRows(registry_table_id);
      return success(res, labs);
    }

    // Mode 2: Direct labs table (MindWorkflow)
    let query = 'SELECT * FROM labs';
    const params = [];

    if (space_id) {
      query += ' WHERE space_id = $1';
      params.push(space_id);
    }

    query += ' ORDER BY created_at DESC';

    const labs = await dbAll(query, params);
    success(res, labs);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get labs');
    badRequest(res, 'Failed to get labs');
  }
});

/**
 * POST /api/v3/labs/projects
 * Create lab - supports two modes:
 * 1. With registry_table_id - uses table_rows (legacy)
 * 2. Without registry_table_id - uses labs table directly (MindWorkflow)
 */
router.post('/projects', async (req, res) => {
  try {
    const { registry_table_id, name, title, description, icon, space_id } = req.body;
    const userId = req.user?.id;

    // Use title or name (MindWorkflow uses title, legacy uses name)
    const labTitle = title || name;

    if (!labTitle) {
      return badRequest(res, 'Lab name/title is required');
    }

    // Mode 1: Registry-based (legacy)
    if (registry_table_id) {
      // Get registry table info to find project_id
      const registryTable = await dbGet(`
        SELECT project_id FROM universal_tables WHERE id = ?
      `, [registry_table_id]);

      if (!registryTable) {
        return notFound(res, 'Registry table not found');
      }

      // Generate slug
      const slug = slugify(labTitle);

      // Create nodes table for this lab
      const timestamp = Date.now();
      const nodesTableName = `lab_${slug}_${timestamp}`;
      const nodesTable = await createLabNodesTable(nodesTableName, registryTable.project_id, userId);

      // Add entry to registry table
      const labData = {
        name: labTitle,
        description: description || '',
        slug,
        table_id: nodesTable.id,
        icon: icon || '🧪',
        status: 'draft'
      };

      const labRow = await insertRow(registry_table_id, labData, userId);

      apiLogger.info(`[Labs v4] Created lab "${labTitle}" with nodes table ${nodesTable.id}`);

      return created(res, {
        lab_id: labRow.id,
        table_id: nodesTable.id,
        slug,
        name: labTitle
      });
    }

    // Mode 2: Direct labs table (MindWorkflow)
    const labId = generateId('lab');

    await dbRun(`
      INSERT INTO labs (lab_id, space_id, title, description, settings, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    `, [labId, space_id || null, labTitle, description || '', JSON.stringify({})]);

    const lab = await dbGet('SELECT * FROM labs WHERE lab_id = $1', [labId]);

    apiLogger.info({ labId, title: labTitle }, 'Created lab project');

    created(res, lab);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create lab');
    error(res, 'CREATE_LAB_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/labs/projects/:id
 * Get lab with nodes
 */
router.get('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { registry_table_id } = req.query;

    // Mode 1: Registry-based (legacy)
    if (registry_table_id) {
      const labRows = await getTableRows(registry_table_id);
      const lab = labRows.find(row => row.id == id);

      if (!lab) {
        return notFound(res, 'Lab not found');
      }

      // Get nodes from lab's table
      let nodes = [];
      if (lab.table_id) {
        nodes = await getTableRows(lab.table_id);
      }

      return success(res, { ...lab, nodes });
    }

    // Mode 2: Direct labs table (MindWorkflow)
    const lab = await dbGet('SELECT * FROM labs WHERE lab_id = $1', [id]);
    if (!lab) {
      return notFound(res, 'Lab not found');
    }

    // Get nodes from labs_nodes table
    const nodes = await dbAll('SELECT * FROM labs_nodes WHERE lab_id = $1 ORDER BY created_at', [id]);

    // Get edges from labs_edges table
    const edges = await dbAll('SELECT * FROM labs_edges WHERE lab_id = $1', [id]);

    // Transform nodes to MindWorkflow FlowNode format
    const parsedNodes = nodes.map(node => toFlowNode(node, edges));

    // Transform edges to MindWorkflow FlowEdge format
    const parsedEdges = edges.map(edge => ({
      from: edge.source_node_id,
      to: edge.target_node_id,
      label: null,
      sourceHandle: edge.source_handle || null,
      targetHandle: edge.target_handle || null
    }));

    // Build response in MindWorkflow ProjectFlow format
    const projectFlow = {
      project_id: lab.lab_id,
      title: lab.title,
      description: lab.description || '',
      created_at: lab.created_at,
      updated_at: lab.updated_at,
      settings: typeof lab.settings === 'string' ? JSON.parse(lab.settings) : (lab.settings || {}),
      nodes: parsedNodes,
      edges: parsedEdges,
      schemas: {},
      is_public: false,
      mode: 'editing',
      role: 'owner'
    };

    success(res, projectFlow);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get lab');
    badRequest(res, 'Failed to get lab');
  }
});

/**
 * PUT /api/v3/labs/projects/:id
 * Update lab
 */
router.put('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { registry_table_id, name, description, icon, status } = req.body;

    if (!registry_table_id) {
      return badRequest(res, 'registry_table_id is required');
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (icon !== undefined) updates.icon = icon;
    if (status !== undefined) updates.status = status;

    const updatedLab = await updateRowByField(registry_table_id, 'id', parseInt(id), updates);
    success(res, updatedLab);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to update lab');
    badRequest(res, 'Failed to update lab');
  }
});

/**
 * DELETE /api/v3/labs/projects/:id
 * Delete lab + nodes table
 */
router.delete('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { registry_table_id, delete_table = true } = req.body;

    if (!registry_table_id) {
      return badRequest(res, 'registry_table_id is required');
    }

    // Get lab info first
    const labRows = await getTableRows(registry_table_id);
    const lab = labRows.find(row => row.id == id);

    if (!lab) {
      return notFound(res, 'Lab not found');
    }

    // Delete nodes table if requested
    if (delete_table && lab.table_id) {
      await dbRun(`DELETE FROM table_rows WHERE table_id = ?`, [lab.table_id]);
      await dbRun(`DELETE FROM table_columns WHERE table_id = ?`, [lab.table_id]);
      await dbRun(`DELETE FROM universal_tables WHERE id = ?`, [lab.table_id]);
    }

    // Delete lab from registry
    const deleted = await deleteRowByField(registry_table_id, 'id', parseInt(id));

    if (!deleted) {
      return notFound(res, 'Lab not found');
    }

    success(res, { deleted: true, table_deleted: delete_table && !!lab.table_id });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to delete lab');
    badRequest(res, 'Failed to delete lab');
  }
});

export default router;
