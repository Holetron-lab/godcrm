-- ADR-0003 Phase 6 / ticket 126416 (6.4) — users.totp_secret column.
--
-- Column required for TOTP-signed verify (C-4 / criterion 126373). Scope
-- is schema only — crypto/enrollment/verify endpoints are separate tickets
-- (126391 etc.). The column stays backend-internal: it must NOT be
-- included in any existing user-listing API response.
--
-- Note: on some deployments this column already exists from an earlier
-- iteration (ADR-156 iter-5 TOTP work). ADD COLUMN IF NOT EXISTS makes
-- this migration a no-op in that case.
--
-- Idempotent — safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
