-- ADR-0003 Phase 4.4 · P-1 (ticket 126809)
-- Adds `source_path TEXT NULL` column to documents-widget registry tables.
--
-- Storage model: the CRM stores row payloads in table_rows.data (JSONB); adding
-- a "column" to a universal_tables row means inserting into table_columns so
-- the API and UI know about the key. No PostgreSQL ALTER is needed.
--
-- Scope: table 2197 (_registry for Architecture & ADR widget 218). Other
-- documents-widget registries are deferred to a follow-up ticket per AC §1.
--
-- Idempotent: re-running this script is a no-op (guarded by NOT EXISTS).
-- Rollback: see scripts/adr-0003-phase4.4-source-path.rollback.sql.

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
  created_at,
  updated_at
)
SELECT
  2197,
  'source_path',
  'Source Path',
  'text',
  100,
  1,
  1,
  0,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM table_columns
  WHERE table_id = 2197 AND column_name = 'source_path'
);

COMMIT;

-- Verify
SELECT id, table_id, column_name, type, is_readonly, order_index
FROM table_columns
WHERE table_id = 2197 AND column_name = 'source_path';
