/**
 * ADR-158 §P5 — persist mail attachment metadata.
 *
 * The send path (routes/v3/mail.js) forwarded attachments to nodemailer but never
 * stored them on the Sent copy, and inbound IMAP sync (services/mail/imapFetch.js)
 * dropped `parsed.attachments` entirely. So a message with an attachment showed no
 * trace of it in the reader — the "прикрепленный файл отправился, но не отображается"
 * report. This adds a metadata column both paths write and the reader renders.
 *
 * Stored shape (JSONB array), metadata only — NOT the bytes:
 *   [{ filename, contentType, size }]
 * Keeping bytes out of the row keeps the table light; download-the-bytes is a
 * later upload-then-reference enhancement (same note as the send path).
 */
export async function up(knex) {
  if (knex.client.config.client !== 'pg' && knex.client.config.client !== 'postgresql') {
    console.log('[Migration 081] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE mail_messages
      ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
}

export async function down(knex) {
  if (knex.client.config.client !== 'pg' && knex.client.config.client !== 'postgresql') return;
  await knex.raw(`ALTER TABLE mail_messages DROP COLUMN IF EXISTS attachments`);
}
