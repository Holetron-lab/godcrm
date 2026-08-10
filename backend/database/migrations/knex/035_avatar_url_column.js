// ADR-099: Avatar Upload via File API
// Ensure users.avatar column is TEXT type for URL/base64 storage
// Note: Column may already be TEXT in production (was changed from VARCHAR(500) before this migration)
export async function up(knex) {
  const client = knex.client.config.client;

  if (client === 'pg' || client === 'postgresql') {
    // Idempotent: ALTER to TEXT even if already TEXT
    await knex.raw('ALTER TABLE users ALTER COLUMN avatar TYPE TEXT');
  }
  // SQLite: TEXT is the default string type, no change needed
}

export async function down(knex) {
  // No-op: we don't want to shrink back to VARCHAR(500) and lose data
}
