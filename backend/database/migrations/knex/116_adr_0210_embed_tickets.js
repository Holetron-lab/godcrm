export async function up(knex) {
  const client = knex.client.config.client;
  if (client !== 'pg' && client !== 'postgresql') return;

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS embed_tickets (
      id BIGSERIAL PRIMARY KEY,
      ticket_hash CHAR(64) NOT NULL UNIQUE,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      parent_origin TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ
    )
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_embed_tickets_expiry
      ON embed_tickets (expires_at)
      WHERE consumed_at IS NULL
  `);

  await knex.raw(
    `INSERT INTO oidc_clients (
      client_id, client_secret, secret_ref, name, redirect_uris, allowed_scopes,
      allowed_origins, is_active, token_endpoint_auth_method, login_tier, space_id
    )
    SELECT ?, NULL, ?, ?, ?, ?, ?::jsonb, 0, 'client_secret_basic', 'oidc', 35
    WHERE NOT EXISTS (SELECT 1 FROM oidc_clients WHERE client_id = ?)`,
    [
      'level',
      'oidc_level_client_secret',
      'Level Admin',
      JSON.stringify(['https://sixtynine.ru/auth/social/godcrm/callback']),
      JSON.stringify(['openid', 'profile', 'email']),
      JSON.stringify(['https://admin.sixtynine.ru']),
      'level',
    ],
  );
}

export async function down(knex) {
  const client = knex.client.config.client;
  if (client !== 'pg' && client !== 'postgresql') return;

  await knex.raw('DROP TABLE IF EXISTS embed_tickets');
  await knex.raw('DELETE FROM oidc_clients WHERE client_id = ?', ['level']);
}
