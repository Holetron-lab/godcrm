/**
 * Labs Legacy API Routes
 * Backward compatibility endpoints for /, /:id, /init,
 * /:id/nodes, /nodes/:nodeId, /projects/:id/nodes
 * These are registered after v4 routes - duplicate paths are shadowed.
 */
import { Router } from 'express';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, notFound, badRequest } from '../../../utils/response.js';
import { generateId, generateLabId } from './_helpers.js';

const router = Router();

// === LEGACY LAB ENDPOINTS ===

// GET / - List labs
router.get('/', async (req, res) => {
  try {
    const { space_id } = req.query;
    let query = 'SELECT * FROM labs';
    const params = [];
    if (space_id) {
      query += ' WHERE space_id = $1';
      params.push(space_id);
    }
    query += ' ORDER BY updated_at DESC';
    const labs = await dbAll(query, params);
    success(res, labs);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get labs');
    badRequest(res, 'Failed to get labs');
  }
});

// POST / - Create lab
router.post('/', async (req, res) => {
  try {
    const { space_id, title, description, settings } = req.body;
    if (!title) return badRequest(res, 'Title is required');
    const lab_id = generateLabId();
    await dbRun(
      `INSERT INTO labs (space_id, lab_id, title, description, settings, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [space_id || null, lab_id, title, description || null, JSON.stringify(settings || {})]
    );
    const lab = await dbGet('SELECT * FROM labs WHERE lab_id = $1', [lab_id]);
    created(res, lab, 'Lab created');
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create lab');
    badRequest(res, 'Failed to create lab');
  }
});

// POST /projects - Create project (backward compatibility alias)
router.post('/projects', async (req, res) => {
  try {
    const { space_id, title, description, settings } = req.body;
    if (!title) return badRequest(res, 'Title is required');
    const lab_id = generateLabId();
    await dbRun(
      `INSERT INTO labs (space_id, lab_id, title, description, settings, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [space_id || null, lab_id, title, description || null, JSON.stringify(settings || {})]
    );
    const lab = await dbGet('SELECT * FROM labs WHERE lab_id = $1', [lab_id]);
    created(res, lab, 'Lab created');
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create lab');
    badRequest(res, 'Failed to create lab');
  }
});

// GET /projects - List projects (backward compatibility alias)
router.get('/projects', async (req, res) => {
  try {
    const { space_id } = req.query;
    let query = 'SELECT * FROM labs';
    const params = [];
    if (space_id) {
      query += ' WHERE space_id = $1';
      params.push(space_id);
    }
    query += ' ORDER BY updated_at DESC';
    const labs = await dbAll(query, params);
    success(res, labs);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get labs');
    badRequest(res, 'Failed to get labs');
  }
});

// POST /init - Initialize lab for widget
router.post('/init', async (req, res) => {
  try {
    const { space_id, widget_id, title } = req.body;

    if (!space_id) {
      return badRequest(res, 'space_id is required');
    }

    // Check if lab already exists for this widget
    if (widget_id) {
      const existing = await dbGet(
        `SELECT * FROM labs WHERE space_id = $1 AND (settings->>'widget_id')::int = $2`,
        [space_id, widget_id]
      );

      if (existing) {
        return success(res, {
          lab_id: existing.lab_id,
          id: existing.id,
          already_exists: true
        });
      }
    }

    // Create new lab
    const lab_id = generateLabId();
    const labTitle = title || 'New Lab';

    await dbRun(`
      INSERT INTO labs (space_id, lab_id, title, settings, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
    `, [space_id, lab_id, labTitle, JSON.stringify({ widget_id })]);

    const lab = await dbGet('SELECT * FROM labs WHERE lab_id = $1', [lab_id]);

    created(res, {
      lab_id: lab.lab_id,
      id: lab.id,
      title: lab.title,
      initialized: true
    });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to initialize lab');
    badRequest(res, 'Failed to initialize lab');
  }
});

// GET /:id - Get lab with nodes/edges
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const lab = await dbGet('SELECT * FROM labs WHERE lab_id = $1', [id]);
    if (!lab) return notFound(res, 'Lab');
    const nodes = await dbAll('SELECT * FROM labs_nodes WHERE lab_id = $1', [id]);
    const edges = await dbAll('SELECT * FROM labs_edges WHERE lab_id = $1', [id]);
    success(res, { ...lab, nodes, edges });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to get lab');
    badRequest(res, 'Failed to get lab');
  }
});

// PUT /:id
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, settings } = req.body;
    await dbRun(
      `UPDATE labs SET title = COALESCE($1, title), description = COALESCE($2, description),
       settings = COALESCE($3, settings), updated_at = NOW() WHERE lab_id = $4`,
      [title, description, settings ? JSON.stringify(settings) : null, id]
    );
    const lab = await dbGet('SELECT * FROM labs WHERE lab_id = $1', [id]);
    if (!lab) return notFound(res, 'Lab');
    success(res, lab);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to update lab');
    badRequest(res, 'Failed to update lab');
  }
});

// PUT /projects/:id (backward compatibility alias)
router.put('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, settings } = req.body;
    await dbRun(
      `UPDATE labs SET title = COALESCE($1, title), description = COALESCE($2, description),
       settings = COALESCE($3, settings), updated_at = NOW() WHERE lab_id = $4`,
      [title, description, settings ? JSON.stringify(settings) : null, id]
    );
    const lab = await dbGet('SELECT * FROM labs WHERE lab_id = $1', [id]);
    if (!lab) return notFound(res, 'Lab');
    success(res, lab);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to update lab');
    badRequest(res, 'Failed to update lab');
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun('DELETE FROM labs_edges WHERE lab_id = $1', [id]);
    await dbRun('DELETE FROM labs_nodes WHERE lab_id = $1', [id]);
    const result = await dbRun('DELETE FROM labs WHERE lab_id = $1', [id]);
    success(res, { deleted: true });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to delete lab');
    badRequest(res, 'Failed to delete lab');
  }
});

// DELETE /projects/:id (backward compatibility alias)
router.delete('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun('DELETE FROM labs_edges WHERE lab_id = $1', [id]);
    await dbRun('DELETE FROM labs_nodes WHERE lab_id = $1', [id]);
    const result = await dbRun('DELETE FROM labs WHERE lab_id = $1', [id]);
    success(res, { deleted: true });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to delete lab');
    badRequest(res, 'Failed to delete lab');
  }
});

// === LEGACY NODE ENDPOINTS ===

// POST /labs/:id/nodes
router.post('/:id/nodes', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, title, content, meta, ai_config, ui_config } = req.body;
    if (!type || !title) return badRequest(res, 'Type and title required');
    const node_id = generateId('node');
    await dbRun(
      `INSERT INTO labs_nodes (lab_id, node_id, type, title, content, meta, ai_config, ui_config, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [id, node_id, type, title, content || null, JSON.stringify(meta || {}), JSON.stringify(ai_config || {}), JSON.stringify(ui_config || {})]
    );
    const node = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1', [node_id]);
    created(res, node, 'Node created');
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create node');
    badRequest(res, 'Failed to create node');
  }
});

// POST /projects/:id/nodes (backward compatibility alias)
router.post('/projects/:id/nodes', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, title, content, meta, ai_config, ui_config } = req.body;
    if (!type || !title) return badRequest(res, 'Type and title required');
    const node_id = generateId('node');
    await dbRun(
      `INSERT INTO labs_nodes (lab_id, node_id, type, title, content, meta, ai_config, ui_config, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [id, node_id, type, title, content || null, JSON.stringify(meta || {}), JSON.stringify(ai_config || {}), JSON.stringify(ui_config || {})]
    );
    const node = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1', [node_id]);
    created(res, node, 'Node created');
  } catch (err) {
    apiLogger.error({ err }, 'Failed to create node');
    badRequest(res, 'Failed to create node');
  }
});

// PUT /nodes/:nodeId
router.put('/nodes/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { title, content, meta, ai_config, ui_config } = req.body;
    await dbRun(
      `UPDATE labs_nodes SET title = COALESCE($1, title), content = COALESCE($2, content),
       meta = COALESCE($3, meta), ai_config = COALESCE($4, ai_config), ui_config = COALESCE($5, ui_config),
       updated_at = NOW() WHERE node_id = $6`,
      [title, content, meta ? JSON.stringify(meta) : null, ai_config ? JSON.stringify(ai_config) : null,
       ui_config ? JSON.stringify(ui_config) : null, nodeId]
    );
    const node = await dbGet('SELECT * FROM labs_nodes WHERE node_id = $1', [nodeId]);
    if (!node) return notFound(res, 'Node');
    success(res, node);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to update node');
    badRequest(res, 'Failed to update node');
  }
});

// DELETE /nodes/:nodeId
router.delete('/nodes/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    await dbRun('DELETE FROM labs_edges WHERE source_node_id = $1 OR target_node_id = $1', [nodeId]);
    await dbRun('DELETE FROM labs_nodes WHERE node_id = $1', [nodeId]);
    success(res, { deleted: true });
  } catch (err) {
    apiLogger.error({ err }, 'Failed to delete node');
    badRequest(res, 'Failed to delete node');
  }
});

export default router;
