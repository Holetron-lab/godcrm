// Migration 080: ADR-158 P1 — star flag for the mail module.
//
// Adds a per-message `starred` flag so the Mail UI can star/unstar a message
// (Gmail parity, ⭐). Toggled through PATCH /spaces/:id/mail/messages/:id
// ({ starred }) alongside is_read/folder. Additive-only: existing rows default
// to false, existing indexes stand.
//
// A partial index supports the "starred across folders" listing the UI needs
// (a star view is folder-agnostic), and stays tiny because only starred rows
// are indexed. Ref: ADR-158 §P1 (inbox core), doc registry 2197.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 080] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE mail_messages
      ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false
  `);

  // "Show me every starred message in this mailbox" — folder-agnostic, partial
  // so only the (few) starred rows are indexed.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mail_messages_starred
      ON mail_messages (space_id, connector_id)
      WHERE starred
  `);

  console.log('[Migration 080] mail_messages: starred flag + partial starred index');
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_mail_messages_starred`);
  await knex.raw(`ALTER TABLE mail_messages DROP COLUMN IF EXISTS starred`);
}
