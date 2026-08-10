-- Rollback for phase6-6.4-users-totp-secret.sql.
-- WARNING: drops the column and all enrolled secrets. Any user with TOTP
-- enabled will need to re-enroll after rollback.
ALTER TABLE users DROP COLUMN IF EXISTS totp_secret;
