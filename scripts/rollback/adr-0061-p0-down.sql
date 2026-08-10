-- ADR-0061 P0 — Rollback for 20260516-adr0061-p0-budgets-agent-runs.sql
-- Drops the virtual columns + virtual table metadata. Does NOT drop table_rows
-- payload — operator should TRUNCATE manually if there's run data they want gone.

BEGIN;

-- 1. Remove default_budget_json from agents (1784)
DELETE FROM table_columns WHERE table_id=1784 AND column_name='default_budget_json';

-- 2. Remove _agent_runs virtual table metadata + columns
DELETE FROM table_columns WHERE table_id=100001;
DELETE FROM universal_tables WHERE id=100001 AND name='_agent_runs';
-- (legacy `tables` entry if any from earlier dev iteration)
DELETE FROM tables WHERE id=100001 AND name='_agent_runs';

-- 3. (NOT auto-deleted) any table_rows with table_id=100001 — uncomment to wipe:
-- DELETE FROM table_rows WHERE table_id=100001;

COMMIT;
