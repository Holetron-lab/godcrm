-- ADR-0041 P1 — Column-Type Canonicalization
-- Atomic migration: rename 4 legacy type clusters → canonical types,
-- + fix 4 anomalous rows in table 2097.tags (string → JSON array).
--
-- Safe to re-run (idempotent guards inline). Aborts via RAISE EXCEPTION
-- if any legacy type or string-shape tag remains post-update.
--
-- Pre-flight snapshot (sysadmin 2026-05-05 07:36):
--   /root/db-backups/godcrm_prod_pre-adr0041_20260505_073612.dump
-- Rollback: pg_restore --clean -d godcrm_prod <dump>

BEGIN;

-- a) Type renames (4 clusters)
UPDATE table_columns SET type = 'checkbox'     WHERE type = 'boolean';
UPDATE table_columns SET type = 'multi-select' WHERE type IN ('multi_select', 'multiselect');
UPDATE table_columns SET type = 'long_text'    WHERE type IN ('longtext', 'richText', 'rich_text');
UPDATE table_columns SET type = 'text'         WHERE type = 'textarea';

-- b) 4-row data fix: comma-separated string → JSON array (multi-select shape)
--    Guarded by jsonb_typeof = 'string' for idempotency.
UPDATE table_rows
   SET data = jsonb_set(
         data,
         '{tags}',
         to_jsonb(ARRAY(
           SELECT trim(elem)
             FROM unnest(string_to_array(data ->> 'tags', ',')) AS elem
         ))
       )
 WHERE table_id = 2097
   AND id IN (44842, 44843, 44844, 44845)
   AND jsonb_typeof(data -> 'tags') = 'string';

-- c) Verify — abort transaction if anything legacy remains
DO $$
DECLARE
  legacy_columns_remaining int;
  string_tags_remaining    int;
BEGIN
  SELECT COUNT(*) INTO legacy_columns_remaining
    FROM table_columns
   WHERE type IN ('boolean', 'multi_select', 'multiselect',
                  'longtext', 'richText', 'rich_text', 'textarea');

  SELECT COUNT(*) INTO string_tags_remaining
    FROM table_rows
   WHERE table_id = 2097
     AND id IN (44842, 44843, 44844, 44845)
     AND jsonb_typeof(data -> 'tags') = 'string';

  RAISE NOTICE 'ADR-0041 P1 verify: legacy_columns=% string_tags=%',
    legacy_columns_remaining, string_tags_remaining;

  IF legacy_columns_remaining > 0 THEN
    RAISE EXCEPTION 'ADR-0041 P1 FAILED: % columns still carry legacy types',
      legacy_columns_remaining;
  END IF;

  IF string_tags_remaining > 0 THEN
    RAISE EXCEPTION 'ADR-0041 P1 FAILED: % tags rows in table 2097 still have string shape',
      string_tags_remaining;
  END IF;
END $$;

COMMIT;
