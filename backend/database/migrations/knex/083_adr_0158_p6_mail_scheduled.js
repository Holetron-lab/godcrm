// Migration 083: ADR-158 P6 — scheduled outbound mail (mail_outbox).
//
// Backs "отложенная отправка" for the mail composer (POST /mail/send with an
// optional `scheduledAt`). A scheduled send is NOT stored in mail_messages —
// that table keeps attachment *metadata only* (mig 081), whereas replaying a
// send later needs the full payload (recipients + body + attachment BYTES). So
// this is a dedicated queue table, exactly analogous to `scheduled_messages`
// (WP-17) for the AI-chat panel.
//
// A minute-poll worker (services/mail/scheduledWorker.js) claims `pending` rows
// whose `scheduled_at` has passed (FOR UPDATE SKIP LOCKED → no double-send),
// runs the same SMTP path as an immediate send, writes the Sent copy into
// mail_messages, and flips the row to `sent` (or `failed` with error_message).
// Ref: ADR-158 §P6, doc registry 2197.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 083] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS mail_outbox (
      id              BIGSERIAL PRIMARY KEY,
      space_id        INTEGER NOT NULL,
      connector_id    INTEGER NOT NULL REFERENCES space_connectors(id) ON DELETE CASCADE,
      to_addresses    JSONB   NOT NULL DEFAULT '[]'::jsonb,
      cc_addresses    JSONB   NOT NULL DEFAULT '[]'::jsonb,
      bcc_addresses   JSONB   NOT NULL DEFAULT '[]'::jsonb,
      subject         TEXT,
      body            TEXT,
      is_html         BOOLEAN NOT NULL DEFAULT false,
      -- Full attachment payload incl. base64 bytes (re-validated at send time by
      -- normalizeAttachments). Capped upstream by MAX_ATTACHMENTS_BYTES.
      attachments     JSONB   NOT NULL DEFAULT '[]'::jsonb,
      linked_table_id INTEGER,
      linked_row_id   INTEGER,
      scheduled_at    TIMESTAMPTZ NOT NULL,
      -- pending → sending → sent | failed | canceled
      status          TEXT    NOT NULL DEFAULT 'pending',
      error_message   TEXT,
      sent_message_id BIGINT,
      created_by      INTEGER,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Worker claim path: cheap lookup of due, still-pending rows. Partial so the
  // index stays tiny once rows terminate (sent/failed/canceled drop out).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mail_outbox_due
      ON mail_outbox (scheduled_at)
      WHERE status = 'pending'
  `);

  // Panel listing: a space's scheduled queue, soonest-first.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_mail_outbox_list
      ON mail_outbox (space_id, connector_id, scheduled_at)
  `);

  // Grant guard: knex normally runs migrations AS the app role, so the table is
  // owned by `godcrm` and inherits full privileges. But when this file is applied
  // out-of-band by a superuser (e.g. `sudo -u postgres psql`, as happens while the
  // ledger is being repaired), the table ends up owned by `postgres` and the app
  // role gets NOTHING — the worker's claim + the enqueue route then fail with
  // `permission denied for table mail_outbox` (42501). Re-hand ownership to the
  // app role so mail_outbox matches its siblings (mail_messages/mail_labels).
  // Idempotent + no-op when already correct; skipped if the role is absent.
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'godcrm') THEN
        EXECUTE 'ALTER TABLE mail_outbox OWNER TO godcrm';
        EXECUTE 'ALTER SEQUENCE mail_outbox_id_seq OWNER TO godcrm';
      END IF;
    END $$;
  `);

  console.log('[Migration 083] mail_outbox table + due/list indexes + owner grant');
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP TABLE IF EXISTS mail_outbox`);
}
