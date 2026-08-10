-- Rollback for phase6-6.5-docs-status-regressed-published.sql.
-- Removes the 'regressed-published' option from widget 218 registry
-- status column. Any doc rows currently holding that status will keep
-- the literal string value — reassign them (e.g. back to 'draft') BEFORE
-- running this rollback, otherwise the select cell renders as unknown.

BEGIN;

UPDATE table_columns
SET config = jsonb_set(
      config::jsonb,
      '{options}',
      (
        SELECT jsonb_agg(opt)
        FROM jsonb_array_elements(config::jsonb -> 'options') AS opt
        WHERE opt ->> 'value' <> 'regressed-published'
      )
    )::text,
    updated_at = CURRENT_TIMESTAMP
WHERE table_id = 2197
  AND column_name = 'status'
  AND (config::jsonb -> 'options') @> '[{"value":"regressed-published"}]'::jsonb;

COMMIT;
