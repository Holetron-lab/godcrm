-- ADR-0003 Phase 6 / ticket 126417 (6.5) — extend widget 218 registry
-- status column options with 'regressed-published'.
--
-- docs are CRM logical rows (table_rows WHERE table_id=2197). The status
-- column is a CRM select column whose options live in
-- table_columns.config (jsonb-serialised text). No Postgres enum is
-- involved.
--
-- Current options (live 2026-04-20): ready, archived, draft, approved,
-- published. We append 'regressed-published' (red) only if not already
-- present — the @> containment test makes the UPDATE a no-op on re-run.
--
-- No automatic state-transition logic here; that's a follow-up ticket.
--
-- Idempotent — safe to re-run.

BEGIN;

UPDATE table_columns
SET config = jsonb_set(
      config::jsonb,
      '{options}',
      (config::jsonb -> 'options') ||
        '[{"value":"regressed-published","label":"regressed-published","color":"#ef4444"}]'::jsonb
    )::text,
    updated_at = CURRENT_TIMESTAMP
WHERE table_id = 2197
  AND column_name = 'status'
  AND NOT (
    (config::jsonb -> 'options') @> '[{"value":"regressed-published"}]'::jsonb
  );

COMMIT;
