export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 111] Non-PG dialect — skipping.'); return; }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS telegram_ramzi_profiles (
      user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      step           TEXT NOT NULL DEFAULT 'equipment'
        CONSTRAINT telegram_ramzi_profiles_step_check
        CHECK (step IN ('equipment', 'dislikes', 'allergies', 'complete')),
      equipment      TEXT,
      disliked_foods TEXT,
      allergies      TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'godcrm') THEN
        EXECUTE 'ALTER TABLE telegram_ramzi_profiles OWNER TO godcrm';
      END IF;
    END $$;
  `);
  console.log('[Migration 111] Ramzi onboarding profiles ensured');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;
  await knex.raw('DROP TABLE IF EXISTS telegram_ramzi_profiles');
  console.log('[Migration 111] Ramzi onboarding profiles dropped');
}
