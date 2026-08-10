/**
 * API v3: Widget Routes
 * Handles CRUD operations for Dashboard Widgets
 * Based on ADR-002: Widget System Architecture
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Widget:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         dashboard_id:
 *           type: integer
 *         widget_type:
 *           type: string
 *           enum: [preset, custom]
 *         preset_name:
 *           type: string
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         config:
 *           type: object
 *         position:
 *           type: object
 *         code:
 *           type: string
 *     Dashboard:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         project_id:
 *           type: integer
 *         name:
 *           type: string
 *         is_default:
 *           type: boolean
 */

import express from 'express';
import {
  createWidget,
  getWidgetById,
  getEffectiveWidgetConfig,
  getWidgetsByDashboard,
  getWidgetsByOwner,
  updateWidget,
  updateWidgetCode,
  deleteWidget,
  getWidgetData,
  countAtomRefs
} from '../../services/WidgetService.js';
import { getAllPresets } from '../../widgets/presets.js';
import { dbGet, toBool, sqlNow, sqlTrue } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound, noContent } from '../../utils/response.js';
// ADR-0012 §Phase 1 — server-side ticket resolution for widgets.
import resolveTicketsController from './widgets/resolveTicketsController.js';
// ADR-0012 §Phase 5 (M3 backend) — single-ticket resolve for ticket_ref atoms.
import resolveTicketRefController from './widgets/resolveTicketRefController.js';

const router = express.Router();

// Mount sub-routers BEFORE the `/widgets/:widgetId` catch-all so specific
// routes like `/widgets/:id/resolve-tickets` and
// `/widgets/:id/tickets/:ticketId/resolve` take precedence.
router.use(resolveTicketsController);
router.use(resolveTicketRefController);

/**
 * GET /api/v3/projects/:projectId/widgets
 * Get all widgets for a project (via its default dashboard)
 * @swagger
 * /api/v3/projects/{projectId}/widgets:
 *   get:
 *     summary: Get all widgets for a project
 *     tags: [Widgets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of widgets
 */
router.get('/projects/:projectId/widgets', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { is_module } = req.query;

    // Get default dashboard for project
    const dashboard = await dbGet(
      `SELECT id FROM dashboards WHERE project_id = ? AND is_default = ${sqlTrue()} LIMIT 1`,
      [projectId]
    );

    if (!dashboard) {
      return success(res, []);
    }

    const options = {};
    if (is_module !== undefined) {
      options.is_module = is_module === 'true';
    }

    const widgets = await getWidgetsByDashboard(dashboard.id, options);

    success(res, widgets);
  } catch (err) {
    apiLogger.error('Error fetching project widgets:', err);
    error(res, err.message);
  }
});

/**
 * GET /api/v3/projects/:projectId/dashboard
 * Get or create default dashboard for a project
 */
router.get('/projects/:projectId/dashboard', async (req, res) => {
  try {
    const { projectId } = req.params;

    // Get default dashboard for project
    let dashboard = await dbGet(
      `SELECT * FROM dashboards WHERE project_id = ? AND is_default = ${sqlTrue()} LIMIT 1`,
      [projectId]
    );

    // If no dashboard exists, create one
    if (!dashboard) {
      const result = await dbGet(
        `INSERT INTO dashboards (project_id, name, is_default, created_at, updated_at) 
         VALUES ($1, 'Main Dashboard', $2, ${sqlNow()}, ${sqlNow()}) RETURNING *`,
        [projectId, toBool(true)]
      );
      dashboard = result;
    }

    success(res, dashboard);
  } catch (err) {
    apiLogger.error('Error fetching project dashboard:', err);
    error(res, err.message);
  }
});

/**
 * GET /api/v3/dashboards/:dashboardId
 * Get dashboard by ID
 */
router.get('/dashboards/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    
    const dashboard = await dbGet('SELECT * FROM dashboards WHERE id = ?', [dashboardId]);
    
    if (!dashboard) {
      return notFound(res, 'Dashboard not found');
    }

    success(res, dashboard);
  } catch (err) {
    apiLogger.error('Error fetching dashboard:', err);
    error(res, err.message);
  }
});

/**
 * GET /api/v3/widgets/presets
 * Get all available widget presets
 * NOTE: This must be BEFORE /widgets/:widgetId to avoid matching "presets" as widgetId
 * @swagger
 * /api/v3/widgets/presets:
 *   get:
 *     summary: Get all available widget presets
 *     tags: [Widgets]
 *     responses:
 *       200:
 *         description: List of widget presets
 */
router.get('/widgets/presets', async (req, res) => {
  try {
    const presets = getAllPresets();

    success(res, presets);
  } catch (err) {
    apiLogger.error('Error fetching presets:', err);
    error(res, err.message);
  }
});

/**
 * GET /api/v3/dashboards/:dashboardId/widgets
 * Get all widgets for a dashboard
 */
router.get('/dashboards/:dashboardId/widgets', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const { is_module } = req.query;

    // Verify dashboard exists
    const dashboard = await dbGet('SELECT id FROM dashboards WHERE id = ?', [dashboardId]);
    if (!dashboard) {
      return notFound(res, 'Dashboard not found');
    }

    const options = {};
    if (is_module !== undefined) {
      options.is_module = is_module === 'true';
    }

    const widgets = await getWidgetsByDashboard(parseInt(dashboardId), options);

    success(res, widgets);
  } catch (err) {
    apiLogger.error('Error fetching widgets:', err);
    error(res, err.message);
  }
});

/**
 * POST /api/v3/dashboards/:dashboardId/widgets
 * Create new widget
 * @swagger
 * /api/v3/dashboards/{dashboardId}/widgets:
 *   post:
 *     summary: Create new widget
 *     tags: [Widgets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dashboardId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [widget_type, title]
 *             properties:
 *               widget_type:
 *                 type: string
 *               title:
 *                 type: string
 *               preset_name:
 *                 type: string
 *               code:
 *                 type: string
 *               config:
 *                 type: object
 *     responses:
 *       201:
 *         description: Widget created
 */
router.post('/dashboards/:dashboardId/widgets', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const {
      widget_type,
      preset_name,
      code,
      title,
      description,
      icon,
      config,
      position,
      order_index,
      source_widget_id,
      is_module
    } = req.body;

    // Validation
    if (!widget_type) {
      return badRequest(res, 'widget_type is required');
    }

    if (!title) {
      return badRequest(res, 'title is required');
    }

    const widget = await createWidget({
      dashboard_id: parseInt(dashboardId),
      widget_type,
      preset_name,
      code,
      title,
      description,
      icon,
      config,
      position,
      order_index,
      source_widget_id,
      created_by: req.user.id,
      is_module: is_module || false
    });

    created(res, widget);
  } catch (err) {
    apiLogger.error('Error creating widget:', err);
    
    // Handle validation errors
    if (err.message.includes('required') || 
        err.message.includes('cannot have') || 
        err.message.includes('must be')) {
      return badRequest(res, err.message);
    }

    error(res, err.message);
  }
});

/**
 * GET /api/v3/widgets
 * List widgets by polymorphic owner (ADR-0003 widget-embed Phase 1).
 * Query: ?owner_kind=document|atom|dashboard&owner_id=123
 */
router.get('/widgets', async (req, res) => {
  try {
    const { owner_kind, owner_id, is_module } = req.query;
    if (!owner_kind || !owner_id) {
      return badRequest(res, 'owner_kind and owner_id are required');
    }
    const options = {};
    if (is_module !== undefined) options.is_module = is_module === 'true';
    const widgets = await getWidgetsByOwner(String(owner_kind), parseInt(owner_id, 10), options);
    success(res, widgets);
  } catch (err) {
    apiLogger.error('Error fetching widgets by owner:', err);
    if (err.message.includes('owner_kind must be')) return badRequest(res, err.message);
    error(res, err.message);
  }
});

/**
 * GET /api/v3/widgets/by-registry-table/:tableId
 * Look up the widget id that owns a given documents-registry table.
 * Used by chat-side row attachments to navigate from a row card back to
 * the documents widget that hosts the document. Returns 404 when no
 * documents widget references this registry.
 */
router.get('/widgets/by-registry-table/:tableId', async (req, res) => {
  try {
    const tableId = parseInt(req.params.tableId, 10);
    if (!Number.isFinite(tableId)) return badRequest(res, 'tableId must be a number');
    const tableIdStr = String(tableId);
    const row = await dbGet(
      `SELECT id FROM widgets
       WHERE (config::jsonb->>'registry_table_id') = ?
          OR (config::jsonb->>'documents_table_id') = ?
       ORDER BY id ASC
       LIMIT 1`,
      [tableIdStr, tableIdStr],
    );
    if (!row) return notFound(res, 'Widget for registry table');
    return success(res, { widget_id: row.id });
  } catch (err) {
    apiLogger.error({ err }, 'GET /widgets/by-registry-table/:tableId error');
    return error(res, err.message);
  }
});

/**
 * POST /api/v3/widgets
 * Create widget with explicit polymorphic owner (ADR-0003 widget-embed Phase 1).
 * Body: { owner_kind, owner_id, widget_type, title, preset_name?, code?, config?, position?, ... }
 */
router.post('/widgets', async (req, res) => {
  try {
    const {
      owner_kind,
      owner_id,
      widget_type,
      preset_name,
      code,
      title,
      description,
      icon,
      config,
      position,
      order_index,
      source_widget_id,
      is_module
    } = req.body;

    if (!owner_kind || owner_id == null) {
      return badRequest(res, 'owner_kind and owner_id are required');
    }
    if (!widget_type) return badRequest(res, 'widget_type is required');
    if (!title) return badRequest(res, 'title is required');

    const widget = await createWidget({
      owner_kind,
      owner_id: parseInt(owner_id, 10),
      widget_type,
      preset_name,
      code,
      title,
      description,
      icon,
      config,
      position,
      order_index,
      source_widget_id,
      created_by: req.user.id,
      is_module: is_module || false,
    });

    created(res, widget);
  } catch (err) {
    apiLogger.error('Error creating widget (by owner):', err);
    if (
      err.message.includes('required') ||
      err.message.includes('cannot have') ||
      err.message.includes('must be') ||
      err.message.includes('must be one of') ||
      err.message.includes('not found')
    ) {
      return badRequest(res, err.message);
    }
    error(res, err.message);
  }
});

/**
 * GET /api/v3/widgets/:widgetId
 * Get widget by ID
 * @swagger
 * /api/v3/widgets/{widgetId}:
 *   get:
 *     summary: Get widget by ID
 *     tags: [Widgets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: widgetId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Widget details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Widget'
 */
router.get('/widgets/:widgetId', async (req, res) => {
  try {
    const { widgetId } = req.params;
    const id = parseInt(widgetId);
    // ADR-0012 Phase 8 (T-135214): when ?atom_id=N is supplied, deep-merge
    // the embedding atom's `settings_override` into widget.config so the
    // response carries the post-template-virtualization effective config.
    const atomIdRaw = req.query.atom_id;
    const atomId = atomIdRaw != null && atomIdRaw !== '' ? parseInt(atomIdRaw, 10) : null;
    const widget = atomId != null && Number.isFinite(atomId)
      ? await getEffectiveWidgetConfig(id, atomId)
      : await getWidgetById(id);

    if (!widget) {
      return notFound(res, 'Widget not found');
    }

    // ADR-0003 Phase 2 (T-127903): surface atom-ref count so UI can warn
    // before a delete.
    widget.atom_refs_count = await countAtomRefs(id);

    success(res, widget);
  } catch (err) {
    apiLogger.error('Error fetching widget:', err);
    error(res, err.message);
  }
});

/**
 * PATCH /api/v3/widgets/:widgetId
 * Update widget
 * @swagger
 * /api/v3/widgets/{widgetId}:
 *   patch:
 *     summary: Update widget
 *     tags: [Widgets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: widgetId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               config:
 *                 type: object
 *               position:
 *                 type: object
 *     responses:
 *       200:
 *         description: Widget updated
 */
router.patch('/widgets/:widgetId', async (req, res) => {
  try {
    const { widgetId } = req.params;
    const id = parseInt(widgetId);
    const updates = req.body || {};

    // ADR-0005 §C-11: rename guard. If `title` is changing AND the widget is
    // referenced by atoms (atom_refs_count > 0) AND no ?force=1, refuse —
    // a silent rename would orphan every embed's display label. Other field
    // updates (config/position/icon/...) bypass this check.
    const force = req.query.force === '1' || req.query.force === 'true';
    if (!force && Object.prototype.hasOwnProperty.call(updates, 'title')) {
      const current = await getWidgetById(id);
      if (!current) {
        return notFound(res, 'Widget not found');
      }
      const nextTitle = updates.title;
      const titleChanged = nextTitle != null && String(nextTitle) !== String(current.title ?? '');
      if (titleChanged) {
        const refs = await countAtomRefs(id);
        if (refs > 0) {
          return res.status(409).json({
            success: false,
            error: 'widget_in_use_rename',
            atom_refs_count: refs,
            hint: 'pass ?force=1 to override',
          });
        }
      }
    }

    const widget = await updateWidget(id, updates, req);

    success(res, widget);
  } catch (err) {
    apiLogger.error('Error updating widget:', err);

    if (err.message === 'Widget not found') {
      return notFound(res, 'Widget not found');
    }

    error(res, err.message);
  }
});

/**
 * DELETE /api/v3/widgets/:widgetId
 * Delete widget
 * @swagger
 * /api/v3/widgets/{widgetId}:
 *   delete:
 *     summary: Delete widget
 *     tags: [Widgets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: widgetId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Widget deleted
 *       404:
 *         description: Widget not found
 */
router.delete('/widgets/:widgetId', async (req, res) => {
  try {
    const { widgetId } = req.params;
    const id = parseInt(widgetId);
    // ?force=true            — force delete even if it's a module
    //                        — + ?reassign_to=<newId> to redirect atoms (ADR-0003 Phase 2)
    // ?orphan=true           — null out atom widget_refs, then delete
    const { force, reassign_to, orphan } = req.query;

    const widget = await getWidgetById(id);
    if (!widget) {
      return notFound(res, 'Widget not found');
    }

    const isForce = force === 'true';
    const isOrphan = orphan === 'true';
    const reassignTo = reassign_to != null && reassign_to !== '' ? parseInt(reassign_to) : null;

    if (isOrphan && reassignTo != null) {
      return badRequest(res, 'orphan and reassign_to are mutually exclusive');
    }

    try {
      await deleteWidget(id, {
        force: isForce,
        reassignTo,
        orphan: isOrphan,
        userId: req.user?.id ?? null,
      });
    } catch (err) {
      if (err.code === 'WIDGET_IN_USE') {
        return res.status(409).json({
          error: 'widget_in_use',
          atom_refs_count: err.atom_refs_count,
          sample: err.sample,
        });
      }
      if (err.message === 'reassign_to widget not found'
          || err.message === 'reassign_to cannot equal the widget being deleted'
          || err.message === 'orphan and reassign_to are mutually exclusive') {
        return badRequest(res, err.message);
      }
      throw err;
    }

    noContent(res);
  } catch (err) {
    apiLogger.error('Error deleting widget:', err);
    error(res, err.message);
  }
});

/**
 * PATCH /api/v3/widgets/:widgetId/code
 * Update custom widget code
 */
router.patch('/widgets/:widgetId/code', async (req, res) => {
  try {
    const { widgetId } = req.params;
    const { code } = req.body;

    if (!code) {
      return badRequest(res, 'code is required');
    }

    const widget = await updateWidgetCode(parseInt(widgetId), code);

    success(res, widget);
  } catch (err) {
    apiLogger.error('Error updating widget code:', err);

    if (err.message === 'Widget not found') {
      return notFound(res, 'Widget not found');
    }

    if (err.message.includes('Can only update code') || err.message.includes('cannot be empty')) {
      return badRequest(res, err.message);
    }

    error(res, err.message);
  }
});

/**
 * GET /api/v3/widgets/:widgetId/data
 * Get widget data
 */
router.get('/widgets/:widgetId/data', async (req, res) => {
  try {
    const { widgetId } = req.params;
    // ADR-0012 Phase 8 (T-135214): atom-aware data fetch — same merge as
    // GET /widgets/:id?atom_id=N, so post-virtualization templates resolve
    // their effective config (e.g. table_id) before rows are pulled.
    const atomIdRaw = req.query.atom_id;
    const atomId = atomIdRaw != null && atomIdRaw !== '' ? parseInt(atomIdRaw, 10) : null;
    const data = await getWidgetData(
      parseInt(widgetId),
      atomId != null && Number.isFinite(atomId) ? atomId : null
    );

    success(res, data);
  } catch (err) {
    apiLogger.error('Error fetching widget data:', err);

    if (err.message === 'Widget not found') {
      return notFound(res, 'Widget not found');
    }

    error(res, err.message);
  }
});

export default router;
