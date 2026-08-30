// Migration 082: ADR-158 §P4 (ex-ADR-173 §B.1) — mail labels & rules (doc registry 2197).
//
// Adds a proper label system on top of the ADR-158 mail module. A label is a
// *tag*, not a folder move: a message keeps its `folder` (inbox/sent/…) and can
// carry any number of labels. Two tables:
//
//   mail_labels          — one row per user-defined label, per space. Carries the
//                          display bits (name/icon/color), the "show in toolbar"
//                          flag, and an auto-assign `rules` spec (JSONB, shape in
//                          services/mail/labelRules.js).
//   mail_message_labels  — message ↔ label join (many-to-many). The `source`
//                          column ('manual' | 'rule') is load-bearing: re-running
//                          a label's rule replaces only its 'rule'-sourced links
//                          and never touches a human's 'manual' tag (and v.v.).
//
// Additive, PG-only, idempotent (IF NOT EXISTS). FK to mail_messages(id)
// (BIGSERIAL, mig 075) with ON DELETE CASCADE — deleting a message or a label
// cleans up its join rows automatically.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 082] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS mail_labels (
      id              BIGSERIAL PRIMARY KEY,
      space_id        INTEGER NOT NULL,
      name            TEXT NOT NULL,
      icon            TEXT,
      color           TEXT,
      show_in_toolbar BOOLEAN NOT NULL DEFAULT false,
      rules           JSONB NOT NULL DEFAULT '{}'::jsonb,
      order_index     INTEGER NOT NULL DEFAULT 0,
      enabled         BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Rail lists all of a space's labels ordered for display.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mail_labels_space
      ON mail_labels (space_id, order_index, id)
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS mail_message_labels (
      message_id BIGINT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
      label_id   BIGINT NOT NULL REFERENCES mail_labels(id)   ON DELETE CASCADE,
      source     TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, label_id)
    )
  `);

  // Rail count badges + the messages?label=<id> filter both start from label_id.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mail_message_labels_label
      ON mail_message_labels (label_id)
  `);

  console.log('[Migration 082] mail_labels + mail_message_labels (ADR-158 §P4)');
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP TABLE IF EXISTS mail_message_labels`);
  await knex.raw(`DROP TABLE IF EXISTS mail_labels`);
}
