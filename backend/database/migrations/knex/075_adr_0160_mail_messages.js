// Migration 075: ADR-160 — Mail module message store (the bridge slice).
//
// Persists messages fetched from an IMAP mailbox (via the `imap` connector,
// mig 074 identity) so the Mail UI reads `/api/v3/mail/*` over a real table
// instead of MOCK_MESSAGES. The row shape mirrors the frontend `MailMessage`
// type (src/features/mail/types.ts) plus the sync bookkeeping the UI never sees
// (which connector/folder it came from, the IMAP UID for idempotent re-sync,
// and the RFC822 Message-ID for threading).
//
// Idempotent sync key: UNIQUE (connector_id, folder, imap_uid). A re-sync
// re-inserts the same UIDs and ON CONFLICT updates flags/preview in place — no
// duplicates. `imap_uid` is nullable (a locally-composed Sent row exists before
// it is ever assigned a server UID); Postgres treats NULLs as distinct in a
// UNIQUE, so those rows never collide.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 075] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS mail_messages (
      id            BIGSERIAL PRIMARY KEY,
      space_id      INTEGER NOT NULL,
      connector_id  INTEGER NOT NULL REFERENCES space_connectors(id) ON DELETE CASCADE,
      folder        TEXT    NOT NULL DEFAULT 'inbox',
      imap_uid      BIGINT,
      message_id    TEXT,
      from_name     TEXT,
      from_address  TEXT,
      to_addresses  JSONB   NOT NULL DEFAULT '[]'::jsonb,
      subject       TEXT,
      preview       TEXT,
      body_text     TEXT,
      body_html     TEXT,
      date          TIMESTAMPTZ,
      is_read       BOOLEAN NOT NULL DEFAULT false,
      ticket_id     INTEGER,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Idempotent re-sync dedup key (NULL imap_uid rows never collide).
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_sync_uq
      ON mail_messages (connector_id, folder, imap_uid)
  `);

  // Folder listing, newest-first.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mail_messages_list
      ON mail_messages (space_id, connector_id, folder, date DESC)
  `);

  // ADR-158 reply-matching: resolve an inbound message back to its ticket.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mail_messages_ticket
      ON mail_messages (space_id, ticket_id)
      WHERE ticket_id IS NOT NULL
  `);

  console.log('[Migration 075] mail_messages table + sync/list/ticket indexes created');
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP TABLE IF EXISTS mail_messages`);
}
