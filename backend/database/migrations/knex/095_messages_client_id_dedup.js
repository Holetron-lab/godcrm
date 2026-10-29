// Idempotent posts on a user's behalf (chat voice notes) carry
// metadata.client_id; a retry after a timeout must not create a second row.
// The partial unique index makes INSERT ... ON CONFLICT DO NOTHING the guard.
export async function up(knex) {
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id
    ON messages (conversation_id, (metadata->>'client_id'))
    WHERE metadata->>'client_id' IS NOT NULL`);
}

export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_messages_client_id`);
}
