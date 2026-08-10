// Migration 067: ADR-0068 WP-B — Comment-thread child chats + channel-style
// readonly + send-as-space persona.
//
// Single additive migration backing the BE work-package locked in chat on
// 2026-05-19 (ticket T-159008). All columns are nullable or have safe defaults
// — zero impact on existing rows or the 5 prior chat migrations
// (019/027/028/031/038/042). Idempotent via ADD COLUMN IF NOT EXISTS so the
// same migration can be re-applied across DEV/PROD without a fresh-DB carve.
//
// `conversations` additions:
//   - parent_conversation_id BIGINT  → the parent this chat comments on. NULL
//     for ordinary chats. Indexed for parent→child fan-out.
//   - purpose TEXT                   → 'comments' marks a live comment-thread;
//     'comments_archived' marks one whose parent was deleted (cascade-archive
//     contract). NULL for ordinary chats. Partial UNIQUE index on
//     (parent_conversation_id, purpose) WHERE purpose IS NOT NULL ensures
//     idempotency of POST /conversations/:id/comment-thread — calling it twice
//     returns the same child rather than creating duplicates.
//   - is_readonly BOOLEAN NOT NULL DEFAULT false → channel-style lock. When
//     true, non-owners are blocked from sending; messageController returns 403
//     with a redirect-hint to the comment-thread child if one exists. Child
//     conversations themselves are always writable regardless of this flag on
//     the parent.
//
// `messages` additions:
//   - sender_kind TEXT NOT NULL DEFAULT 'user' → persona discriminator
//     (user|space|agent). Distinct from the legacy `sender_type`
//     (human|agent|system) which encodes *user category*. sender_kind encodes
//     *display persona*: a real user can post AS a space (sender_kind='space',
//     sender_space_id=N) while sender_user_id retains the real actor for audit
//     and edit-permission checks. Existing rows backfill to 'user' on default.
//   - sender_space_id BIGINT       → space persona payload. NULL unless
//     sender_kind='space'. No FK — projects/spaces table is `projects` and we
//     keep this column loose-typed for cross-table moves (same convention as
//     bound_table_id/bound_row_id on conversations).
//
// Cascade-on-parent-delete is enforced in conversationCrudController (not in
// SQL FK) — see ADR-0068 §B Cascade: "DO NOT cascade-delete child or child's
// messages. Mark child purpose='comments_archived' and null
// parent_conversation_id." The lack of a FK is intentional — preserving an
// orphaned but archived thread is the safety contract.
//
// PG-only: dialect guard mirrors 057/059/063/066.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 067] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS parent_conversation_id BIGINT,
      ADD COLUMN IF NOT EXISTS purpose                TEXT,
      ADD COLUMN IF NOT EXISTS is_readonly            BOOLEAN NOT NULL DEFAULT false
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_conversations_parent
      ON conversations (parent_conversation_id)
      WHERE parent_conversation_id IS NOT NULL
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_parent_purpose
      ON conversations (parent_conversation_id, purpose)
      WHERE purpose IS NOT NULL AND parent_conversation_id IS NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS sender_kind     TEXT NOT NULL DEFAULT 'user',
      ADD COLUMN IF NOT EXISTS sender_space_id BIGINT
  `);

  console.log(
    '[Migration 067] conversations +3 cols (parent_conversation_id, purpose, is_readonly), messages +2 cols (sender_kind, sender_space_id), +2 indexes (ADR-0068 WP-B)'
  );
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_conversations_parent_purpose`);
  await knex.raw(`DROP INDEX IF EXISTS idx_conversations_parent`);

  await knex.raw(`
    ALTER TABLE messages
      DROP COLUMN IF EXISTS sender_space_id,
      DROP COLUMN IF EXISTS sender_kind
  `);

  await knex.raw(`
    ALTER TABLE conversations
      DROP COLUMN IF EXISTS is_readonly,
      DROP COLUMN IF EXISTS purpose,
      DROP COLUMN IF EXISTS parent_conversation_id
  `);
}
