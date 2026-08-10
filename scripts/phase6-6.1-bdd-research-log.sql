-- ADR-0003 Phase 6 / ticket 126413 (6.1) — bdd_research_log table.
--
-- Architect's self-driven research must be persisted before interrogation
-- (precondition for C-2 / criterion 126371 and C-6 / criterion 126375).
-- Real Postgres table (not a CRM logical table): downstream endpoints
-- (future tickets 126390, 125586) need typed columns, uuid uniqueness,
-- and jsonb operators for server-side aggregation.
--
-- source_doc_id is a SOFT reference to widget 218 registry row
-- (table_rows.id filtered by table_id=2197). No hard FK: the CRM has no
-- global convention for FKing into table_rows by composite key, and doc
-- rows can be moved between widgets logically.
--
-- Idempotent — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS bdd_research_log (
  id            serial PRIMARY KEY,
  source_doc_id integer NOT NULL,
  run_id        uuid    NOT NULL UNIQUE,
  query         text    NOT NULL,
  findings      jsonb,
  citations     jsonb,
  author        text    NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bdd_research_log_source_doc_id
  ON bdd_research_log (source_doc_id, created_at DESC);

COMMIT;
