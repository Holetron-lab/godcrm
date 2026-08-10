/**
 * Migration 042: Add summary columns to conversations
 *
 * Adds single-summary-per-conversation model:
 * - summary: TEXT — current summary text (overwritten each time)
 * - summary_message_id: INTEGER — FK to the message containing this summary
 *
 * Old summaries are accessible via the message history (summary_message_id links).
 * The conversation_summaries table remains for backward compatibility but
 * the primary source of truth is now conversations.summary.
 */

export async function up(knex) {
  const hasSummaryCol = await knex.schema.hasColumn('conversations', 'summary');
  if (!hasSummaryCol) {
    await knex.schema.alterTable('conversations', (table) => {
      table.text('summary');                              // Current summary text
      table.integer('summary_message_id')                 // FK to message with summary
        .references('id')
        .inTable('messages')
        .onDelete('SET NULL');
    });
  }

  console.log('[Migration 042] Added summary + summary_message_id to conversations');
}

export async function down(knex) {
  const hasSummaryCol = await knex.schema.hasColumn('conversations', 'summary');
  if (hasSummaryCol) {
    await knex.schema.alterTable('conversations', (table) => {
      table.dropColumn('summary');
      table.dropColumn('summary_message_id');
    });
  }

  console.log('[Migration 042 DOWN] Removed summary columns from conversations');
}
