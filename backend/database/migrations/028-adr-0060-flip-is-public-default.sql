-- Migration 028: ADR-0060 P4 — flip is_public semantics to opt-out
--
-- After the pivot (commit 8094af43), space-level `public_slug` is the only
-- visibility gate. Per-entity `is_public` flags become OPT-OUT hooks: a row
-- is visible by default; the owner explicitly hides it via project / module
-- settings UIs (mirrors the column-level `config.is_public === false` pattern).
--
-- Net change:
--   default FALSE → default TRUE
--   backfill existing rows from FALSE → TRUE so they keep their current
--   "visible inside a public space" behaviour established by the pivot.
--
-- Non-public spaces are unaffected: their entities are still gated by
-- `space.public_slug IS NULL` at the route layer, regardless of this flag.
--
-- Created: 2026-05-14
-- ADR: 0060 (doc 152799)

BEGIN;

ALTER TABLE projects         ALTER COLUMN is_public SET DEFAULT TRUE;
ALTER TABLE universal_tables ALTER COLUMN is_public SET DEFAULT TRUE;
ALTER TABLE dashboards       ALTER COLUMN is_public SET DEFAULT TRUE;
ALTER TABLE widgets          ALTER COLUMN is_public SET DEFAULT TRUE;

UPDATE projects         SET is_public = TRUE WHERE is_public = FALSE;
UPDATE universal_tables SET is_public = TRUE WHERE is_public = FALSE;
UPDATE dashboards       SET is_public = TRUE WHERE is_public = FALSE;
UPDATE widgets          SET is_public = TRUE WHERE is_public = FALSE;

COMMIT;

-- DOWN (manual / dev only):
-- BEGIN;
--   ALTER TABLE projects         ALTER COLUMN is_public SET DEFAULT FALSE;
--   ALTER TABLE universal_tables ALTER COLUMN is_public SET DEFAULT FALSE;
--   ALTER TABLE dashboards       ALTER COLUMN is_public SET DEFAULT FALSE;
--   ALTER TABLE widgets          ALTER COLUMN is_public SET DEFAULT FALSE;
-- COMMIT;
