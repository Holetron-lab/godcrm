-- T-127901 · ADR-0003 Phase 2 · atoms_v2 widget_ref + settings_override
--
-- Storage model reminder: atoms_v2 is universal_tables id=3574. Rows live in
-- `table_rows.data` (JSONB), "columns" are metadata rows in `table_columns`.
-- Adding a column = INSERT into table_columns. No PG-level ALTER TABLE.
--
--   widget_ref         — number  (FK-ish → widgets.id; no hard FK so legacy
--                         widget cleanup does not cascade into atom rows)
--   settings_override  — json    (per-atom override on top of widget config)
--
-- Index: partial expression index on ((data->>'widget_ref')::int) scoped to
-- atoms_v2 rows, so lookups "which atoms embed widget N" stay cheap without
-- scanning the full 376-row (PROD) JSONB blob set.
--
-- Idempotent: re-running = 0 diff (guarded by NOT EXISTS).

BEGIN;

-- widget_ref (number, nullable)
INSERT INTO table_columns (
  table_id, column_name, display_name, type, config,
  order_index, is_visible, is_readonly, is_system,
  created_at, updated_at
)
SELECT
  3574, 'widget_ref', 'Widget Ref', 'number', NULL,
  30, 1, 0, 0,
  NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM table_columns
  WHERE table_id = 3574 AND column_name = 'widget_ref'
);

-- settings_override (json, nullable)
INSERT INTO table_columns (
  table_id, column_name, display_name, type, config,
  order_index, is_visible, is_readonly, is_system,
  created_at, updated_at
)
SELECT
  3574, 'settings_override', 'Settings Override', 'json', NULL,
  31, 1, 0, 0,
  NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM table_columns
  WHERE table_id = 3574 AND column_name = 'settings_override'
);

-- Partial expression index for widget_ref lookups on atoms_v2 rows only.
CREATE INDEX IF NOT EXISTS idx_atoms_v2_widget_ref
  ON table_rows (((data->>'widget_ref')::int))
  WHERE table_id = 3574 AND data ? 'widget_ref';

COMMIT;

-- Verify
SELECT column_name, type, order_index
  FROM table_columns
 WHERE table_id = 3574
   AND column_name IN ('widget_ref','settings_override')
 ORDER BY order_index;

SELECT indexname
  FROM pg_indexes
 WHERE indexname = 'idx_atoms_v2_widget_ref';
