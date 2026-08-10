/**
 * ADR-156 Phase 5A: BDD Test Runs API
 *
 * POST /api/v3/bdd/tests/:id/runs
 *   - Records a test-run row into CRM logical table `bdd_test_runs`
 *   - On passed: checks whether *all* blocking tests for the parent criterion
 *     have a passing run within the last 24h. If so, flips the criterion's
 *     data.status to 'agent_claimed' and emits pg_notify('bdd.criterion.claimed').
 *   - On failed: flips criterion's data.status to 'failed' and emits
 *     pg_notify('bdd.criterion.failed').
 *   - On 3 consecutive timeout/error runs: disables the test (data.disabled=true).
 */

import { dbGet, dbAll, dbRun, sqlNow } from '../../../database/connection.js';
import { generateBaseId } from '../../../utils/baseId.js';
import { apiLogger } from '../../../utils/logger.js';
import { created, error, notFound, badRequest } from '../../../utils/response.js';
import {
  getBddTableId,
  patchLogicalRow,
  pgNotify,
} from './shared.js';

/**
 * Fetch the logical row for `bdd_tests.id` by the CRM row id.
 * Returns { id, base_id, data } or null.
 */
async function getTestRow(testRowId) {
  const bddTestsTableId = await getBddTableId('bdd_tests');
  if (!bddTestsTableId) return null;
  const row = await dbGet(`
    SELECT id, base_id, data
    FROM table_rows
    WHERE table_id = ? AND id = ?
  `, [bddTestsTableId, testRowId]);
  if (!row) return null;
  // PG returns jsonb as object already
  row.data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  return row;
}

/**
 * ADR-156 Appendix C §1.6 — resolve a `bdd_tests` row by its `code` field
 * (e.g. ADR-156-AC1-T1), falling back to `previous_codes` history so renamed
 * tests remain addressable by their old code.
 *
 * Returns { id, base_id, data } or null.
 */
async function getTestRowByCode(code) {
  const bddTestsTableId = await getBddTableId('bdd_tests');
  if (!bddTestsTableId) return null;
  // Match current code, or code present in previous_codes JSON array.
  const row = await dbGet(`
    SELECT id, base_id, data
    FROM table_rows
    WHERE table_id = ?
      AND (
            data->>'code' = ?
         OR (
              jsonb_typeof(data->'previous_codes') = 'array'
              AND data->'previous_codes' @> to_jsonb(?::text)
            )
      )
    ORDER BY (data->>'code' = ?) DESC, id ASC
    LIMIT 1
  `, [bddTestsTableId, code, code, code]);
  if (!row) return null;
  row.data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  return row;
}

/**
 * Heuristic: does `s` look like a BDD code (e.g. `ADR-156-AC1-T1`) rather
 * than a numeric row id?
 */
function looksLikeCode(s) {
  if (typeof s !== 'string') return false;
  return /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-AC\d+(?:-T\d+)?$/.test(s);
}

/**
 * Load all sibling tests that share the same criterion_id AND are is_blocking.
 */
async function getBlockingSiblingTests(criterionId) {
  const bddTestsTableId = await getBddTableId('bdd_tests');
  if (!bddTestsTableId) return [];
  const rows = await dbAll(`
    SELECT id, base_id, data
    FROM table_rows
    WHERE table_id = ?
      AND data->>'criterion_id' = ?
      AND COALESCE(data->>'is_blocking','false') IN ('true','1','t')
  `, [bddTestsTableId, String(criterionId)]);
  return rows.map(r => ({
    ...r,
    data: typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {}),
  }));
}

/**
 * Has this test had a passing run newer than the cutoff?
 */
async function hasFreshPass(testRowId, cutoffIso) {
  const bddRunsTableId = await getBddTableId('bdd_test_runs');
  if (!bddRunsTableId) return false;
  const row = await dbGet(`
    SELECT id
    FROM table_rows
    WHERE table_id = ?
      AND data->>'test_id' = ?
      AND data->>'status' = 'passed'
      AND COALESCE(data->>'finished_at', data->>'created_at', to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) > ?
    LIMIT 1
  `, [bddRunsTableId, String(testRowId), cutoffIso]);
  return !!row;
}

/**
 * Fetch the last N runs (most recent first) for a given test.
 */
async function getLastRuns(testRowId, n = 3) {
  const bddRunsTableId = await getBddTableId('bdd_test_runs');
  if (!bddRunsTableId) return [];
  const rows = await dbAll(`
    SELECT id, data, created_at
    FROM table_rows
    WHERE table_id = ? AND data->>'test_id' = ?
    ORDER BY id DESC
    LIMIT ?
  `, [bddRunsTableId, String(testRowId), n]);
  return rows.map(r => ({
    ...r,
    data: typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {}),
  }));
}

/**
 * Core logic triggered after inserting a run. Returns a summary object used
 * for logging; any errors are swallowed so the HTTP response isn't blocked.
 */
async function handlePostInsertSideEffects({ testRow, runStatus, triggeredById }) {
  const summary = { criterion_claimed: false, criterion_failed: false, test_disabled: false };

  const criterionId = testRow.data?.criterion_id;
  const bddCriteriaTableId = await getBddTableId('bdd_criteria');
  const bddTestsTableId = await getBddTableId('bdd_tests');

  // --- failed → mark criterion as failed -------------------------------
  if (runStatus === 'failed' && criterionId && bddCriteriaTableId) {
    const crit = await dbGet(`
      SELECT id, data FROM table_rows WHERE table_id = ? AND id = ?
    `, [bddCriteriaTableId, criterionId]);
    if (crit) {
      await patchLogicalRow(bddCriteriaTableId, crit.id, {
        status: 'failed',
        failed_at: new Date().toISOString(),
        failed_test_id: testRow.id,
      });
      const critData = typeof crit.data === 'string' ? JSON.parse(crit.data) : (crit.data || {});
      await pgNotify('bdd.criterion.failed', {
        criterion_id: crit.id,
        spec_id: critData.spec_id ?? null,
        doc_id: critData.source_doc_id ?? null,
        failing_test_id: testRow.id,
      });
      summary.criterion_failed = true;
    }
  }

  // --- passed → check all blocking siblings are green, claim if so -----
  if (runStatus === 'passed' && criterionId && bddCriteriaTableId) {
    const siblings = await getBlockingSiblingTests(criterionId);
    const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let allGreen = siblings.length > 0;
    for (const sib of siblings) {
      // the current test just passed — short-circuit to avoid race
      if (Number(sib.id) === Number(testRow.id)) continue;
      const fresh = await hasFreshPass(sib.id, cutoffIso);
      if (!fresh) { allGreen = false; break; }
    }

    if (allGreen) {
      const crit = await dbGet(`
        SELECT id, data FROM table_rows WHERE table_id = ? AND id = ?
      `, [bddCriteriaTableId, criterionId]);
      if (crit) {
        await patchLogicalRow(bddCriteriaTableId, crit.id, {
          status: 'agent_claimed',
          claimed_at: new Date().toISOString(),
          claimed_by_agent: triggeredById ?? null,
        });
        const critData = typeof crit.data === 'string' ? JSON.parse(crit.data) : (crit.data || {});
        await pgNotify('bdd.criterion.claimed', {
          criterion_id: crit.id,
          spec_id: critData.spec_id ?? null,
          doc_id: critData.source_doc_id ?? null,
          claimed_by: triggeredById ?? null,
        });
        summary.criterion_claimed = true;
      }
    }
  }

  // --- 3 consecutive timeout/error → disable test ----------------------
  if ((runStatus === 'timeout' || runStatus === 'error') && bddTestsTableId) {
    const last = await getLastRuns(testRow.id, 3);
    if (last.length >= 3 && last.every(r => r.data?.status === 'timeout' || r.data?.status === 'error')) {
      await patchLogicalRow(bddTestsTableId, testRow.id, {
        disabled: true,
        disabled_reason: `3 consecutive ${runStatus} runs`,
        disabled_at: new Date().toISOString(),
      });
      summary.test_disabled = true;
    }
  }

  return summary;
}

/**
 * POST /api/v3/bdd/tests/:id/runs
 * Body: {
 *   status,               // required: queued|running|passed|failed|timeout|error
 *   exit_code?,
 *   duration_ms?,
 *   stdout_tail?,
 *   stderr_tail?,
 *   assertion_result?,
 *   score?,
 *   triggered_by,         // required: 'human' | 'agent' | 'worker' | 'cron'
 *   triggered_by_id,      // required: stringly-typed id (agent id, user id, etc.)
 *   run_hash?,
 * }
 */
export default function registerTestRoutes(router) {
  router.post('/tests/:id/runs', async (req, res) => {
    const startedAt = new Date().toISOString();
    try {
      // ADR-156 Appendix C §1.6: :id may be a numeric row id OR a stable code
      // string (including a historical code from `previous_codes`).
      const rawId = req.params.id;
      let testRowId;
      let preloadedRow = null;
      if (looksLikeCode(rawId)) {
        preloadedRow = await getTestRowByCode(rawId);
        if (!preloadedRow) return notFound(res, 'bdd_tests row (by code)');
        testRowId = preloadedRow.id;
      } else {
        testRowId = parseInt(rawId, 10);
        if (!Number.isFinite(testRowId)) return badRequest(res, 'Invalid test id');
      }

      const {
        status,
        exit_code = null,
        duration_ms = null,
        stdout_tail = null,
        stderr_tail = null,
        assertion_result = null,
        score = null,
        triggered_by,
        triggered_by_id,
        run_hash = null,
      } = req.body || {};

      const ALLOWED_STATUS = new Set(['queued', 'running', 'passed', 'failed', 'timeout', 'error']);
      if (!status || !ALLOWED_STATUS.has(status)) {
        return badRequest(res, `status must be one of: ${[...ALLOWED_STATUS].join(', ')}`);
      }
      if (!triggered_by) return badRequest(res, 'triggered_by is required');
      if (triggered_by_id === undefined || triggered_by_id === null) {
        return badRequest(res, 'triggered_by_id is required');
      }

      const testRow = preloadedRow || await getTestRow(testRowId);
      if (!testRow) return notFound(res, 'bdd_tests row');

      const bddRunsTableId = await getBddTableId('bdd_test_runs');
      if (!bddRunsTableId) {
        return error(res, 'BDD_TABLES_NOT_BOOTSTRAPPED',
          'bdd_test_runs logical table is missing in space 11. Run scripts/bootstrap-bdd-tables.js.', 500);
      }

      const runData = {
        test_id: String(testRowId),
        status,
        exit_code,
        duration_ms,
        stdout_tail,
        stderr_tail,
        assertion_result,
        score,
        triggered_by,
        triggered_by_id: String(triggered_by_id),
        run_hash,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      };

      const baseId = generateBaseId();
      const insert = await dbRun(`
        INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
      `, [bddRunsTableId, baseId, JSON.stringify(runData), req.user?.id || 1]);

      const runId = insert.lastID || insert.lastInsertRowid;

      if (status === 'queued') {
        try {
          await pgNotify('bdd.test_run.queued', { test_id: testRowId, run_id: runId });
        } catch (notifyErr) {
          apiLogger.warn({ err: notifyErr.message, testRowId, runId },
            'BDD: pg_notify bdd.test_run.queued failed (row was still inserted)');
        }
      }

      // Side-effects (claim/fail/disable). Never bubble these up to the caller.
      let sideEffects = {};
      try {
        sideEffects = await handlePostInsertSideEffects({
          testRow,
          runStatus: status,
          triggeredById: triggered_by_id,
        });
      } catch (sideErr) {
        apiLogger.warn({ err: sideErr.message, testRowId, runId },
          'BDD: side-effect processing failed (run row was still inserted)');
      }

      return created(res, {
        id: runId,
        base_id: baseId,
        test_id: testRowId,
        status,
        side_effects: sideEffects,
      });
    } catch (err) {
      apiLogger.error({ err, testId: req.params.id }, 'POST /bdd/tests/:id/runs failed');
      return error(res, 'BDD_RUN_INSERT_FAILED', err.message, 500);
    }
  });
}
