-- Migration 027: ADR-0060 P0 — Public-entity flags
-- Adds is_public BOOLEAN NOT NULL DEFAULT FALSE to projects / universal_tables /
-- dashboards / widgets so an owner can opt-in individual entities of a Public
-- Space to be served by the public /api/v3/public/* read-only surface.
--
-- Defaults must stay FALSE: no existing entity leaks until an owner explicitly
-- flips the flag.
--
-- Column-level whitelist note:
--   Per-column public exposure rides on JSON: table_columns.settings.is_public
--   (boolean, default false). That is a JSON field — NO DDL is required for it.
--   The application-layer public tree/table endpoints MUST honour this flag
--   when projecting rows so that only whitelisted cells are returned.
--
-- Note on `universal_tables`:
--   ADR-0060 §Schema referred to the table-metadata table as `_system_tables`.
--   The actual canonical name in this schema is `universal_tables` (the table
--   `tables` in `\dt` is a small lookup with 4 cols — not the metadata table).
--   This migration targets `universal_tables`, which is the correct one.
--
-- Note on `widgets`:
--   ADR-0060 §Schema asked for `(project_id, is_public)` on widgets, but the
--   widgets table has no `project_id` — it links via `dashboard_id`. The
--   composite index here is on `(dashboard_id, is_public)`, which is the
--   functional analog and the column the public endpoints will filter by.
--
-- Reversibility:
--   The matching DOWN script is in the commented block at the bottom of this
--   file. It is byte-equivalent to the inverse of UP.
--
-- Created: 2026-05-13
-- Ticket: T-152827 (table 1708)
-- ADR: 0060 (doc 152799)

BEGIN;

-- ============================================================
-- projects.is_public + index (space_id, is_public)
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_projects_space_public
  ON projects(space_id, is_public);

-- ============================================================
-- universal_tables.is_public + index (project_id, is_public)
-- ============================================================

ALTER TABLE universal_tables
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_universal_tables_project_public
  ON universal_tables(project_id, is_public);

-- ============================================================
-- dashboards.is_public + index (project_id, is_public)
-- ============================================================

ALTER TABLE dashboards
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_dashboards_project_public
  ON dashboards(project_id, is_public);

-- ============================================================
-- widgets.is_public + index (dashboard_id, is_public)
-- ============================================================

ALTER TABLE widgets
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_widgets_dashboard_public
  ON widgets(dashboard_id, is_public);

COMMIT;

-- ============================================================
-- DOWN (manual / dev only — reversible)
-- ============================================================
-- To revert this migration on a dev database, run the statements below
-- (uncomment them, or paste into psql). Do NOT run DOWN on PROD without
-- explicit owner approval — the flag is the only public-exposure gate.
--
-- BEGIN;
--   DROP INDEX IF EXISTS idx_widgets_dashboard_public;
--   ALTER TABLE widgets DROP COLUMN IF EXISTS is_public;
--
--   DROP INDEX IF EXISTS idx_dashboards_project_public;
--   ALTER TABLE dashboards DROP COLUMN IF EXISTS is_public;
--
--   DROP INDEX IF EXISTS idx_universal_tables_project_public;
--   ALTER TABLE universal_tables DROP COLUMN IF EXISTS is_public;
--
--   DROP INDEX IF EXISTS idx_projects_space_public;
--   ALTER TABLE projects DROP COLUMN IF EXISTS is_public;
-- COMMIT;
