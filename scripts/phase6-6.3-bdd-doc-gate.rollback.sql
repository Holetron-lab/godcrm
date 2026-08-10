-- Rollback for ADR-0003 Phase 6 / ticket 126415 (6.3) — drop bdd_doc_gate.
-- Idempotent: IF EXISTS avoids error on re-run.

BEGIN;

DROP VIEW IF EXISTS bdd_doc_gate;

COMMIT;
