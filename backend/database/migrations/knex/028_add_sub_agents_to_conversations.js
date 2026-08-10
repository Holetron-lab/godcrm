/**
 * Migration 028: Add sub_agents to conversations (Ticket #41053)
 *
 * Sub-agents are AI agents from the AI Agents table that don't have user accounts.
 * They are tracked by their row_id from the AI Agents table.
 * A conversation can have multiple sub-agents assigned.
 *
 * sub_agents stores an array of agent row_ids or objects:
 *   [31112, 31113]
 *   or
 *   [{"row_id": 31112, "response_mode": "always"}, {"row_id": 31113, "response_mode": "on_command"}]
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  const hasSubAgents = await knex.schema.hasColumn('conversations', 'sub_agents');
  if (!hasSubAgents) {
    await knex.schema.alterTable('conversations', (table) => {
      if (isPostgres) {
        table.jsonb('sub_agents').defaultTo('[]');
      } else {
        table.text('sub_agents').defaultTo('[]');
      }
    });

    // GIN index for efficient JSONB queries on sub_agents (Postgres only)
    if (isPostgres) {
      await knex.raw(`
        CREATE INDEX idx_conversations_sub_agents ON conversations USING GIN(sub_agents);
      `);
    }
  }

  console.log('[Migration 028] Added sub_agents JSONB column to conversations');
}

export async function down(knex) {
  const hasSubAgents = await knex.schema.hasColumn('conversations', 'sub_agents');
  if (hasSubAgents) {
    // Drop GIN index first (Postgres only)
    const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
    if (isPostgres) {
      await knex.raw('DROP INDEX IF EXISTS idx_conversations_sub_agents');
    }

    await knex.schema.alterTable('conversations', (table) => {
      table.dropColumn('sub_agents');
    });
  }

  console.log('[Migration 028 DOWN] Removed sub_agents column from conversations');
}
