// Migration 069: ADR-0069 P0 — add token_prefix / token_hash to webhooks.
//
// Splits the plaintext `webhooks.token TEXT UNIQUE NOT NULL` resolver path
// (see backend/routes/v3/webhooks.js incoming handler) into a 12-char prefix
// (indexed, plaintext, for fast filter) + SHA-256 hash (UNIQUE, authoritative
// compare). Plaintext `token` stays in place until P3 cutover — read paths
// fall back to it during the observability window. See ADR-0069 doc 160953.
//
// Connector half from the original ADR is NOT included: `space_connectors`
// (created by migration 054) has no plaintext access_token column — secrets
// live in `encrypted_payload JSONB` (AES-256-GCM via CredentialVault, ADR-0040)
// and rows are resolved by `(space_id, type_slug)`, not by token. ADR-0069
// threat model does not apply there.
//
// PG-only: dialect guard mirrors migrations 057/059/063.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 069] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE webhooks
      ADD COLUMN IF NOT EXISTS token_prefix VARCHAR(16),
      ADD COLUMN IF NOT EXISTS token_hash   CHAR(64)
  `);

  await knex.raw(`CREATE INDEX IF NOT EXISTS webhooks_token_prefix_idx ON webhooks(token_prefix)`);
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS webhooks_token_hash_idx ON webhooks(token_hash)`);

  console.log('[Migration 069] webhooks.token_prefix + token_hash columns + indexes created (ADR-0069 P0)');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS webhooks_token_hash_idx`);
  await knex.raw(`DROP INDEX IF EXISTS webhooks_token_prefix_idx`);
  await knex.raw(`ALTER TABLE webhooks DROP COLUMN IF EXISTS token_hash`);
  await knex.raw(`ALTER TABLE webhooks DROP COLUMN IF EXISTS token_prefix`);
}
