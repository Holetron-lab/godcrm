-- Phase 7.1 — Registry provenance (ADR-0003 C-1, ticket 125589)
-- Enforces non-null title / created_by / created_at on documents-registry rows.
--
-- Strategy
--   * created_at is already DEFAULT CURRENT_TIMESTAMP on table_rows — nothing to add.
--   * created_by is nullable; backfill legacy NULLs to user_id=1 (system) for
--     rows in universal_tables.table_type = 'documents_registry'.
--   * title lives inside JSONB data; column-level NOT NULL is not available.
--     Enforce via BEFORE INSERT OR UPDATE trigger scoped to documents
--     registries, checking data->>'name' or data->>'title' non-empty.
--   * Same trigger rejects NULL created_by on documents-registry rows so app
--     bugs cannot resurrect orphan provenance.
--
-- Applies to DEV only in this pass. PROD schedule = separate ticket.

BEGIN;

-- ---- Pre-check ---------------------------------------------------------
DO $$
DECLARE
  orphan_created_by int;
  orphan_created_at int;
  orphan_name       int;
  total             int;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE tr.created_by IS NULL),
    COUNT(*) FILTER (WHERE tr.created_at IS NULL),
    COUNT(*) FILTER (WHERE (tr.data->>'name') IS NULL AND (tr.data->>'title') IS NULL),
    COUNT(*)
  INTO orphan_created_by, orphan_created_at, orphan_name, total
  FROM table_rows tr
  JOIN universal_tables ut ON ut.id = tr.table_id
  WHERE ut.table_type = 'documents_registry';

  RAISE NOTICE 'Phase 7.1 pre-check: total=%, null_created_by=%, null_created_at=%, null_title=%',
    total, orphan_created_by, orphan_created_at, orphan_name;
END$$;

-- ---- Backfill NULL created_by ------------------------------------------
UPDATE table_rows tr
SET created_by = 1
FROM universal_tables ut
WHERE ut.id = tr.table_id
  AND ut.table_type = 'documents_registry'
  AND tr.created_by IS NULL;

-- ---- Backfill NULL created_at (defensive; should already be 0) ---------
UPDATE table_rows tr
SET created_at = CURRENT_TIMESTAMP
FROM universal_tables ut
WHERE ut.id = tr.table_id
  AND ut.table_type = 'documents_registry'
  AND tr.created_at IS NULL;

-- ---- Enforcement trigger ----------------------------------------------
CREATE OR REPLACE FUNCTION registry_provenance_check()
RETURNS TRIGGER AS $$
DECLARE
  v_table_type text;
  v_title      text;
BEGIN
  SELECT table_type INTO v_table_type
    FROM universal_tables
    WHERE id = NEW.table_id;

  IF v_table_type IS DISTINCT FROM 'documents_registry' THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS NULL THEN
    RAISE EXCEPTION 'registry_provenance: created_by is NULL (table_id=%)', NEW.table_id
      USING ERRCODE = '23502';
  END IF;

  IF NEW.created_at IS NULL THEN
    RAISE EXCEPTION 'registry_provenance: created_at is NULL (table_id=%)', NEW.table_id
      USING ERRCODE = '23502';
  END IF;

  v_title := COALESCE(NULLIF(NEW.data->>'name', ''), NULLIF(NEW.data->>'title', ''));
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'registry_provenance: data.name/title is empty (table_id=%)', NEW.table_id
      USING ERRCODE = '23502';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS registry_provenance_trg ON table_rows;
CREATE TRIGGER registry_provenance_trg
  BEFORE INSERT OR UPDATE ON table_rows
  FOR EACH ROW
  EXECUTE FUNCTION registry_provenance_check();

-- ---- Post-check --------------------------------------------------------
DO $$
DECLARE
  orphan_after int;
BEGIN
  SELECT COUNT(*) INTO orphan_after
  FROM table_rows tr
  JOIN universal_tables ut ON ut.id = tr.table_id
  WHERE ut.table_type = 'documents_registry'
    AND (tr.created_by IS NULL OR tr.created_at IS NULL);

  IF orphan_after > 0 THEN
    RAISE EXCEPTION 'Phase 7.1 post-check failed: % orphan rows remain', orphan_after;
  END IF;
  RAISE NOTICE 'Phase 7.1 post-check: OK (0 orphan rows)';
END$$;

COMMIT;
