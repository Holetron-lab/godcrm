// Migration 091: ADR-200 W2 — `module_installations`, the one new physical table in the
// whole ADR ("everything else is data").
//
// Why physical and not a logical universal_tables entity: the installer writes
// universal_tables / table_columns / table_rows and the installation record in ONE
// transaction (AC#1). A logical table could ride that transaction too, but paying jsonb
// indirection for a system journal buys nothing.
//
// `blueprint` is stored VERBATIM as installed — that is what makes uninstall/purge able to
// name the module's own tables later, and what `blueprint_sha256` pins (same role as
// ADR-192's `bundle_sha256`, so a listing and an installation compare on the same axis).
//
// UNIQUE (module_key, space_id): one installation of a module per space. It intentionally
// spans `removed` rows as well — reinstalling flips the same row back to `active` through
// ON CONFLICT, so the install history of a module in a space stays one row, not N.
//
// Idempotent throughout; knex wraps each migration in a transaction.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 091] Non-PG dialect — skipping (PG-only feature).'); return; }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS module_installations (
      id               SERIAL PRIMARY KEY,
      module_key       TEXT    NOT NULL,
      version          TEXT    NOT NULL,
      space_id         INTEGER NOT NULL REFERENCES spaces(id)   ON DELETE CASCADE,
      project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      blueprint        JSONB   NOT NULL,
      blueprint_sha256 TEXT    NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'disabled', 'removed')),
      installed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      installed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS module_installations_key_space_unique
      ON module_installations (module_key, space_id)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_module_installations_space
      ON module_installations (space_id) WHERE status = 'active'
  `);

  // Owner guard, same reason as migrations 083/089: applied out-of-band by a superuser
  // (the standing path on .72, where the knex CLI is dead) the table lands owned by
  // `postgres` and the app role gets 42501 on first install. No-op when already correct.
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'godcrm') THEN
        EXECUTE 'ALTER TABLE module_installations OWNER TO godcrm';
        EXECUTE 'ALTER SEQUENCE module_installations_id_seq OWNER TO godcrm';
      END IF;
    END $$;
  `);

  console.log('[Migration 091] module_installations ensured — ADR-200 W2');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP TABLE IF EXISTS module_installations`);
  console.log('[Migration 091] module_installations dropped');
}
