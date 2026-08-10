// Documents v4 · ADR-0003 Phase 0 (C-6): express research log
//
// Widget-scoped endpoints for the architect's Phase-0 express research log,
// persisted on the registry row itself as a jsonb array so it travels with
// the doc through the pipeline.
//
//   POST /api/v3/widgets/:widgetId/documents/:docId/research
//   GET  /api/v3/widgets/:widgetId/documents/:docId/research
//
// Storage: table_rows.data->'express_research_log'  (array of entries).
// Each entry: { ts, author_id, source, verdict, note }.

import express from 'express';
import {
  dbGet, dbRun, isPostgres, safeJsonParse,
  apiLogger,
  success, badRequest, notFound, forbidden,
  requireEditorAccess,
} from './_helpers.js';

const router = express.Router();

async function resolveWidgetBinding(widgetId) {
  const w = await dbGet('SELECT id, config FROM widgets WHERE id = ?', [widgetId]);
  if (!w) return null;
  const cfg = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
  const registry_table_id = Number(cfg.registry_table_id || cfg.documents_table_id || 0);
  if (!registry_table_id) return null;
  const tbl = await dbGet(
    'SELECT project_id FROM universal_tables WHERE id = ?',
    [registry_table_id]
  );
  return {
    registry_table_id,
    project_id: cfg.project_id ? Number(cfg.project_id) : (tbl?.project_id || null),
  };
}

function normalizeLog(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = safeJsonParse(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

/** GET /api/v3/widgets/:widgetId/documents/:docId/research */
router.get('/widgets/:widgetId/documents/:docId/research', async (req, res) => {
  try {
    const widgetId = Number(req.params.widgetId);
    const docId = Number(req.params.docId);
    if (!widgetId || !docId) return badRequest(res, 'widgetId and docId are required');

    const binding = await resolveWidgetBinding(widgetId);
    if (!binding) return notFound(res, `Widget ${widgetId} is not a documents widget`);

    const row = await dbGet(
      `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
      [docId, binding.registry_table_id]
    );
    if (!row) return notFound(res, `Document ${docId} not found in widget ${widgetId}`);

    const data = safeJsonParse(row.data, {});
    const research_log = normalizeLog(data.express_research_log);
    return success(res, { document_id: docId, widget_id: widgetId, research_log });
  } catch (err) {
    apiLogger.error({ err }, '[ADR-0003 C-6] GET /research failed');
    return res.status(500).json({ error: err.message });
  }
});

/** POST /api/v3/widgets/:widgetId/documents/:docId/research
 *
 *  Body: { source: string, verdict: string, note?: string }
 *  Appends `{ ts, author_id, source, verdict, note }` atomically via jsonb
 *  concatenation. Requires editor+ access on the binding's project.
 */
router.post('/widgets/:widgetId/documents/:docId/research', async (req, res) => {
  try {
    const widgetId = Number(req.params.widgetId);
    const docId = Number(req.params.docId);
    if (!widgetId || !docId) return badRequest(res, 'widgetId and docId are required');

    const { source, verdict, note } = req.body || {};
    if (!source || typeof source !== 'string') return badRequest(res, 'source is required');
    if (!verdict || typeof verdict !== 'string') return badRequest(res, 'verdict is required');
    if (note !== undefined && typeof note !== 'string') return badRequest(res, 'note must be a string when provided');

    const binding = await resolveWidgetBinding(widgetId);
    if (!binding) return notFound(res, `Widget ${widgetId} is not a documents widget`);

    const userId = req.user?.id;
    if (!userId) return forbidden(res, 'Authentication required');
    if (!binding.project_id) return badRequest(res, 'Widget binding has no project_id — cannot enforce access');
    if (!(await requireEditorAccess(req, res, binding.project_id))) return;

    const row = await dbGet(
      `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
      [docId, binding.registry_table_id]
    );
    if (!row) return notFound(res, `Document ${docId} not found in widget ${widgetId}`);

    const entry = {
      ts: new Date().toISOString(),
      author_id: userId,
      source,
      verdict,
      note: note || '',
    };

    const pg = isPostgres();
    if (pg) {
      // Atomic jsonb concat. COALESCE guards against rows whose jsonb value is
      // NULL (field absent) — in which case we seed an empty array.
      await dbRun(
        `UPDATE table_rows
         SET data = jsonb_set(
               data,
               '{express_research_log}',
               COALESCE(data->'express_research_log', '[]'::jsonb) || $1::jsonb,
               true
             ),
             updated_at = NOW()
         WHERE id = $2 AND table_id = $3`,
        [JSON.stringify(entry), docId, binding.registry_table_id]
      );
    } else {
      // SQLite fallback: read-modify-write (no concurrent writers in dev).
      const currentData = safeJsonParse(row.data, {});
      const log = normalizeLog(currentData.express_research_log);
      log.push(entry);
      currentData.express_research_log = log;
      await dbRun(
        `UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(currentData), docId]
      );
    }

    const updated = await dbGet(
      `SELECT data FROM table_rows WHERE id = ?`,
      [docId]
    );
    const research_log = normalizeLog(safeJsonParse(updated.data, {}).express_research_log);

    apiLogger.info({ widgetId, docId, userId, verdict }, '[ADR-0003 C-6] research entry appended');
    return success(res, { document_id: docId, widget_id: widgetId, research_log, appended: entry });
  } catch (err) {
    apiLogger.error({ err }, '[ADR-0003 C-6] POST /research failed');
    return res.status(500).json({ error: err.message });
  }
});

export default router;
