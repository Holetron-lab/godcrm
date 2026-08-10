/**
 * Migration 030: Add agent_response_mode to conversation_participants
 * ADR-091 Phase 2 Task 7 / Ticket #41160 (AC14)
 *
 * Adds per-conversation response_mode override for agent participants.
 * NULL means "use global default from the agent's AI Agents table row config".
 *
 * Resolution priority (implemented in ResponseModeService.resolveResponseMode):
 *   1. conversation_participants.agent_response_mode (this column)
 *   2. sub_agents JSONB response_mode (migration-period backward compat)
 *   3. AI Agents table row data.response_mode (global agent config)
 *   4. Default: 'mention_only'
 *
 * Valid values: 'always' | 'topic_only' | 'mention_only' | NULL
 */

export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('conversation_participants', 'agent_response_mode');

  if (!hasColumn) {
    await knex.schema.alterTable('conversation_participants', (table) => {
      // NULL means "inherit from global agent config"
      table.text('agent_response_mode').defaultTo(null);
    });

    console.log('[Migration 030] Added agent_response_mode column to conversation_participants');
  } else {
    console.log('[Migration 030] agent_response_mode column already exists on conversation_participants, skipping');
  }
}

export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('conversation_participants', 'agent_response_mode');

  if (hasColumn) {
    await knex.schema.alterTable('conversation_participants', (table) => {
      table.dropColumn('agent_response_mode');
    });
    console.log('[Migration 030 DOWN] Removed agent_response_mode column from conversation_participants');
  }
}
