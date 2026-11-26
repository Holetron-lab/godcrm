export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 108] Non-PG dialect — skipping.'); return; }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS module_installs (
      id           SERIAL PRIMARY KEY,
      module_key   TEXT    NOT NULL,
      version      TEXT    NOT NULL,
      space_id     INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      installed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      access_level TEXT    NOT NULL DEFAULT 'member'
                   CHECK (access_level IN ('owner', 'admin', 'member', 'viewer')),
      bindings     JSONB,
      installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS module_installs_key_space_unique
      ON module_installs (module_key, space_id)
  `);
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'godcrm') THEN
        EXECUTE 'ALTER TABLE module_installs OWNER TO godcrm';
        EXECUTE 'ALTER SEQUENCE module_installs_id_seq OWNER TO godcrm';
      END IF;
    END $$;
  `);
  console.log('[Migration 108] module_installs ensured — ADR-207 W1.5');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;
  await knex.raw('DROP TABLE IF EXISTS module_installs');
  console.log('[Migration 108] module_installs dropped');
}
