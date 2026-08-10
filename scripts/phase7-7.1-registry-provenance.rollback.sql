-- Rollback for phase7-7.1-registry-provenance.sql (ticket 125589)
-- Drops the trigger + function. Does NOT undo the backfill of created_by=1
-- (that data is not recoverable; if needed, restore from backup).

BEGIN;
DROP TRIGGER IF EXISTS registry_provenance_trg ON table_rows;
DROP FUNCTION IF EXISTS registry_provenance_check();
COMMIT;
