-- ADR-0003 Phase 6 / ticket 126414 (6.2) — interrogation_sessions table.
--
-- Architect roast protocol: records adversarial Q&A between architect and
-- stakeholders before BDD criteria lock. Precondition for C-3
-- (criterion 126372) and regression-driven re-interrogation.
--
-- verdict is bounded by CHECK constraint to 'pass' | 'fail' | 'retry'.
-- qa_log is NOT NULL: an interrogation row with no Q&A has no evidential
-- value.
--
-- Idempotent — safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS interrogation_sessions (
  id            serial PRIMARY KEY,
  source_doc_id integer NOT NULL,
  session_id    uuid    NOT NULL UNIQUE,
  roaster       text    NOT NULL,
  subject       text    NOT NULL,
  qa_log        jsonb   NOT NULL,
  verdict       text    CHECK (verdict IN ('pass','fail','retry')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_interrogation_sessions_source_doc_id
  ON interrogation_sessions (source_doc_id, ended_at DESC);

COMMIT;
