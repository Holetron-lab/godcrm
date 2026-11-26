export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 113] Non-PG dialect — skipping.'); return; }

  await knex.raw(`
    ALTER TABLE telegram_ramzi_profiles
      ADD COLUMN IF NOT EXISTS photo_opt_in BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS last_dish TEXT
  `);
  console.log('[Migration 113] Ramzi recipe media fields ensured');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`
    ALTER TABLE telegram_ramzi_profiles
      DROP COLUMN IF EXISTS photo_opt_in,
      DROP COLUMN IF EXISTS last_dish
  `);
  console.log('[Migration 113] Ramzi recipe media fields rolled back');
}
