// Documents: ADR-038 Task binding endpoints
import express from 'express';
import { dbAll, dbGet, dbRun, isPostgres, safeJsonParse } from '../../../database/connection.js';
import { generateBaseId } from '../../../utils/baseId.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, error, badRequest, notFound } from '../../../utils/response.js';
import { requireEditorAccess } from './_helpers.js';
import { buildOrderClause } from '../../../services/orderClause.js';

const router = express.Router();

/**
 * POST /projects/:projectId/documents/:docId/items/:itemId/link-task
 * Link an existing task to a document item
 */
router.post('/projects/:projectId/documents/:docId/items/:itemId/link-task', async (req, res) => {
  try {
    const { projectId, docId, itemId } = req.params;
    const { task_id } = req.body;
    if (!(await requireEditorAccess(req, res, projectId))) return;
    if (!task_id) return badRequest(res, 'MISSING_TASK_ID', 'task_id is required');

    apiLogger.debug({ projectId, docId, itemId, task_id }, '[Documents] Linking task to document item');

    const registryResult = await dbGet(`
      SELECT t.id as table_id, t.name FROM tables t
      JOIN table_rows reg ON reg.table_id = (
        SELECT id FROM tables WHERE name = '_registry' AND project_id = ?
      ) WHERE t.id = (
        SELECT json_extract(reg.data, '$.table_id') FROM table_rows reg WHERE reg.id = ?
      )
    `, [projectId, docId]);
    if (!registryResult) return notFound(res, 'DOCUMENT_NOT_FOUND', 'Document not found');

    const item = await dbGet(`SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`, [itemId, registryResult.table_id]);
    if (!item) return notFound(res, 'ITEM_NOT_FOUND', 'Document item not found');

    const itemData = safeJsonParse(item.data, {});
    const previousTaskRef = itemData.task_ref || null;
    itemData.task_ref = parseInt(task_id, 10);

    await dbRun(`
      UPDATE table_rows SET data = ?, updated_at = ${isPostgres ? 'NOW()' : 'datetime("now")'} WHERE id = ?
    `, [JSON.stringify(itemData), itemId]);

    apiLogger.info({ itemId, task_id, previousTaskRef }, '[Documents] Task linked to document item');
    success(res, { item_id: parseInt(itemId, 10), task_ref: itemData.task_ref, previous_task_ref: previousTaskRef });
  } catch (err) {
    apiLogger.error({ err }, 'POST /documents/:docId/items/:itemId/link-task error');
    error(res, 'LINK_TASK_ERROR', err.message, 500);
  }
});

/**
 * POST /projects/:projectId/documents/:docId/items/:itemId/create-task
 * Create a new task from document item and link it
 */
router.post('/projects/:projectId/documents/:docId/items/:itemId/create-task', async (req, res) => {
  try {
    const { projectId, docId, itemId } = req.params;
    const { table_id, data } = req.body;
    if (!(await requireEditorAccess(req, res, projectId))) return;
    if (!table_id) return badRequest(res, 'MISSING_TABLE_ID', 'table_id is required');
    if (!data?.title) return badRequest(res, 'MISSING_TITLE', 'data.title is required');

    apiLogger.debug({ projectId, docId, itemId, table_id }, '[Documents] Creating task from document item');

    const docTable = await dbGet(`
      SELECT t.id as table_id FROM table_rows reg
      JOIN tables t ON t.id = (SELECT json_extract(reg.data, '$.table_id') FROM table_rows WHERE id = reg.id)
      WHERE reg.id = ?
    `, [docId]);
    if (!docTable) return notFound(res, 'DOCUMENT_NOT_FOUND', 'Document not found');

    const docItem = await dbGet(`SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`, [itemId, docTable.table_id]);
    if (!docItem) return notFound(res, 'ITEM_NOT_FOUND', 'Document item not found');

    const base_id = generateBaseId();
    const taskData = {
      title: data.title, description: data.description || '',
      status: data.status || 'todo', due_date: data.due_date || null,
      priority: data.priority || 'medium', progress: 0,
      source_document_id: parseInt(docId, 10), source_item_id: parseInt(itemId, 10)
    };

    const insertResult = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
      VALUES (?, ?, ?, ${isPostgres ? 'NOW(), NOW()' : 'datetime("now"), datetime("now")'})
    `, [table_id, base_id, JSON.stringify(taskData)]);
    const taskId = insertResult.lastID || insertResult.id;

    const itemData = safeJsonParse(docItem.data, {});
    itemData.task_ref = taskId;
    await dbRun(`
      UPDATE table_rows SET data = ?, updated_at = ${isPostgres ? 'NOW()' : 'datetime("now")'} WHERE id = ?
    `, [JSON.stringify(itemData), itemId]);

    apiLogger.info({ itemId, taskId, table_id }, '[Documents] Task created from document item');
    created(res, { task_id: taskId, item_id: parseInt(itemId, 10), task_ref: taskId, base_id });
  } catch (err) {
    apiLogger.error({ err }, 'POST /documents/:docId/items/:itemId/create-task error');
    error(res, 'CREATE_TASK_ERROR', err.message, 500);
  }
});

/**
 * DELETE /projects/:projectId/documents/:docId/items/:itemId/unlink-task
 * Remove task reference from document item (does NOT delete the task)
 */
router.delete('/projects/:projectId/documents/:docId/items/:itemId/unlink-task', async (req, res) => {
  try {
    const { projectId, docId, itemId } = req.params;
    if (!(await requireEditorAccess(req, res, projectId))) return;

    const docTable = await dbGet(`
      SELECT t.id as table_id FROM table_rows reg
      JOIN tables t ON t.id = (SELECT json_extract(reg.data, '$.table_id') FROM table_rows WHERE id = reg.id)
      WHERE reg.id = ?
    `, [docId]);
    if (!docTable) return notFound(res, 'DOCUMENT_NOT_FOUND', 'Document not found');

    const item = await dbGet(`SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`, [itemId, docTable.table_id]);
    if (!item) return notFound(res, 'ITEM_NOT_FOUND', 'Document item not found');

    const itemData = safeJsonParse(item.data, {});
    const previousTaskRef = itemData.task_ref || null;
    if (!previousTaskRef) return badRequest(res, 'NOT_LINKED', 'Item is not linked to any task');

    itemData.task_ref = null;
    await dbRun(`
      UPDATE table_rows SET data = ?, updated_at = ${isPostgres ? 'NOW()' : 'datetime("now")'} WHERE id = ?
    `, [JSON.stringify(itemData), itemId]);

    apiLogger.info({ itemId, previousTaskRef }, '[Documents] Task unlinked from document item');
    success(res, { item_id: parseInt(itemId, 10), previous_task_ref: previousTaskRef });
  } catch (err) {
    apiLogger.error({ err }, 'DELETE /documents/:docId/items/:itemId/unlink-task error');
    error(res, 'UNLINK_TASK_ERROR', err.message, 500);
  }
});

/**
 * POST /projects/:projectId/documents/:docId/export-tasks
 * Bulk export document items to tasks
 */
router.post('/projects/:projectId/documents/:docId/export-tasks', async (req, res) => {
  try {
    const { projectId, docId } = req.params;
    const { table_id, item_ids, options = {} } = req.body;
    if (!(await requireEditorAccess(req, res, projectId))) return;
    if (!table_id) return badRequest(res, 'MISSING_TABLE_ID', 'table_id is required');
    if (!item_ids || !Array.isArray(item_ids) || item_ids.length === 0) return badRequest(res, 'MISSING_ITEM_IDS', 'item_ids array is required');

    const { include_content = true, default_status = 'todo', default_priority = 'medium', skip_linked = true } = options;

    const docTable = await dbGet(`
      SELECT t.id as table_id FROM table_rows reg
      JOIN tables t ON t.id = (SELECT json_extract(reg.data, '$.table_id') FROM table_rows WHERE id = reg.id)
      WHERE reg.id = ?
    `, [docId]);
    if (!docTable) return notFound(res, 'DOCUMENT_NOT_FOUND', 'Document not found');

    const placeholders = item_ids.map(() => '?').join(',');
    const items = await dbAll(`
      SELECT id, data FROM table_rows WHERE id IN (${placeholders}) AND table_id = ?
    `, [...item_ids, docTable.table_id]);

    const results = { created: [], skipped: [], errors: [] };

    for (const item of items) {
      const itemData = safeJsonParse(item.data, {});
      if (skip_linked && itemData.task_ref) {
        results.skipped.push({ item_id: item.id, reason: 'already_linked', task_ref: itemData.task_ref });
        continue;
      }
      try {
        let title = itemData.content_en || itemData.content || '';
        title = title.replace(/^#+\s*/, '').trim();
        if (!title) { results.errors.push({ item_id: item.id, reason: 'empty_title' }); continue; }

        const base_id = generateBaseId();
        const taskData = {
          title, description: include_content ? (itemData.content_en || itemData.content || '') : '',
          status: default_status, priority: default_priority, progress: 0,
          source_document_id: parseInt(docId, 10), source_item_id: item.id
        };
        const insertResult = await dbRun(`
          INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
          VALUES (?, ?, ?, ${isPostgres ? 'NOW(), NOW()' : 'datetime("now"), datetime("now")'})
        `, [table_id, base_id, JSON.stringify(taskData)]);
        const taskId = insertResult.lastID || insertResult.id;

        itemData.task_ref = taskId;
        await dbRun(`
          UPDATE table_rows SET data = ?, updated_at = ${isPostgres ? 'NOW()' : 'datetime("now")'} WHERE id = ?
        `, [JSON.stringify(itemData), item.id]);

        results.created.push({ item_id: item.id, task_id: taskId, title });
      } catch (itemErr) {
        apiLogger.error({ err: itemErr, itemId: item.id }, '[Documents] Error creating task for item');
        results.errors.push({ item_id: item.id, reason: itemErr.message });
      }
    }

    apiLogger.info({ docId, created: results.created.length, skipped: results.skipped.length, errors: results.errors.length }, '[Documents] Bulk export completed');
    success(res, {
      created_count: results.created.length, skipped_count: results.skipped.length, error_count: results.errors.length,
      created: results.created, skipped: results.skipped, errors: results.errors
    });
  } catch (err) {
    apiLogger.error({ err }, 'POST /documents/:docId/export-tasks error');
    error(res, 'EXPORT_TASKS_ERROR', err.message, 500);
  }
});

/**
 * GET /projects/:projectId/documents/:docId/items/with-tasks
 * Get document items enriched with linked task data
 */
router.get('/projects/:projectId/documents/:docId/items/with-tasks', async (req, res) => {
  try {
    const { projectId, docId } = req.params;
    const { task_table_id } = req.query;

    const docTable = await dbGet(`
      SELECT t.id as table_id FROM table_rows reg
      JOIN tables t ON t.id = (SELECT json_extract(reg.data, '$.table_id') FROM table_rows WHERE id = reg.id)
      WHERE reg.id = ?
    `, [docId]);
    if (!docTable) return notFound(res, 'DOCUMENT_NOT_FOUND', 'Document not found');

    const items = await dbAll(`
      SELECT id, data FROM table_rows WHERE table_id = ?
      ORDER BY ${buildOrderClause('order', { dialect: isPostgres() ? 'pg' : 'sqlite', mode: 'coalesce', coalesce: false, tieBreak: null })}
    `, [docTable.table_id]);

    const taskRefs = items.map(item => safeJsonParse(item.data, {}).task_ref).filter(Boolean);
    let tasksMap = {};
    if (taskRefs.length > 0 && task_table_id) {
      const placeholders = taskRefs.map(() => '?').join(',');
      const tasks = await dbAll(`SELECT id, data FROM table_rows WHERE id IN (${placeholders}) AND table_id = ?`, [...taskRefs, task_table_id]);
      tasksMap = tasks.reduce((acc, task) => { acc[task.id] = { id: task.id, ...safeJsonParse(task.data, {}) }; return acc; }, {});
    }

    const enrichedItems = items.map(item => {
      const itemData = safeJsonParse(item.data, {});
      return { id: item.id, ...itemData, linked_task: itemData.task_ref && tasksMap[itemData.task_ref] ? tasksMap[itemData.task_ref] : null };
    });

    success(res, {
      document_id: parseInt(docId, 10), table_id: docTable.table_id,
      items: enrichedItems, count: enrichedItems.length,
      linked_count: enrichedItems.filter(i => i.linked_task).length
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /documents/:docId/items/with-tasks error');
    error(res, 'GET_ITEMS_WITH_TASKS_ERROR', err.message, 500);
  }
});

export default router;
