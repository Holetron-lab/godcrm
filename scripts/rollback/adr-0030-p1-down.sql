-- ADR-0030 Phase 1 — ROLLBACK
-- Symmetric reverse of: scripts/migrations/20260504-adr0030-p1-run-state-and-workflow-config.sql
-- Constitution v3.0 §3 — required for any P1 schema migration (ADR-0030 §16).
--
-- Idempotent: safe to re-run. Each DELETE is a no-op on second run.
--
-- WARNING: This drops:
--   - All run_* virtual columns from tickets (table_id=1708) — any per-row
--     run_* values in table_rows.data are NOT removed by this script.
--     The values remain as orphaned JSON keys; they're invisible without
--     the column definitions and harmless. If you want a clean wipe, run
--     the optional cleanup at the bottom (commented out).
--   - The _workflow_config table definition + all column definitions + the
--     singleton row.

BEGIN;

-- =============================================================
-- Part 1 — Drop run_* virtual columns from tickets (table_id=1708)
-- =============================================================

DELETE FROM table_columns WHERE table_id=1708 AND column_name IN (
  'run_state',
  'run_attempt',
  'run_thread_id',
  'run_workspace_path',
  'run_started_at',
  'run_finished_at',
  'run_last_event_at',
  'run_terminal_reason',
  'run_next_attempt_after',
  'run_pending_approval_token'
);


-- =============================================================
-- Part 2 — Drop _workflow_config (table_id=100000) — singleton + cols + table
-- =============================================================

-- Drop singleton row first (FK-style ordering, even though no real FKs)
DELETE FROM table_rows WHERE table_id=100000;

-- Drop all column definitions
DELETE FROM table_columns WHERE table_id=100000;

-- Drop table metadata
DELETE FROM tables WHERE id=100000;

COMMIT;

-- =============================================================
-- OPTIONAL: clean up orphaned run_* keys from existing ticket rows
-- =============================================================
-- Uncomment this block ONLY if you also want to scrub run_* values
-- from every existing ticket row's data JSONB. Heavy operation —
-- writes every row, so it triggers all UPDATE-side automation.
--
-- BEGIN;
-- UPDATE table_rows
--   SET data = data
--     - 'run_state'
--     - 'run_attempt'
--     - 'run_thread_id'
--     - 'run_workspace_path'
--     - 'run_started_at'
--     - 'run_finished_at'
--     - 'run_last_event_at'
--     - 'run_terminal_reason'
--     - 'run_next_attempt_after'
--     - 'run_pending_approval_token',
--       updated_at = updated_at  -- preserve mtime
--   WHERE table_id=1708
--     AND (data ? 'run_state'
--      OR data ? 'run_attempt'
--      OR data ? 'run_thread_id'
--      OR data ? 'run_workspace_path'
--      OR data ? 'run_started_at'
--      OR data ? 'run_finished_at'
--      OR data ? 'run_last_event_at'
--      OR data ? 'run_terminal_reason'
--      OR data ? 'run_next_attempt_after'
--      OR data ? 'run_pending_approval_token');
-- COMMIT;
