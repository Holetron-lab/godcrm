// Documents: Structure management — update, rebuild, setup-columns
import express from 'express';
import {
  dbAll, dbGet, dbRun, safeJsonParse,
  apiLogger,
  success, error, badRequest, notFound,
  requireEditorAccess,
} from './_helpers.js';

const router = express.Router();

/** PUT /api/v3/documents/:documentId/structure */
router.put('/documents/:documentId/structure', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { documents_table_id, structure } = req.body;
    if (!documents_table_id) return badRequest(res, 'documents_table_id is required');
    if (!structure || structure.version !== 2) return badRequest(res, 'Structure must have version 2');

    const structDocsTable = await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [documents_table_id]);
    if (structDocsTable?.project_id) {
      if (!(await requireEditorAccess(req, res, structDocsTable.project_id))) return;
    }

    const docRow = await dbGet('SELECT * FROM table_rows WHERE id = ? AND table_id = ?', [documentId, documents_table_id]);
    if (!docRow) return notFound(res, 'Document not found');

    const docData = safeJsonParse(docRow.data, {});
    docData.structure = JSON.stringify(structure);
    await dbRun('UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(docData), documentId]);

    apiLogger.info(`[Documents] Updated structure for document ${documentId}`);
    success(res, { structure });
  } catch (err) {
    apiLogger.error({ err }, 'PUT /documents/:id/structure error:', err);
    error(res, 'UPDATE_STRUCTURE_ERROR', err.message, 500);
  }
});

/** POST /api/v3/documents/:documentId/rebuild-structure */
router.post('/documents/:documentId/rebuild-structure', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { documents_table_id, sections_table_id } = req.body;
    if (!documents_table_id || !sections_table_id) return badRequest(res, 'documents_table_id and sections_table_id are required');

    const rebuildDocsTable = await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [documents_table_id]);
    if (rebuildDocsTable?.project_id) {
      if (!(await requireEditorAccess(req, res, rebuildDocsTable.project_id))) return;
    }

    const docRow = await dbGet('SELECT * FROM table_rows WHERE id = ? AND table_id = ?', [documentId, documents_table_id]);
    if (!docRow) return notFound(res, 'Document not found');

    const docData = safeJsonParse(docRow.data, {});

    // Parse sections array
    let sectionIds = [];
    if (typeof docData.sections === 'string') { try { sectionIds = JSON.parse(docData.sections); } catch { sectionIds = []; } }
    else if (Array.isArray(docData.sections)) { sectionIds = docData.sections; }

    // Fetch all sections
    const sections = [];
    for (const sectionId of sectionIds) {
      const numId = typeof sectionId === 'string' ? parseInt(sectionId, 10) : sectionId;
      if (isNaN(numId)) continue;
      const sectionRow = await dbGet('SELECT * FROM table_rows WHERE id = ? AND table_id = ?', [numId, sections_table_id]);
      if (sectionRow) sections.push({ id: sectionRow.id, ...safeJsonParse(sectionRow.data, {}) });
    }

    // Build hierarchy
    const h2Sections = sections
      .filter(s => (s.h2 && !s.h3) || (!s.h2 && !s.h3 && !s.parent))
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    const sectionChildren = new Map();
    for (const section of sections) {
      if (section.parent) {
        const parentId = typeof section.parent === 'number' ? section.parent :
                        Array.isArray(section.parent) ? section.parent[0] : parseInt(section.parent, 10);
        if (!sectionChildren.has(parentId)) sectionChildren.set(parentId, []);
        sectionChildren.get(parentId).push(section);
      }
    }
    for (const [, children] of sectionChildren) {
      children.sort((a, b) => (a.local_order || a.order_index || 0) - (b.local_order || b.order_index || 0));
    }

    const structure = {
      version: 2,
      title: docData.name || '',
      description: docData.description || '',
      sections: h2Sections.map((h2, index) => ({
        id: h2.id, order: index + 1,
        children: (sectionChildren.get(h2.id) || []).map(c => c.id),
        footer: null, collapsed: false
      })),
      footer: null, links: []
    };

    // Preserve existing footer/links from old structure
    if (docData.structure) {
      try {
        const oldStructure = typeof docData.structure === 'string' ? JSON.parse(docData.structure) : docData.structure;
        if (oldStructure.footer) structure.footer = oldStructure.footer;
        if (oldStructure.links) structure.links = oldStructure.links;
        if (oldStructure.sections) {
          for (const oldSection of oldStructure.sections) {
            const newSection = structure.sections.find(s => s.id === oldSection.id);
            if (newSection && oldSection.footer) newSection.footer = oldSection.footer;
            if (newSection && oldSection.collapsed) newSection.collapsed = oldSection.collapsed;
          }
        }
      } catch (e) { /* Ignore parse errors */ }
    }

    docData.structure = JSON.stringify(structure);
    await dbRun('UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(docData), documentId]);

    apiLogger.info(`[Documents] Rebuilt structure for document ${documentId}: ${h2Sections.length} H2 sections`);
    success(res, { structure });
  } catch (err) {
    apiLogger.error({ err }, 'POST /documents/:id/rebuild-structure error:', err);
    error(res, 'REBUILD_STRUCTURE_ERROR', err.message, 500);
  }
});

/** POST /api/v3/documents/setup-columns */
router.post('/documents/setup-columns', async (req, res) => {
  try {
    const { sections_table_id } = req.body;
    if (!sections_table_id) return badRequest(res, 'sections_table_id is required');

    const existingColumns = await dbAll('SELECT column_name FROM table_columns WHERE table_id = ?', [sections_table_id]);
    const columnNames = existingColumns.map(c => c.column_name);
    const columnsToAdd = [];

    const maxOrder = await dbGet('SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?', [sections_table_id]);
    let nextOrder = (maxOrder?.max_order || 0) + 1;

    if (!columnNames.includes('h2_order')) {
      columnsToAdd.push({
        column_name: 'h2_order', display_name: 'H2 Order', type: 'number', order_index: nextOrder++,
        config: JSON.stringify({ description: 'Order of parent H2 section (for sorting)', default: 0 })
      });
    }
    if (!columnNames.includes('h3_order')) {
      columnsToAdd.push({
        column_name: 'h3_order', display_name: 'H3 Order', type: 'number', order_index: nextOrder++,
        config: JSON.stringify({ description: 'Order within H2 (0 for H2 itself)', default: 0 })
      });
    }

    for (const col of columnsToAdd) {
      await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config) VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [sections_table_id, col.column_name, col.display_name, col.type, col.order_index, col.config]
      );
    }

    apiLogger.info(`[Documents] Added ${columnsToAdd.length} sorting columns to table ${sections_table_id}`);
    success(res, {
      added_columns: columnsToAdd.map(c => c.column_name),
      message: columnsToAdd.length > 0
        ? `Added columns: ${columnsToAdd.map(c => c.column_name).join(', ')}`
        : 'All columns already exist'
    });
  } catch (err) {
    apiLogger.error({ err }, 'POST /documents/setup-columns error:', err);
    error(res, 'SETUP_COLUMNS_ERROR', err.message, 500);
  }
});

export default router;
