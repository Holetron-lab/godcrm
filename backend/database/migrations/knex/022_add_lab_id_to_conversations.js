/**
 * Migration 022: Add lab_id to conversations (ADR-043)
 * 
 * Enables Labs (MindWorkflow) to have their own chat conversations
 * that are filtered by lab_id.
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // Add lab_id column to conversations
  const hasLabId = await knex.schema.hasColumn('conversations', 'lab_id');
  if (!hasLabId) {
    await knex.schema.alterTable('conversations', (table) => {
      table.string('lab_id', 255).nullable();
    });

    // Create index for lab_id
    await knex.schema.alterTable('conversations', (table) => {
      table.index('lab_id', 'idx_conversations_lab_id');
    });
  }

  // Add last_read_at column to conversation_participants (used in chat.js)
  const hasLastReadAt = await knex.schema.hasColumn('conversation_participants', 'last_read_at');
  if (!hasLastReadAt) {
    await knex.schema.alterTable('conversation_participants', (table) => {
      table.timestamp('last_read_at').nullable();
    });
  }
}

export async function down(knex) {
  // Remove index first
  const hasLabIdIndex = await knex.schema.hasColumn('conversations', 'lab_id');
  if (hasLabIdIndex) {
    await knex.schema.alterTable('conversations', (table) => {
      table.dropIndex('lab_id', 'idx_conversations_lab_id');
    });
  }

  // Remove lab_id column
  const hasLabId = await knex.schema.hasColumn('conversations', 'lab_id');
  if (hasLabId) {
    await knex.schema.alterTable('conversations', (table) => {
      table.dropColumn('lab_id');
    });
  }

  // Remove last_read_at column
  const hasLastReadAt = await knex.schema.hasColumn('conversation_participants', 'last_read_at');
  if (hasLastReadAt) {
    await knex.schema.alterTable('conversation_participants', (table) => {
      table.dropColumn('last_read_at');
    });
  }
}
