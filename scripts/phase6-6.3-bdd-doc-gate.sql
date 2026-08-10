-- ADR-0003 Phase 6 / ticket 126415 (6.3) — bdd_doc_gate read-only view.
--
-- Aggregates must-criterion gate state per (spec, source_doc). Downstream:
-- header `📐 готово` widget, status-machine watchdog (draft ↔
-- regressed-published), and future GET /api/v3/documents/:id/bdd-gate.
--
-- Substrate note: bdd_specs/bdd_criteria/bdd_tests/bdd_test_runs are CRM
-- *logical* tables (rows in public.table_rows keyed by table_id). Hard
-- table_ids are fixed: 7255 specs, 7256 criteria, 7258 tests, 7259 runs.
-- Registered in public.universal_tables — see ADR-0002 substrate.
--
-- Gate semantics:
--   must_total     = # must-priority criteria under the spec
--   must_verified  = # must criteria with status='verified'
--   must_failed    = # must criteria with status='failed'
--   ready          = must_total > 0 AND must_total = must_verified
--
-- Latest test run is joined per criterion (AC #3) but not currently folded
-- into the aggregate — status on the criterion row is the canonical flip
-- (updated via TOTP-signed verify in C-4 / ticket 126391). Exposing the
-- run join now keeps the view ready for a tighter double-gate rule later
-- without a schema churn.
--
-- Idempotent — CREATE OR REPLACE VIEW.

BEGIN;

CREATE OR REPLACE VIEW bdd_doc_gate AS
WITH specs AS (
  SELECT
    id                                   AS spec_id,
    (data->>'source_doc_id')::int        AS source_doc_id,
    updated_at                           AS spec_updated_at
  FROM table_rows
  WHERE table_id = 7255
    AND data ? 'source_doc_id'
    AND (data->>'source_doc_id') ~ '^-?\d+$'
),
criteria AS (
  SELECT
    id                                   AS criterion_id,
    (data->>'spec_id')::int              AS spec_id,
    data->>'priority'                    AS priority,
    data->>'status'                      AS status,
    updated_at                           AS criterion_updated_at
  FROM table_rows
  WHERE table_id = 7256
    AND data ? 'spec_id'
    AND (data->>'spec_id') ~ '^-?\d+$'
),
tests AS (
  SELECT
    id                                   AS test_id,
    (data->>'criterion_id')::int         AS criterion_id
  FROM table_rows
  WHERE table_id = 7258
    AND data ? 'criterion_id'
    AND (data->>'criterion_id') ~ '^-?\d+$'
),
latest_runs AS (
  SELECT DISTINCT ON (t.criterion_id)
    t.criterion_id,
    r.id                                 AS run_id,
    r.data->>'status'                    AS run_status,
    COALESCE(
      NULLIF(r.data->>'finished_at','')::timestamptz,
      r.updated_at
    )                                    AS run_ts
  FROM tests t
  JOIN table_rows r
    ON r.table_id = 7259
   AND (r.data->>'test_id') ~ '^-?\d+$'
   AND (r.data->>'test_id')::int = t.test_id
  ORDER BY
    t.criterion_id,
    COALESCE(NULLIF(r.data->>'finished_at','')::timestamptz, r.updated_at) DESC
)
SELECT
  s.source_doc_id,
  s.spec_id,
  COUNT(*) FILTER (WHERE c.priority = 'must')::int                                            AS must_total,
  COUNT(*) FILTER (WHERE c.priority = 'must' AND c.status = 'verified')::int                  AS must_verified,
  COUNT(*) FILTER (WHERE c.priority = 'must' AND c.status = 'failed')::int                    AS must_failed,
  (COUNT(*) FILTER (WHERE c.priority = 'must') > 0
    AND COUNT(*) FILTER (WHERE c.priority = 'must')
      = COUNT(*) FILTER (WHERE c.priority = 'must' AND c.status = 'verified'))                AS ready,
  GREATEST(
    MAX(s.spec_updated_at),
    MAX(c.criterion_updated_at),
    MAX(lr.run_ts)
  )                                                                                           AS updated_at
FROM specs s
LEFT JOIN criteria    c  ON c.spec_id     = s.spec_id
LEFT JOIN latest_runs lr ON lr.criterion_id = c.criterion_id
GROUP BY s.source_doc_id, s.spec_id;

COMMENT ON VIEW bdd_doc_gate IS
  'ADR-0003 Phase 6.3 / ticket 126415. Must-criterion gate aggregate per (spec, source_doc). Read-only.';

COMMIT;
