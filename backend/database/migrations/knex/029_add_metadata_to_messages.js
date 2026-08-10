/**
 * Migration 029: Add metadata JSONB column to messages (Ticket #41055)
 *
 * The metadata column stores supplementary information that doesn't warrant
 * its own dedicated column, such as:
 * - agent_name: display name of the AI agent that generated the message
 * - agent_icon: emoji/icon for the agent avatar
 * - agent_row_id: row_id in the AI Agents table (denormalized for fast reads)
 *
 * This is backward compatible — existing messages simply have NULL metadata
 * and the resolveAgentInfoForMessages() function falls back to looking up
 * agent info from the agent_id → table_rows join.
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  const hasMetadata = await knex.schema.hasColumn('messages', 'metadata');
  if (!hasMetadata) {
    await knex.schema.alterTable('messages', (table) => {
      if (isPostgres) {
        table.jsonb('metadata').defaultTo('{}');
      } else {
        table.text('metadata').defaultTo('{}');
      }
    });

    console.log('[Migration 029] Added metadata JSONB column to messages');
  } else {
    console.log('[Migration 029] metadata column already exists on messages, skipping');
  }
}

export async function down(knex) {
  const hasMetadata = await knex.schema.hasColumn('messages', 'metadata');
  if (hasMetadata) {
    await knex.schema.alterTable('messages', (table) => {
      table.dropColumn('metadata');
    });
    console.log('[Migration 029 DOWN] Removed metadata column from messages');
  }
}
