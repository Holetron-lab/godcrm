/**
 * Migration 038: Add base_id to conversations table
 *
 * The AgentWorkerService (ADR-104) generates a unique base_id when creating
 * ticket-bound conversations. Without this column the INSERT fails with:
 *
 *   Error: column "base_id" of relation "conversations" does not exist
 *
 * This blocks ALL agent-dispatched ticket execution.
 *
 * The column is TEXT and nullable (only ticket_chat conversations use it).
 */

export async function up(knex) {
  const hasBaseId = await knex.schema.hasColumn('conversations', 'base_id');
  if (!hasBaseId) {
    await knex.schema.alterTable('conversations', (table) => {
      table.text('base_id');
    });
    console.log('[Migration 038] Added base_id column to conversations');
  } else {
    console.log('[Migration 038] base_id column already exists on conversations, skipping');
  }
}

export async function down(knex) {
  const hasBaseId = await knex.schema.hasColumn('conversations', 'base_id');
  if (hasBaseId) {
    await knex.schema.alterTable('conversations', (table) => {
      table.dropColumn('base_id');
    });
    console.log('[Migration 038 DOWN] Removed base_id column from conversations');
  }
}
