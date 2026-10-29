// Migration 092: reconcile conversation_summaries with the shape the code already writes.
//
// This is not a new feature — it repairs a schema/code split that has been live
// and silently broken.
//
// What is on the boxes today:
//   id, conversation_id, summary, message_range_start, message_range_end,
//   tokens_saved, created_at
//
// What backend/services/chatChunkingService.js reads and writes (every call
// site, not a branch):
//   chunk_number, messages_start_id, messages_end_id, messages_count,
//   summary_model, embedding, embedding_model
//     — saveChunkSummary() INSERT at chatChunkingService.js:245
//     — getSummarizedCount() SUM(messages_count) at :167
//     — getNextChunkNumber() ORDER BY chunk_number at :213
//     — searchSummariesByEmbedding() SELECT embedding at :377
//
// Migrations 020 (create) and 040 (embedding) declare the second shape and are
// both recorded in knex_migrations — but the table pre-dates the knex chain and
// was baselined over, so neither ever ran against it. Result: every summarize
// call raises `column "chunk_number" does not exist`, the error is swallowed by
// the caller, and conversation_summaries holds 0 rows on master A. The feature
// has never once persisted anything. 15 of the recorded test failures are this.
//
// The reconciliation is safe precisely because it has never worked: the table is
// empty, so there is no data to migrate and no back-compat window to hold open.
// The migration still refuses to run if that stops being true on some box —
// losing rows silently would be worse than an aborted deploy.
//
// The legacy columns are dropped rather than kept: nothing in backend/ or src/
// reads message_range_start / message_range_end / tokens_saved. The only
// references were deploy/selfhost/schema.sql (regenerated alongside this) and
// backend/routes/v3/__tests__/conversation-summaries-schema.test.js, which
// asserted the dead shape and is updated in the same commit.

const LEGACY_COLUMNS = ['message_range_start', 'message_range_end', 'tokens_saved'];

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  const hasChunkNumber = await knex.schema.hasColumn('conversation_summaries', 'chunk_number');
  if (hasChunkNumber) return; // already reconciled (fresh box built from 020)

  const [{ n }] = await knex('conversation_summaries').count({ n: '*' });
  if (Number(n) > 0) {
    throw new Error(
      `[092_reconcile_conversation_summaries] table holds ${n} rows in the legacy shape. ` +
        'This migration assumes it is empty (the writer has never succeeded against this ' +
        'schema). Back the rows up and map message_range_start/end onto ' +
        'messages_start_id/messages_end_id by hand before re-running.'
    );
  }

  await knex.schema.alterTable('conversation_summaries', (table) => {
    table.integer('chunk_number');
    table.integer('messages_start_id');
    table.integer('messages_end_id');
    table.integer('messages_count');
    table.string('summary_model', 100);
    if (isPostgres) {
      table.jsonb('embedding').nullable();
    } else {
      table.text('embedding').nullable();
    }
    table.string('embedding_model', 100).nullable();
  });

  // NOT NULL is applied after the add so the statement is valid on a table that
  // (per the guard above) has no rows to default.
  await knex.schema.alterTable('conversation_summaries', (table) => {
    table.integer('chunk_number').notNullable().alter();
    table.integer('messages_start_id').notNullable().alter();
    table.integer('messages_end_id').notNullable().alter();
    table.integer('messages_count').notNullable().alter();
  });

  // 020's contract: one summary per (conversation, chunk).
  await knex.schema.alterTable('conversation_summaries', (table) => {
    table.unique(['conversation_id', 'chunk_number'], {
      indexName: 'conversation_summaries_conversation_id_chunk_number_unique'
    });
  });

  for (const col of LEGACY_COLUMNS) {
    if (await knex.schema.hasColumn('conversation_summaries', col)) {
      await knex.schema.alterTable('conversation_summaries', (table) => {
        table.dropColumn(col);
      });
    }
  }
}

export async function down(knex) {
  const hasChunkNumber = await knex.schema.hasColumn('conversation_summaries', 'chunk_number');
  if (!hasChunkNumber) return;

  await knex.schema.alterTable('conversation_summaries', (table) => {
    table.integer('message_range_start');
    table.integer('message_range_end');
    table.integer('tokens_saved').defaultTo(0);
  });

  await knex.schema.alterTable('conversation_summaries', (table) => {
    table.dropUnique(
      ['conversation_id', 'chunk_number'],
      'conversation_summaries_conversation_id_chunk_number_unique'
    );
    table.dropColumn('chunk_number');
    table.dropColumn('messages_start_id');
    table.dropColumn('messages_end_id');
    table.dropColumn('messages_count');
    table.dropColumn('summary_model');
    table.dropColumn('embedding');
    table.dropColumn('embedding_model');
  });
}
