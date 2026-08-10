/**
 * POST /api/v3/bdd/acceptance/:docId/confirm
 *
 * ADR-156 Appendix C §2.6 ("Review gate") — acceptance (the TOTP confirm flow)
 * is only enabled when the backing document's `review_status` is one of
 * 'ready_for_review' or 'in_review'. Anything else → 409 Conflict.
 *
 * The document lives in the ADRs widget registry table (id 2197). This is the
 * iteration-2 stub; actual TOTP verification is deferred to iteration 3.
 */

import { dbGet } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { error, notFound, badRequest } from '../../../utils/response.js';

const ADR_REGISTRY_TABLE_ID = 2197;
const ACCEPTANCE_ALLOWED_STATES = ['ready_for_review', 'in_review'];

export default function registerAcceptanceRoutes(router) {
  router.post('/acceptance/:docId/confirm', async (req, res) => {
    try {
      const docId = parseInt(req.params.docId, 10);
      if (!Number.isFinite(docId)) return badRequest(res, 'Invalid docId');

      const doc = await dbGet(`
        SELECT id, data
        FROM table_rows
        WHERE table_id = ? AND id = ?
      `, [ADR_REGISTRY_TABLE_ID, docId]);

      if (!doc) return notFound(res, 'ADR document');

      const data = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});
      const reviewStatus = data.review_status || null;

      if (!ACCEPTANCE_ALLOWED_STATES.includes(reviewStatus)) {
        return res.status(409).json({
          ok: false,
          error: 'not_ready',
          review_status: reviewStatus,
          allowed: ACCEPTANCE_ALLOWED_STATES,
          message: `document review_status must be one of ${ACCEPTANCE_ALLOWED_STATES.join(', ')} to confirm acceptance`,
        });
      }

      // TODO: TOTP verify in iteration 3
      return res.status(200).json({
        ok: true,
        pending_totp: true,
        doc_id: docId,
        review_status: reviewStatus,
      });
    } catch (err) {
      apiLogger.error({ err, docId: req.params.docId }, 'POST /bdd/acceptance/:docId/confirm failed');
      return error(res, 'BDD_ACCEPTANCE_CONFIRM_FAILED', err.message, 500);
    }
  });
}
