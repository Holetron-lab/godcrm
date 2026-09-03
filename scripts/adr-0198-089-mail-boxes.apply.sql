-- ADR-198 T2 — hand-apply of migration 089 to godcrm_test on .72.
-- knex CLI is dead on that box (no knexfile in the tree + recorded-but-missing migration
-- files), so the DDL below is transcribed verbatim from
-- backend/database/migrations/knex/089_adr_0198_mail_boxes.js and the ledger row is written
-- by hand — same procedure used for ADR-185. NOT a substitute for the migration file.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_unique
  ON users (lower(handle)) WHERE handle IS NOT NULL;

CREATE TABLE IF NOT EXISTS mail_boxes (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address       TEXT    NOT NULL UNIQUE CHECK (address = lower(address)),
  local_part    TEXT    NOT NULL,
  domain        TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  maildir       TEXT    NOT NULL,
  quota_bytes   BIGINT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_boxes_user_id ON mail_boxes (user_id);

-- Repair path: `CREATE TABLE IF NOT EXISTS` above is a no-op on a box where an EARLIER
-- run of this file already created mail_boxes without the lowercase CHECK. Re-running the
-- file must converge on the migration's shape, not skip the constraint silently. PG has no
-- `ADD CONSTRAINT IF NOT EXISTS`, hence the guard.
DO $$
BEGIN
  -- Matched by DEFINITION, not by name: the inline `CHECK` in CREATE TABLE gets the
  -- auto-name `mail_boxes_address_check`, so a name-based guard would happily add a second,
  -- identical constraint on top of it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'mail_boxes'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%lower(address)%'
  ) THEN
    EXECUTE 'ALTER TABLE mail_boxes ADD CONSTRAINT mail_boxes_address_lower_chk CHECK (address = lower(address))';
  END IF;
END $$;

-- Grant guard — mirrors the migration, and matters precisely on THIS path: a hand-apply
-- run as a superuser leaves mail_boxes owned by `postgres` with nothing granted to the app
-- role, so every provisioning write dies with 42501. This is the trap migration 082 fell
-- into on .72 (mail_labels stayed superuser-owned). No-op when already correct.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'godcrm') THEN
    EXECUTE 'ALTER TABLE mail_boxes OWNER TO godcrm';
    EXECUTE 'ALTER SEQUENCE mail_boxes_id_seq OWNER TO godcrm';
  END IF;
END $$;

INSERT INTO _app_settings (key, value, description, created_at, updated_at)
VALUES ('mailbox_provisioning_enabled', 'false'::jsonb,
        'ADR-198 D6: auto-provisioning of a mailbox per principal (registration + passport issue). Owner flips to true after AC-2 (virtual mail substrate) is green.',
        NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO knex_migrations (name, batch, migration_time)
SELECT '089_adr_0198_mail_boxes.js', (SELECT max(batch) + 1 FROM knex_migrations), NOW()
WHERE NOT EXISTS (SELECT 1 FROM knex_migrations WHERE name = '089_adr_0198_mail_boxes.js');

COMMIT;
