-- ADR-0011 · Phase A · _verification_attempts audit log (C-3 cooldown fundament, C-9 rate-limit)
--
-- Every verify / unverify attempt writes a row here, success or failure.
-- Cooldown lookup uses the composite index below.
-- Retention / pruning is a separate concern (ADR-0011 Phase D).
--
-- Idempotent (IF NOT EXISTS).
-- Run manually on each env: `psql -d godcrm_prod -f scripts/migrations/20260422-verification-attempts.sql`

BEGIN;

CREATE TABLE IF NOT EXISTS _verification_attempts (
  id           BIGSERIAL PRIMARY KEY,
  column_id    INTEGER     NOT NULL,
  row_id       BIGINT      NOT NULL,
  user_id      INTEGER,
  method       VARCHAR(32),
  success      BOOLEAN     NOT NULL,
  error_code   VARCHAR(64),
  client_ip    INET,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_va_cooldown
  ON _verification_attempts (column_id, row_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_va_user_attempts
  ON _verification_attempts (user_id, attempted_at DESC);

COMMIT;

-- Verify
SELECT to_regclass('_verification_attempts') AS verification_attempts_table;
SELECT indexname FROM pg_indexes WHERE tablename = '_verification_attempts' ORDER BY indexname;
