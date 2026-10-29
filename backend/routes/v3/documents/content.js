// Documents v4: Content retrieval and v4 import
import express from 'express';
import {
  dbAll, dbGet, dbRun, isPostgres, safeJsonParse,
  generateBaseId, apiLogger,
  success, created, error, badRequest, notFound,
  requireEditorAccess, ensureLanguageColumn,
} from './_helpers.js';
import { collectWidgetAtomInventory } from '../../../services/documents/widgetAtomInventory.js';
import { buildOrderClause } from '../../../services/orderClause.js';

const router = express.Router();

/** GET /api/v3/documents/:documentId/content */
router.get('/documents/:documentId/content', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { registry_table_id } = req.query;
    if (!registry_table_id) return badRequest(res, 'registry_table_id is required');

    const docRow = await dbGet(
      `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
      [documentId, registry_table_id]
    );
    if (!docRow) return notFound(res, 'Document not found');

    const docData = safeJsonParse(docRow.data, {});
    let tableId = docData.table_id;

    // Auto-discover content table by slug/title pattern when table_id is missing
    if (!tableId) {
      const title = docData.title || docData.name || '';
      const slugFull = title.toLowerCase()
        .replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '-')
        .replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 60);
      const slugShort = title.split(/[:—–]/)[0].trim().toLowerCase()
        .replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '-')
        .replace(/-+/g, '-').replace(/^-|-$/g, '');
      const candidates = [...new Set([slugShort, slugFull].filter(Boolean))];

      for (const slug of candidates) {
        const matchedTable = await dbGet(
          `SELECT id FROM universal_tables WHERE name LIKE ? LIMIT 1`,
          [`doc_${slug}%`]
        );
        if (matchedTable) {
          tableId = matchedTable.id;
          docData.table_id = tableId;
          const updateSql = isPostgres()
            ? `UPDATE table_rows SET data = $1 WHERE id = $2`
            : `UPDATE table_rows SET data = ? WHERE id = ?`;
          await dbRun(updateSql, [JSON.stringify(docData), documentId]);
          apiLogger.info(`[Documents v4] Auto-discovered content table ${tableId} for document ${documentId} (slug: ${slug})`);
          break;
        }
      }
      if (!tableId) return badRequest(res, 'Document has no associated table');
    }

    // NOTE: previously had a `ticket_ref` auto-migration block here. Removed
    // 2026-04-27 — column dropped from DOCUMENT_TABLE_COLUMNS factory; embed
    // tickets via widget_ref instead.

    // Get all rows from document table
    const contentOrderBy = buildOrderClause('order', {
      dialect: isPostgres() ? 'pg' : 'sqlite', mode: 'coalesce', tieBreak: 'id',
    });
    const rows = await dbAll(
      `SELECT id, base_id, data, created_at, updated_at FROM table_rows WHERE table_id = ? ORDER BY ${contentOrderBy}`,
      [tableId]
    );

    const items = rows.map(row => ({
      id: row.id, base_id: row.base_id,
      ...safeJsonParse(row.data, {}),
      created_at: row.created_at, updated_at: row.updated_at
    }));

    // Build hierarchical structure based on level (h1 → h2 → h3 → text)
    const buildTree = (items) => {
      const result = [];
      let currentH1 = null;
      let currentH2 = null;
      for (const item of items) {
        const node = { ...item, children: [] };
        switch (item.level) {
          case 'h1':
            result.push(node); currentH1 = node; currentH2 = null; break;
          case 'h2':
            if (currentH1) { currentH1.children.push(node); } else { result.push(node); }
            currentH2 = node; break;
          case 'h3': case 'text':
            if (currentH2) { currentH2.children.push(node); }
            else if (currentH1) { currentH1.children.push(node); }
            else { result.push(node); } break;
          case 'divider':
            if (currentH2) { currentH2.children.push(node); }
            else if (currentH1) { currentH1.children.push(node); }
            else { result.push(node); } break;
          default: result.push(node);
        }
      }
      return result;
    };

    // ADR-0005 §C-13 — surface a per-doc widget-atom inventory so the
    // client can render embedded-widget summaries (and locked-field
    // affordances) without a second round-trip. Lossless: deleted target
    // widgets/docs still appear with `missing: true`. Empty array when
    // the document has no widget-atoms.
    let widgetAtoms = [];
    try {
      widgetAtoms = await collectWidgetAtomInventory(items);
    } catch (invErr) {
      apiLogger.warn(
        { err: invErr.message, documentId },
        '[Documents v4] widget-atom inventory failed (non-fatal, returning empty)'
      );
      widgetAtoms = [];
    }

    success(res, {
      document: docData,
      table_id: tableId,
      items,
      tree: buildTree(items),
      count: items.length,
      widget_atoms: widgetAtoms,
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /documents/:documentId/content error:', err);
    error(res, 'FETCH_DOCUMENT_CONTENT_ERROR', err.message, 500);
  }
});

/** POST /api/v3/documents/:documentId/import-v4 */
router.post('/documents/:documentId/import-v4', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { registry_table_id, sections } = req.body;
    const userId = req.user?.id;
    if (!registry_table_id || !sections || !Array.isArray(sections)) {
      return badRequest(res, 'registry_table_id and sections array are required');
    }

    const importRegistryTable = await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [registry_table_id]);
    if (importRegistryTable?.project_id) {
      if (!(await requireEditorAccess(req, res, importRegistryTable.project_id))) return;
    }

    const docRow = await dbGet(
      `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
      [documentId, registry_table_id]
    );
    if (!docRow) return notFound(res, 'Document not found');

    const docData = safeJsonParse(docRow.data, {});
    const tableId = docData.table_id;
    if (!tableId) return badRequest(res, 'Document has no associated table');

    // Detect which languages are used and ensure columns exist
    const usedLanguages = new Set();
    for (const section of sections) {
      for (const key of Object.keys(section)) {
        const match = key.match(/^content_([a-z]{2})$/);
        if (match) usedLanguages.add(match[1]);
      }
      if (section.language && section.language !== 'en') usedLanguages.add(section.language);
    }
    usedLanguages.delete('en');
    for (const lang of usedLanguages) { await ensureLanguageColumn(tableId, lang); }

    // Insert sections into document table
    const createdIds = [];
    let orderIndex = 10;

    for (const section of sections) {
      const baseId = generateBaseId();
      const isHeader = ['h1', 'h2', 'h3'].includes(section.level);
      const contentValue = isHeader
        ? (section.title || section.content || '')
        : (section.content || '');
      const hasExplicitLangFields = Object.keys(section).some(k => /^content_[a-z]{2}$/.test(k));

      const sectionData = {
        order: section.order ?? orderIndex,
        level: section.level || 'text',
        comment: section.comment || '',
        type: section.type || 'reference',
        atom_ref: section.atom_ref || null,
        is_collapsed: section.is_collapsed || false
      };

      if (hasExplicitLangFields) {
        for (const key of Object.keys(section)) {
          if (key.match(/^content_[a-z]{2}$/)) sectionData[key] = section[key] || '';
        }
      } else {
        const targetLang = section.language || 'en';
        sectionData[`content_${targetLang}`] = contentValue;
      }

      // 2026-04-27: silent floor on `order` — fractional values broke
      // `ORDER BY (data->>'order')::integer` in content.js GET. Never throw —
      // priority is "document doesn't break".
      if (sectionData.order != null && Number.isFinite(Number(sectionData.order))) {
        sectionData.order = Math.floor(Number(sectionData.order));
      }

      const result = await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [tableId, baseId, JSON.stringify(sectionData), userId]
      );
      createdIds.push(result.lastInsertRowid);
      orderIndex += 10;
    }

    apiLogger.info(`[Documents v4] Imported ${createdIds.length} sections into document ${documentId}`);

    // ADR-0003 C-11: if this is the first content import (source_path still
    // null on the registry row), write the `_initial.md` snapshot and
    // persist source_path. Best-effort — never fail the import.
    let sourcePath = docData.source_path || null;
    if (!sourcePath) {
      try {
        const { widgetIdForRegistry } = await findWidgetForRegistry(registry_table_id);
        if (widgetIdForRegistry) {
          const { writeInitialSnapshot } = await import('../../../services/documents/SnapshotWriter.js');
          const snap = await writeInitialSnapshot({
            widgetId: widgetIdForRegistry,
            documentId,
            docSlug: docData.slug,
            title: docData.name || docData.title,
            registryTableId: Number(registry_table_id),
          });
          if (snap?.written) sourcePath = snap.relative_path;
        }
      } catch (snapErr) {
        apiLogger.warn({ err: snapErr.message, documentId }, '[SnapshotWriter] initial snapshot on import-v4 failed (non-fatal)');
      }
    }

    created(res, {
      document_id: documentId,
      created_ids: createdIds,
      count: createdIds.length,
      source_path: sourcePath,
    });
  } catch (err) {
    apiLogger.error({ err }, 'POST /documents/:documentId/import-v4 error:', err);
    error(res, 'IMPORT_DOCUMENT_ERROR', err.message, 500);
  }
});

/**
 * Look up which widget references a given registry_table_id. Documents
 * widgets store this in `config.registry_table_id` (or legacy
 * `documents_table_id`). Used by the snapshot hook because /import-v4
 * receives only the registry id.
 */
async function findWidgetForRegistry(registryTableId) {
  try {
    const rows = await dbAll(
      `SELECT id, config FROM widgets WHERE widget_type = 'documents' OR preset_name LIKE '%document%'`
    );
    const target = Number(registryTableId);
    for (const w of rows) {
      const cfg = typeof w.config === 'string' ? safeJsonParse(w.config, {}) : (w.config || {});
      const regId = Number(cfg.registry_table_id || cfg.documents_table_id || 0);
      if (regId === target) return { widgetIdForRegistry: w.id };
    }
    // Fallback: scan ALL widgets if preset filter missed
    const allRows = await dbAll('SELECT id, config FROM widgets');
    for (const w of allRows) {
      const cfg = typeof w.config === 'string' ? safeJsonParse(w.config, {}) : (w.config || {});
      const regId = Number(cfg.registry_table_id || cfg.documents_table_id || 0);
      if (regId === target) return { widgetIdForRegistry: w.id };
    }
  } catch (err) {
    apiLogger.warn({ err: err.message }, '[findWidgetForRegistry] lookup failed');
  }
  return { widgetIdForRegistry: null };
}

export default router;
