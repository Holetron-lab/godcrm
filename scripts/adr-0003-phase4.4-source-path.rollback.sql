-- ADR-0003 Phase 4.4 · P-1 rollback (ticket 126809)
-- Removes the `source_path` column definition from documents-widget registry.
-- Payload data (table_rows.data->>'source_path') is preserved — only the
-- column-metadata row is dropped. If you need to purge payload values as well,
-- uncomment the second statement.

BEGIN;

DELETE FROM table_columns
WHERE table_id = 2197 AND column_name = 'source_path';

-- Optional: purge the key from existing row payloads.
-- UPDATE table_rows SET data = data - 'source_path'
-- WHERE table_id = 2197 AND data ? 'source_path';

COMMIT;

-- Verify
SELECT COUNT(*) AS remaining
FROM table_columns
WHERE table_id = 2197 AND column_name = 'source_path';
