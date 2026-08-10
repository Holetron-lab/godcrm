// Migration 065: ADR-0064 WP-A — Add missing UNIQUE (user_id, setting_key)
// on user_settings.
//
// The chat-prefs personal PUT (and the legacy `spaces_order` upsert in
// routes/v3/user-settings.js) both rely on
//   INSERT … ON CONFLICT (user_id, setting_key) DO UPDATE …
// but the production schema never received the matching constraint. The
// query fails with "no unique or exclusion constraint matching the ON
// CONFLICT specification".
//
// IF NOT EXISTS guard is safe: re-runs are no-ops. The companion
// migration 064 (chat notifications hierarchy) lands the JSONB columns,
// and this one closes the upsert gap surfaced by its `personal` endpoint.

const CONSTRAINT_NAME = 'user_settings_user_key_unique';

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 065] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  // Defensive: if duplicate (user_id, setting_key) rows exist, the ADD
  // CONSTRAINT below will fail. Deduplicate keeping the most recent row
  // by id (later rows have larger ids — they were inserted later).
  await knex.raw(`
    DELETE FROM user_settings a
     USING user_settings b
     WHERE a.user_id = b.user_id
       AND a.setting_key = b.setting_key
       AND a.id < b.id
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${CONSTRAINT_NAME}'
      ) THEN
        ALTER TABLE user_settings
          ADD CONSTRAINT ${CONSTRAINT_NAME} UNIQUE (user_id, setting_key);
      END IF;
    END $$;
  `);

  console.log(`[Migration 065] user_settings UNIQUE (user_id, setting_key) ensured (${CONSTRAINT_NAME})`);
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;
  await knex.raw(`ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);
}
