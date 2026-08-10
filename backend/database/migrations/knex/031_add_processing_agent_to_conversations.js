/**
 * Migration 031: Add processing_agent_id and processing_agent_name to conversations (ADR-093 Task 8)
 *
 * When an agent starts processing a conversation, we now track WHICH agent
 * is working on it, not just the boolean `is_processing` flag.
 *
 * New columns:
 *   - processing_agent_id   INTEGER  (references the agent row id in table_rows)
 *   - processing_agent_name TEXT     (denormalized agent name for quick display)
 *
 * Both columns are NULLable and default to NULL (no agent processing).
 * They are set when is_processing = 1 and cleared back to NULL when
 * is_processing = 0.
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // Add processing_agent_id column
  const hasAgentId = await knex.schema.hasColumn('conversations', 'processing_agent_id');
  if (!hasAgentId) {
    await knex.schema.alterTable('conversations', (table) => {
      table.integer('processing_agent_id').defaultTo(null);
    });
    console.log('[Migration 031] Added processing_agent_id column to conversations');
  } else {
    console.log('[Migration 031] processing_agent_id column already exists, skipping');
  }

  // Add processing_agent_name column
  const hasAgentName = await knex.schema.hasColumn('conversations', 'processing_agent_name');
  if (!hasAgentName) {
    await knex.schema.alterTable('conversations', (table) => {
      table.string('processing_agent_name', 255).defaultTo(null);
    });
    console.log('[Migration 031] Added processing_agent_name column to conversations');
  } else {
    console.log('[Migration 031] processing_agent_name column already exists, skipping');
  }

  console.log('[Migration 031] Completed: processing_agent_id and processing_agent_name added to conversations');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  if (isPostgres) {
    // PostgreSQL supports DROP COLUMN directly
    await knex.schema.alterTable('conversations', (table) => {
      table.dropColumn('processing_agent_name');
      table.dropColumn('processing_agent_id');
    });
  } else {
    // SQLite doesn't support DROP COLUMN in older versions,
    // but knex handles this via table rebuild for newer SQLite
    try {
      await knex.schema.alterTable('conversations', (table) => {
        table.dropColumn('processing_agent_name');
        table.dropColumn('processing_agent_id');
      });
    } catch (err) {
      console.warn('[Migration 031 DOWN] Could not drop columns (SQLite limitation):', err.message);
    }
  }

  console.log('[Migration 031 DOWN] Removed processing_agent_id and processing_agent_name from conversations');
}
