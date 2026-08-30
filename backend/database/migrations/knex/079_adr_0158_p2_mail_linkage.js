// Migration 079: ADR-158 P2 — CRM linkage for the mail module.
//
// Generalizes mail_messages beyond the P1 `ticket_id` (mig 075) so any message
// can be linked to any CRM row (deal / lead / ticket / …), and adds the
// reply-token used to auto-link an inbound reply back to its outbound thread:
//
//   reply_token      — URL-safe token embedded as `[crm:<token>]` in the subject
//                      of a linked outbound message (routes/v3/mail.js send path).
//                      On inbound sync, the subject is scanned for the marker and
//                      the matching outbound row's linkage is copied onto the
//                      inbound row. Partial UNIQUE so a token resolves to one row.
//   linked_table_id  — CRM table the message is attached to (generic row link).
//   linked_row_id    — row within that table.
//
// `ticket_id` (mig 075) is kept untouched for back-compat; new linkage uses the
// generic pair. Additive-only: existing rows get NULLs, existing indexes stand.
// Ref: ADR-158 §P2 (reply-token → auto-link), doc registry 2197.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 079] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE mail_messages
      ADD COLUMN IF NOT EXISTS reply_token     TEXT,
      ADD COLUMN IF NOT EXISTS linked_table_id INTEGER,
      ADD COLUMN IF NOT EXISTS linked_row_id   INTEGER
  `);

  // A reply_token resolves to exactly one message (the outbound that minted it).
  // Partial: NULLs (the vast majority — only linked outbound rows carry a token)
  // are excluded so they never collide.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_reply_token_uq
      ON mail_messages (space_id, reply_token)
      WHERE reply_token IS NOT NULL
  `);

  // "Show me every message attached to this deal/lead/ticket row."
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mail_messages_linked_row
      ON mail_messages (space_id, linked_table_id, linked_row_id)
      WHERE linked_table_id IS NOT NULL
  `);

  console.log('[Migration 079] mail_messages: reply_token + generic linked_table_id/row_id + indexes');
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS mail_messages_reply_token_uq`);
  await knex.raw(`DROP INDEX IF EXISTS idx_mail_messages_linked_row`);
  await knex.raw(`
    ALTER TABLE mail_messages
      DROP COLUMN IF EXISTS reply_token,
      DROP COLUMN IF EXISTS linked_table_id,
      DROP COLUMN IF EXISTS linked_row_id
  `);
}
