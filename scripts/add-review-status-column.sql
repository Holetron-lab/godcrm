-- ADR-156 Phase 5A Iteration 3: add `review_status` gate column to ADR widget
-- registry (table_id = 2197) so backend/routes/v3/bdd.js acceptance-confirm
-- gate can evaluate data.review_status.
--
-- Idempotent: safe to re-run. Architect spec:
--   column_name   = review_status
--   type          = select
--   display_name  = Review
--   options (text) = JSON array of {value,label,color}
--   default_value = draft
--   order_index   = 9 (spec said 8; position 8 is occupied by order_index column)
--   is_visible=1, is_required=0
--
-- `data` is jsonb → use jsonb concat (||) to backfill draft without clobbering.

BEGIN;

-- 1. Register the column (idempotent)
INSERT INTO table_columns (
  table_id,
  column_name,
  display_name,
  type,
  options,
  default_value,
  order_index,
  is_visible,
  is_required
)
SELECT
  2197,
  'review_status',
  'Review',
  'select',
  '[{"value":"draft","label":"Draft","color":"#6b7280"},{"value":"ready_for_review","label":"Ready for Review","color":"#f59e0b"},{"value":"in_review","label":"In Review","color":"#3b82f6"},{"value":"approved","label":"Approved","color":"#22c55e"},{"value":"rejected","label":"Rejected","color":"#ef4444"}]',
  'draft',
  9,
  1,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM table_columns
  WHERE table_id = 2197 AND column_name = 'review_status'
);

-- 2. Backfill review_status=draft for rows that don't already have it
UPDATE table_rows
SET data = data || '{"review_status":"draft"}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE table_id = 2197
  AND NOT (data ? 'review_status');

COMMIT;
