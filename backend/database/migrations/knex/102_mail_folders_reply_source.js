// Local folders must not change the IMAP identity used by re-sync/downloads.
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS mail_folders (
      id BIGSERIAL PRIMARY KEY,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      deleted BOOLEAN NOT NULL DEFAULT false,
      UNIQUE (space_id, key)
    );
    ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
    ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS imap_folder TEXT;
    ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS imap_uid_validity TEXT;
    UPDATE mail_messages SET imap_folder = folder WHERE imap_uid IS NOT NULL AND imap_folder IS NULL;
    DROP INDEX IF EXISTS mail_messages_sync_uq;
    CREATE UNIQUE INDEX mail_messages_sync_uq ON mail_messages (connector_id, imap_folder, imap_uid);
    ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS in_reply_to_id BIGINT REFERENCES mail_messages(id) ON DELETE SET NULL;
    ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS message_id TEXT;
    ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
  `);
}

export async function down(knex) {
  // Retain attachment bytes/files. Refuse rollback if old folder identity collides.
  await knex.raw(`
    DROP INDEX IF EXISTS mail_messages_sync_uq;
    CREATE UNIQUE INDEX mail_messages_sync_uq ON mail_messages (connector_id, folder, imap_uid);
    ALTER TABLE mail_outbox DROP COLUMN IF EXISTS in_reply_to_id, DROP COLUMN IF EXISTS project_id, DROP COLUMN IF EXISTS message_id;
    ALTER TABLE mail_messages DROP COLUMN IF EXISTS replied_at, DROP COLUMN IF EXISTS imap_folder,
      DROP COLUMN IF EXISTS imap_uid_validity;
    UPDATE mail_messages SET folder = 'inbox' WHERE folder NOT IN ('inbox', 'sent', 'drafts', 'archive', 'trash');
    DROP TABLE IF EXISTS mail_folders;
  `);
}
