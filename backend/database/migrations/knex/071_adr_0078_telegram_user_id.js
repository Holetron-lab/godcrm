// Migration 071: ADR-0078 — Sign-in with Telegram (OIDC).
export async function up(knex) {
  const isPg = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPg) { console.log('[Migration 071] Non-PG — skipping.'); return; }
  await knex.raw('ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT');
  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_user_id ' +
    'ON users (telegram_user_id) WHERE telegram_user_id IS NOT NULL'
  );
  console.log('[Migration 071] users +telegram_user_id BIGINT +partial UNIQUE (ADR-0078)');
}
export async function down(knex) {
  const isPg = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPg) return;
  await knex.raw('DROP INDEX IF EXISTS idx_users_telegram_user_id');
  await knex.raw('ALTER TABLE users DROP COLUMN IF EXISTS telegram_user_id');
}
