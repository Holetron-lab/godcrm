-- ADR-0003 Phase 0 · C-6 (ticket 126812)
-- Adds `express_research_log` json column to documents-widget registry table 2197.
--
-- Storage: column metadata in table_columns; payload in table_rows.data JSONB.
-- The `[]` default is enforced at the API layer (POST /research reads missing
-- values as []), since the universal table abstraction does not push defaults
-- into PostgreSQL.
--
-- Idempotent; re-runnable.
-- Rollback: scripts/adr-0003-C6-express-research-log.rollback.sql.

BEGIN;

INSERT INTO table_columns (
  table_id,
  column_name,
  display_name,
  type,
  order_index,
  is_visible,
  is_readonly,
  is_system,
  default_value,
  created_at,
  updated_at
)
SELECT
  2197,
  'express_research_log',
  'Research Log',
  'json',
  101,
  0,              -- hidden from default grid; surfaced via dedicated endpoints + doc content
  1,              -- clients may not overwrite via generic row update
  0,
  '[]',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM table_columns
  WHERE table_id = 2197 AND column_name = 'express_research_log'
);

COMMIT;

-- Verify
SELECT id, table_id, column_name, type, is_readonly, default_value, order_index
FROM table_columns
WHERE table_id = 2197 AND column_name = 'express_research_log';
