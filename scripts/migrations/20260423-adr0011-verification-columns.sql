-- ADR-0011 · Phase E2 · Wire two `verification` column instances
--
-- Creates:
--   1. plan_verification        on registry table 2197 (ADRs registry)
--   2. criterion_verification   on bdd_criteria (table 7256, looked up by name)
--
-- Config is the NORMALIZED output of validateVerificationConfig (so that
-- validateVerificationOverride can use it as `base` directly without
-- re-running the validator on every read).
--
-- Idempotent (WHERE NOT EXISTS).
-- Run manually on each env:
--   psql -h localhost -U godcrm -d godcrm_prod -f scripts/migrations/20260423-adr0011-verification-columns.sql
--
-- The columns themselves are inert until VERIFICATION_COLUMN_ENABLED=true on
-- the backend (Phase A flag). Cells are nullable; existing rows unaffected.

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- 1. plan_verification on registry table 2197 (ADRs)
--    policy=all + 2 methods → TOTP AND CAPTCHA both required
--    cooldown 5min, TTL 24h, row-update guard active
-- ─────────────────────────────────────────────────────────────────
INSERT INTO table_columns (
  table_id, column_name, display_name, type, config,
  order_index, is_visible, is_required, created_at, updated_at
)
SELECT 2197, 'plan_verification', 'Plan Verification', 'verification',
  '{"available_methods":["totp","captcha"],"required_methods":2,"method":"totp","cooldown_seconds":300,"cooldown_ms":300000,"ttl_seconds":86400,"ttl_ms":86400000,"locks_on_statuses":[],"unlocks_on_statuses":[],"guards":["row_update_guard"],"policy":"all","rate_limit":null,"method_config":{}}',
  100, 1, 0, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM table_columns
  WHERE table_id = 2197 AND column_name = 'plan_verification'
);

-- ─────────────────────────────────────────────────────────────────
-- 2. criterion_verification on bdd_criteria
--    Single-method TOTP, shorter cooldown (60s), same TTL+guard
--    table_id resolved by name + space_id=11 for portability across envs
-- ─────────────────────────────────────────────────────────────────
INSERT INTO table_columns (
  table_id, column_name, display_name, type, config,
  order_index, is_visible, is_required, created_at, updated_at
)
SELECT
  (SELECT ut.id FROM universal_tables ut
     JOIN projects p ON ut.project_id = p.id
     WHERE p.space_id = 11 AND ut.name = 'bdd_criteria' LIMIT 1),
  'criterion_verification', 'Criterion Verification', 'verification',
  '{"available_methods":["totp"],"required_methods":1,"method":"totp","cooldown_seconds":60,"cooldown_ms":60000,"ttl_seconds":86400,"ttl_ms":86400000,"locks_on_statuses":[],"unlocks_on_statuses":[],"guards":["row_update_guard"],"policy":"all","rate_limit":null,"method_config":{}}',
  100, 1, 0, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM table_columns
  WHERE table_id = (SELECT ut.id FROM universal_tables ut
                      JOIN projects p ON ut.project_id = p.id
                      WHERE p.space_id = 11 AND ut.name = 'bdd_criteria' LIMIT 1)
    AND column_name = 'criterion_verification'
);

COMMIT;

-- ─── Verify ─────────────────────────────────────────────────────────
SELECT id, table_id, column_name, type
FROM table_columns
WHERE column_name IN ('plan_verification', 'criterion_verification')
ORDER BY column_name;
