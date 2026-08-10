-- ADR-0011 Phase F follow-up: flatten nested config.verification.* → top-level.
--
-- Background: early UI (VerificationColumnSettings.tsx) persisted settings
-- under `config.verification.*` while backend consumers (guards.js,
-- verificationController.js, ttlSweeper.js) read from top-level `config.*`.
-- Effect: locks_on_statuses / guards / available_methods / required_methods
-- set via UI were invisible to enforceVerificationGuards, so the 409
-- VERIFICATION_REQUIRED path never triggered and the TOTP/CAPTCHA modal
-- never appeared.
--
-- Canonical shape is FLAT top-level (ADR-0011 §Config). The `verification`
-- nested key is reserved for the verification_settings override atom per
-- Phase E3 semantics — it must NOT appear inside a verification column's
-- own config.
--
-- The jsonb || merge is right-biased, so nested keys take precedence over
-- stale top-level defaults on conflict (correct — nested holds the real
-- user-configured values). The final `- 'verification'` drops the
-- now-redundant nested key.
--
-- Idempotent: `config ? 'verification'` skips already-flattened rows.

UPDATE table_columns
SET config = (config::jsonb || (config::jsonb -> 'verification')) - 'verification'
WHERE type = 'verification'
  AND config::jsonb ? 'verification';
