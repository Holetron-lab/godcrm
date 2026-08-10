-- ADR-0003 §C-1 — enable BDD companion panel on widget 218 (ADRs).
-- Flag is read by src/components/bdd/BddCompanionPanel.tsx via
-- DocumentsWidgetConfig.bdd_enabled; only affects frontend rendering.
--
-- Run when ready to roll C-1 to prod:
--   PGPASSWORD=... psql -h localhost -U godcrm -d godcrm_prod \
--     -f scripts/adr-0003-c1-enable-bdd-widget-218.sql

UPDATE widgets
SET config = (config::jsonb || jsonb_build_object('bdd_enabled', true))::text,
    updated_at = NOW()
WHERE id = 218
  AND COALESCE((config::jsonb)->>'bdd_enabled', 'false') <> 'true';

SELECT id, title, (config::jsonb)->>'bdd_enabled' AS bdd_enabled
FROM widgets
WHERE id = 218;
