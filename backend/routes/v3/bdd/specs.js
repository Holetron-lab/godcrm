/**
 * GET /api/v3/bdd/specs?source_doc_id=<docId>
 *
 * ADR-156 Phase 5D — returns nested specs+criteria tree for a given source
 * document id. Used by the BDD panel in the documents widget.
 */

import { dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, badRequest } from '../../../utils/response.js';
import { getBddTableId } from './shared.js';

export default function registerSpecsRoutes(router) {
  router.get('/specs', async (req, res) => {
    try {
      const docId = parseInt(req.query.source_doc_id, 10);
      if (!Number.isFinite(docId)) {
        return badRequest(res, 'source_doc_id (integer) is required');
      }

      const specsTableId = await getBddTableId('bdd_specs');
      const critTableId  = await getBddTableId('bdd_criteria');
      if (!specsTableId || !critTableId) {
        return error(res, 'BDD_TABLES_NOT_BOOTSTRAPPED',
          'BDD logical tables missing in space 11.', 500);
      }

      const specRows = await dbAll(
        `SELECT id, base_id, data FROM table_rows
         WHERE table_id = ? AND data->>'source_doc_id' = ?
         ORDER BY id ASC`,
        [specsTableId, String(docId)]
      );

      const result = [];
      for (const s of specRows) {
        const sData = typeof s.data === 'string' ? JSON.parse(s.data) : (s.data || {});
        const critRows = await dbAll(
          `SELECT id, base_id, data FROM table_rows
           WHERE table_id = ? AND data->>'spec_id' = ?
           ORDER BY COALESCE((data->>'order_index')::int, id) ASC`,
          [critTableId, String(s.id)]
        );
        const criteria = critRows.map(c => {
          const d = typeof c.data === 'string' ? JSON.parse(c.data) : (c.data || {});
          const t = d.totp || null;
          // ADR-0002 §8 Phase 2 (G7.1): prefer canonical `given` / `when_clause`
          // / `then` columns; fall back to legacy `description` when none of
          // the three are populated. `when` legacy alias kept for any rows
          // authored before the column was renamed to `when_clause`.
          const gwtPresent = !!(d.given || d.when_clause || d.when || d.then);
          return {
            id: c.id,
            code: d.code || null,
            title: d.title || null,
            given: d.given || (gwtPresent ? '' : (d.description || '')),
            when: d.when_clause || d.when || '',
            then: d.then || (gwtPresent ? '' : (d.title || '')),
            description: d.description || null,
            priority: d.priority || null,
            status: d.status || 'pending',
            claimed_at: d.claimed_at || null,
            claimed_by_agent: d.claimed_by_agent || null,
            claimed_evidence: d.claimed_evidence || null,
            owner_user_id: d.owner_user_id ?? null,
            spec_owner_user_id: sData.owner_user_id ?? null,
            enrolled: !!(t && t.active_secret),
          };
        });
        result.push({
          id: s.id,
          code: sData.code || sData.title || `spec-${s.id}`,
          owner_user_id: sData.owner_user_id ?? null,
          criteria,
        });
      }

      return success(res, { specs: result });
    } catch (err) {
      apiLogger.error({ err, docId: req.query.source_doc_id }, 'GET /bdd/specs failed');
      return error(res, 'BDD_SPECS_FAILED', err.message, 500);
    }
  });
}
