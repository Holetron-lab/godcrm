// Migration 068: ADR-0068 WP-E — Pinned messages.
//
// Single additive column on `messages` plus one partial index to support
// "📌 N закреплённых ▾" banner + ⋮-menu pin toggle (ticket T-159793, BE
// half of WP-E; FE is T-159794, blocked until this lands on DEV).
//
// `messages` additions:
//   - pinned_at TIMESTAMPTZ NULL → set by POST /chat/messages/:id/pin, cleared
//     by DELETE. NULL = not pinned. Used for sort (pinned_at DESC) in the
//     PinnedBanner and for the partial index that powers the soft cap check.
//
// Index:
//   - idx_messages_pinned ON (conversation_id, pinned_at DESC)
//     WHERE pinned_at IS NOT NULL
//     Partial index — only rows that ARE pinned occupy entries, so the soft
//     cap COUNT(*) and the banner list query are both index-only fetches.
//
// PG-only: dialect guard mirrors 057/059/063/066/067.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 068] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_messages_pinned
      ON messages (conversation_id, pinned_at DESC)
      WHERE pinned_at IS NOT NULL
  `);

  console.log(
    '[Migration 068] messages +1 col (pinned_at), +1 partial index idx_messages_pinned (ADR-0068 WP-E)'
  );
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_messages_pinned`);

  await knex.raw(`
    ALTER TABLE messages
      DROP COLUMN IF EXISTS pinned_at
  `);
}
