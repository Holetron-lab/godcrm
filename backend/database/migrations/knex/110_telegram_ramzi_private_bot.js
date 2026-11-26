export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 110] Non-PG dialect — skipping.'); return; }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS telegram_ramzi_updates (
      id         BIGSERIAL PRIMARY KEY,
      update_id  BIGINT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS telegram_ramzi_bindings (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      code_hash  TEXT NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS conversations_telegram_ramzi_chat_unique
      ON conversations (((settings::jsonb)->>'telegram_ramzi_chat_id'))
      WHERE ((settings::jsonb)->>'telegram_ramzi_chat_id') IS NOT NULL
  `);
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'godcrm') THEN
        EXECUTE 'ALTER TABLE telegram_ramzi_updates OWNER TO godcrm';
        EXECUTE 'ALTER SEQUENCE telegram_ramzi_updates_id_seq OWNER TO godcrm';
        EXECUTE 'ALTER TABLE telegram_ramzi_bindings OWNER TO godcrm';
        EXECUTE 'ALTER SEQUENCE telegram_ramzi_bindings_id_seq OWNER TO godcrm';
      END IF;
    END $$;
  `);
  console.log('[Migration 110] private Ramzi Telegram bot storage ensured');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;
  await knex.raw('DROP INDEX IF EXISTS conversations_telegram_ramzi_chat_unique');
  await knex.raw('DROP TABLE IF EXISTS telegram_ramzi_bindings');
  await knex.raw('DROP TABLE IF EXISTS telegram_ramzi_updates');
  console.log('[Migration 110] private Ramzi Telegram bot storage dropped');
}
