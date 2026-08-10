// Documents v4: Folder init, list documents, create document, delete document
import express from 'express';
import {
  dbAll, dbGet, dbRun, isPostgres, safeJsonParse,
  generateBaseId, apiLogger,
  success, created, error, badRequest, notFound,
  requireEditorAccess, slugify,
  createTableColumns, REGISTRY_COLUMNS, ATOMS_COLUMNS, DOCUMENT_TABLE_COLUMNS,
} from './_helpers.js';

const router = express.Router();

// ADR-0003 §C-1: resolve logical BDD tables (space 11) by name with per-process cache.
// Used by create/delete hooks to keep symmetry without hardcoding table ids.
const BDD_SPACE_ID = 11;
const bddTableIdCache = new Map();
async function resolveBddTableId(name) {
  if (bddTableIdCache.has(name)) return bddTableIdCache.get(name);
  const row = await dbGet(
    `SELECT ut.id FROM universal_tables ut
     JOIN projects p ON p.id = ut.project_id
     WHERE p.space_id = ? AND ut.name = ? LIMIT 1`,
    [BDD_SPACE_ID, name]
  );
  const id = row?.id || null;
  if (id) bddTableIdCache.set(name, id);
  return id;
}

/** POST /api/v3/projects/:projectId/documents/init */
router.post('/projects/:projectId/documents/init', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { folder_path = 'databases/documents/' } = req.body;
    const userId = req.user?.id;
    if (!(await requireEditorAccess(req, res, projectId))) return;

    const project = await dbGet('SELECT id, name FROM projects WHERE id = ?', [projectId]);
    if (!project) return notFound(res, 'Project not found');

    const existingRegistry = await dbGet(
      `SELECT id FROM universal_tables WHERE project_id = ? AND name = '_registry' AND folder_path LIKE ?`,
      [projectId, `%${folder_path}%`]
    );
    if (existingRegistry) {
      const existingAtoms = await dbGet(
        `SELECT id FROM universal_tables WHERE project_id = ? AND name = '_atoms' AND folder_path LIKE ?`,
        [projectId, `%${folder_path}%`]
      );
      return success(res, {
        registry_table_id: existingRegistry.id,
        atoms_table_id: existingAtoms?.id,
        folder_path,
        already_exists: true
      });
    }

    const registryBaseId = generateBaseId();
    const registryResult = await dbRun(
      `INSERT INTO universal_tables (project_id, name, display_name, table_type, folder_path, base_id, created_by)
       VALUES (?, '_registry', 'Реестр документов', 'documents_registry', ?, ?, ?)`,
      [projectId, folder_path, registryBaseId, userId]
    );
    const registryTableId = registryResult.lastInsertRowid;

    const atomsBaseId = generateBaseId();
    const atomsResult = await dbRun(
      `INSERT INTO universal_tables (project_id, name, display_name, table_type, folder_path, base_id, created_by)
       VALUES (?, '_atoms', 'База атомов', 'documents_atoms', ?, ?, ?)`,
      [projectId, folder_path, atomsBaseId, userId]
    );
    const atomsTableId = atomsResult.lastInsertRowid;

    await createTableColumns(registryTableId, REGISTRY_COLUMNS, null, projectId);
    await createTableColumns(atomsTableId, ATOMS_COLUMNS);
    await dbRun(
      `UPDATE table_columns SET config = ? WHERE table_id = ? AND column_name = 'document_ids'`,
      [JSON.stringify({ relation_table: registryTableId }), atomsTableId]
    );

    apiLogger.info(`[Documents v4] Initialized folder ${folder_path} for project ${projectId}: registry=${registryTableId}, atoms=${atomsTableId}`);
    created(res, { registry_table_id: registryTableId, atoms_table_id: atomsTableId, folder_path });
  } catch (err) {
    apiLogger.error({ err }, 'POST /projects/:projectId/documents/init error:', err);
    error(res, 'INIT_DOCUMENTS_ERROR', err.message, 500);
  }
});

/** GET /api/v3/projects/:projectId/documents */
router.get('/projects/:projectId/documents', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { folder_path = 'databases/documents/', page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const registry = await dbGet(
      `SELECT id FROM universal_tables WHERE project_id = ? AND name = '_registry' AND folder_path LIKE ?`,
      [projectId, `%${folder_path}%`]
    );
    if (!registry) return success(res, { documents: [], not_initialized: true });

    const atoms = await dbGet(
      `SELECT id FROM universal_tables WHERE project_id = ? AND name = '_atoms' AND folder_path LIKE ?`,
      [projectId, `%${folder_path}%`]
    );

    const orderBy = isPostgres()
      ? `COALESCE((data->>'order_index')::integer, 0), created_at`
      : `CAST(json_extract(data, '$.order_index') AS INTEGER), created_at`;
    const rows = await dbAll(
      `SELECT id, base_id, data, created_at, updated_at FROM table_rows WHERE table_id = ? ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [registry.id, Number(limit), offset]
    );

    const countResult = await dbGet(
      `SELECT COUNT(*) as total FROM table_rows WHERE table_id = ?`,
      [registry.id]
    );
    const total = countResult?.total || 0;

    const documents = rows.map(row => ({
      id: row.id, base_id: row.base_id,
      ...safeJsonParse(row.data, {}),
      created_at: row.created_at, updated_at: row.updated_at
    }));

    success(res, {
      documents,
      registry_table_id: registry.id,
      atoms_table_id: atoms?.id || null,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /projects/:projectId/documents error:', err);
    error(res, 'FETCH_DOCUMENTS_ERROR', err.message, 500);
  }
});

/** POST /api/v3/projects/:projectId/documents */
router.post('/projects/:projectId/documents', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, slug, description, icon, category, folder_path = 'databases/documents/', registry_table_id } = req.body;
    const userId = req.user?.id;

    // ADR-0003 C-1: registry provenance — title / created_by / created_at non-null.
    // created_at is set by DB default; validate the other two here.
    const rejected_fields = [];
    if (!name || typeof name !== 'string' || name.trim() === '') rejected_fields.push('name');
    if (!userId) rejected_fields.push('created_by');
    if (rejected_fields.length > 0) {
      return error(res, 'VALIDATION_ERROR', 'Registry provenance required (ADR-0003 C-1)', 400, { rejected_fields });
    }

    // ADR-0154 (widget_id-first): when the widget is bound to a custom registry — e.g. a
    // public-space _registry that doesn't match the project's default folder — the client
    // passes registry_table_id explicitly. Honor it as the registry directly and derive
    // project_id / folder_path / _atoms from that row (symmetry with the DELETE handler).
    // When absent, fall back to the legacy project_id + folder_path resolution unchanged.
    let registry, atoms, effectiveProjectId, effectiveFolderPath;
    if (registry_table_id) {
      const registryTable = await dbGet(
        `SELECT id, project_id, folder_path FROM universal_tables WHERE id = ? AND name = '_registry'`,
        [registry_table_id]
      );
      if (!registryTable) return badRequest(res, 'registry_table_id does not resolve to a documents registry');
      registry = { id: registryTable.id };
      effectiveProjectId = registryTable.project_id;
      effectiveFolderPath = registryTable.folder_path || folder_path;
      atoms = await dbGet(
        `SELECT id FROM universal_tables WHERE project_id = ? AND name = '_atoms' AND folder_path LIKE ?`,
        [effectiveProjectId, `%${effectiveFolderPath}%`]
      );
    } else {
      effectiveProjectId = projectId;
      effectiveFolderPath = folder_path;
      registry = await dbGet(
        `SELECT id FROM universal_tables WHERE project_id = ? AND name = '_registry' AND folder_path LIKE ?`,
        [projectId, `%${folder_path}%`]
      );
      atoms = await dbGet(
        `SELECT id FROM universal_tables WHERE project_id = ? AND name = '_atoms' AND folder_path LIKE ?`,
        [projectId, `%${folder_path}%`]
      );
      if (!registry) return badRequest(res, 'Documents folder not initialized. Call /documents/init first.');
    }

    // Authorize against the effective registry owner (mirrors DELETE), after registry resolution.
    if (!(await requireEditorAccess(req, res, effectiveProjectId))) return;

    const docSlug = slug || slugify(name);
    const slugQuery = isPostgres()
      ? `SELECT id FROM table_rows WHERE table_id = $1 AND data->>'slug' = $2`
      : `SELECT id FROM table_rows WHERE table_id = ? AND json_extract(data, '$.slug') = ?`;
    const existingDoc = await dbGet(slugQuery, [registry.id, docSlug]);
    if (existingDoc) return badRequest(res, `Document with slug "${docSlug}" already exists`);

    // Resolve default status from registry table column config (#56160)
    let defaultStatus = 'draft';
    try {
      const statusCol = await dbGet(
        `SELECT config FROM table_columns WHERE table_id = ? AND column_name = 'status'`,
        [registry.id]
      );
      if (statusCol?.config) {
        const parsed = typeof statusCol.config === 'string' ? JSON.parse(statusCol.config) : statusCol.config;
        if (parsed?.options?.length > 0) {
          const firstOpt = parsed.options[0];
          defaultStatus = typeof firstOpt === 'string' ? firstOpt : (firstOpt?.value || 'draft');
        }
      }
    } catch (e) { /* Fallback to 'draft' */ }

    const registryBaseId = generateBaseId();
    const initialRegistryData = {
      name, description: description || '', slug: docSlug,
      table_id: null, icon: icon || '📄',
      category: category || null, status: defaultStatus, order_index: 0
    };

    const registryResult = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
      [registry.id, registryBaseId, JSON.stringify(initialRegistryData), userId]
    );
    const documentId = registryResult.lastInsertRowid;

    const tableName = `doc_${docSlug}_${documentId}`;
    const docTableBaseId = generateBaseId();
    const docTableResult = await dbRun(
      `INSERT INTO universal_tables (project_id, name, display_name, table_type, folder_path, base_id, created_by)
       VALUES (?, ?, ?, 'document_content', ?, ?, ?)`,
      [effectiveProjectId, tableName, name, effectiveFolderPath, docTableBaseId, userId]
    );
    const docTableId = docTableResult.lastInsertRowid;

    await createTableColumns(docTableId, DOCUMENT_TABLE_COLUMNS, atoms?.id);
    const registryData = { ...initialRegistryData, table_id: docTableId };
    await dbRun(`UPDATE table_rows SET data = ? WHERE id = ?`, [JSON.stringify(registryData), documentId]);

    apiLogger.info(`[Documents v4] Created document "${name}" (${tableName}): registry_id=${documentId}, table_id=${docTableId}`);

    // ADR-0003 C-1: auto-create empty bdd_spec when document lives in a bdd_enabled widget.
    try {
      const widget = await dbGet(
        `SELECT id, config FROM widgets WHERE (config::jsonb->>'registry_table_id') = ? OR (config::jsonb->>'documents_table_id') = ?`,
        [String(registry.id), String(registry.id)]
      );
      if (widget) {
        const cfg = typeof widget.config === 'string' ? safeJsonParse(widget.config, {}) : (widget.config || {});
        if (cfg?.bdd_enabled === true) {
          const specsTableId = await resolveBddTableId('bdd_specs');
          if (specsTableId) {
            const specBaseId = `bdd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            const specData = {
              source_doc_id: documentId,
              code: name,
              owner_user_id: userId || null,
              status: 'draft',
            };
            await dbRun(
              `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
              [specsTableId, specBaseId, JSON.stringify(specData), userId || null]
            );
            apiLogger.info(`[Documents v4] Auto-created bdd_spec for doc ${documentId} (widget ${widget.id})`);
          } else {
            apiLogger.warn({ documentId }, '[Documents v4] bdd_enabled widget but bdd_specs table not bootstrapped');
          }
        }
      }
    } catch (specErr) {
      apiLogger.warn({ err: specErr.message, documentId }, '[Documents v4] auto-create bdd_spec failed (non-fatal)');
    }

    created(res, { document_id: documentId, table_id: docTableId, slug: docSlug, name });
  } catch (err) {
    apiLogger.error({ err }, 'POST /projects/:projectId/documents error:', err);
    error(res, 'CREATE_DOCUMENT_ERROR', err.message, 500);
  }
});

/** DELETE /api/v3/documents/:documentId */
router.delete('/documents/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { registryTableId, deleteTable = true, reason = null } = req.body;
    if (!registryTableId) return badRequest(res, 'registryTableId is required');

    const registryTable = await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [registryTableId]);
    if (registryTable?.project_id) {
      if (!(await requireEditorAccess(req, res, registryTable.project_id))) return;
    }

    const docRow = await dbGet(
      `SELECT id, data FROM table_rows WHERE table_id = ? AND id = ?`,
      [registryTableId, documentId]
    );
    if (!docRow) return notFound(res, 'Document not found in registry');

    const docData = safeJsonParse(docRow.data, {});
    const tableId = docData.table_id;

    // ADR-0003 C-13: capture final markdown + resolve widget BEFORE drop.
    let finalMarkdown = '';
    let widgetIdForSnap = null;
    try {
      const { loadDocumentAtoms, atomsToMarkdown } = await import('../../../services/documents/renderMarkdown.js');
      if (tableId) {
        const atoms = await loadDocumentAtoms(tableId);
        finalMarkdown = atomsToMarkdown(atoms);
      }
      const allWidgets = await dbAll('SELECT id, config FROM widgets');
      const target = Number(registryTableId);
      for (const w of allWidgets) {
        const cfg = typeof w.config === 'string' ? safeJsonParse(w.config, {}) : (w.config || {});
        const regId = Number(cfg.registry_table_id || cfg.documents_table_id || 0);
        if (regId === target) { widgetIdForSnap = w.id; break; }
      }
    } catch (snapPrepErr) {
      apiLogger.warn({ err: snapPrepErr.message, documentId }, '[SnapshotWriter] pre-delete capture failed (non-fatal)');
    }

    if (deleteTable && tableId) {
      await dbRun(`DELETE FROM table_rows WHERE table_id = ?`, [tableId]);
      await dbRun(`DELETE FROM table_columns WHERE table_id = ?`, [tableId]);
      await dbRun(`DELETE FROM universal_tables WHERE id = ?`, [tableId]);
    }

    await dbRun(`DELETE FROM table_rows WHERE table_id = ? AND id = ?`, [registryTableId, documentId]);

    // ADR-0003 §C-1: cascade-cleanup orphan BDD rows (spec → criteria → tests → runs).
    // Symmetry with the create hook: auto-created specs get torn down with their document.
    try {
      const specsTableId = await resolveBddTableId('bdd_specs');
      if (specsTableId) {
        const specRows = await dbAll(
          `SELECT id FROM table_rows WHERE table_id = ? AND data->>'source_doc_id' = ?`,
          [specsTableId, String(documentId)]
        );
        if (specRows.length > 0) {
          const specIdsStr = specRows.map(r => String(r.id));
          const specIdsNum = specRows.map(r => Number(r.id));
          const critTableId  = await resolveBddTableId('bdd_criteria');
          const testsTableId = await resolveBddTableId('bdd_tests');
          const runsTableId  = await resolveBddTableId('bdd_test_runs');

          let critIdsStr = [], critIdsNum = [], testIdsStr = [], testIdsNum = [];
          if (critTableId) {
            const critRows = await dbAll(
              `SELECT id FROM table_rows WHERE table_id = ? AND data->>'spec_id' = ANY(?::text[])`,
              [critTableId, specIdsStr]
            );
            critIdsStr = critRows.map(r => String(r.id));
            critIdsNum = critRows.map(r => Number(r.id));
          }
          if (testsTableId && critIdsStr.length > 0) {
            const testRows = await dbAll(
              `SELECT id FROM table_rows WHERE table_id = ? AND data->>'criterion_id' = ANY(?::text[])`,
              [testsTableId, critIdsStr]
            );
            testIdsStr = testRows.map(r => String(r.id));
            testIdsNum = testRows.map(r => Number(r.id));
          }
          if (runsTableId && testIdsStr.length > 0) {
            await dbRun(
              `DELETE FROM table_rows WHERE table_id = ? AND data->>'test_id' = ANY(?::text[])`,
              [runsTableId, testIdsStr]
            );
          }
          if (testsTableId && testIdsNum.length > 0) {
            await dbRun(
              `DELETE FROM table_rows WHERE table_id = ? AND id = ANY(?::bigint[])`,
              [testsTableId, testIdsNum]
            );
          }
          if (critTableId && critIdsNum.length > 0) {
            await dbRun(
              `DELETE FROM table_rows WHERE table_id = ? AND id = ANY(?::bigint[])`,
              [critTableId, critIdsNum]
            );
          }
          await dbRun(
            `DELETE FROM table_rows WHERE table_id = ? AND id = ANY(?::bigint[])`,
            [specsTableId, specIdsNum]
          );
          apiLogger.info(
            `[Documents v4] BDD cascade cleanup for doc ${documentId}: specs=${specIdsNum.length} criteria=${critIdsNum.length} tests=${testIdsNum.length}`
          );
        }
      }
    } catch (bddErr) {
      apiLogger.warn({ err: bddErr.message, documentId }, '[Documents v4] BDD cascade cleanup failed (non-fatal)');
    }

    // ADR-0003 C-13: write *_deleted.md + _archive.json. Non-fatal.
    let archiveInfo = null;
    if (widgetIdForSnap) {
      try {
        const { writeDeletionSnapshot } = await import('../../../services/documents/SnapshotWriter.js');
        archiveInfo = await writeDeletionSnapshot({
          widgetId: widgetIdForSnap,
          documentId: parseInt(documentId),
          docSlug: docData.slug,
          markdown: finalMarkdown,
          lastSourcePath: docData.source_path || null,
          lastRowId: parseInt(documentId),
          deletedBy: req.user?.id || null,
          reason,
          registryTableId: parseInt(registryTableId),
        });
      } catch (snapErr) {
        apiLogger.warn({ err: snapErr.message, documentId }, '[SnapshotWriter] deletion snapshot failed (non-fatal)');
      }
    }

    success(res, {
      document_id: parseInt(documentId),
      table_deleted: deleteTable && !!tableId,
      archive: archiveInfo?.written ? {
        deleted_snapshot_path: archiveInfo.deleted_snapshot_path,
        archive_path: archiveInfo.archive_path,
      } : null,
    });
  } catch (err) {
    apiLogger.error({ err }, 'DELETE /documents/:documentId error:', err);
    error(res, 'DELETE_DOCUMENT_ERROR', err.message, 500);
  }
});

export default router;
