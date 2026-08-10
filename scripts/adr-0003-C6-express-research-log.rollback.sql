-- ADR-0003 Phase 0 · C-6 rollback (ticket 126812)
-- Removes the express_research_log column definition. Payload
-- (table_rows.data->>'express_research_log') is preserved by default; uncomment
-- the second statement to purge.

BEGIN;

DELETE FROM table_columns
WHERE table_id = 2197 AND column_name = 'express_research_log';

-- Optional: purge the key from existing row payloads.
-- UPDATE table_rows SET data = data - 'express_research_log'
-- WHERE table_id = 2197 AND data ? 'express_research_log';

COMMIT;

-- Verify
SELECT COUNT(*) AS remaining
FROM table_columns
WHERE table_id = 2197 AND column_name = 'express_research_log';
