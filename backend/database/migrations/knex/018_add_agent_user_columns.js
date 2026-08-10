/**
 * Migration: Add Agent-as-User columns to users table
 * ADR-023: Agent-as-User & Infinite Chat Architecture
 * 
 * Adds support for AI agents as users:
 * - user_type: 'human' | 'agent' | 'bot' | 'service'
 * - managed_by_agent_table_id: Reference to universal_tables.id containing the agent
 * - managed_by_agent_row_id: Reference to table_rows.id (the agent row)
 * - agent_config: JSONB configuration for agent behavior
 */

export async function up(knex) {
  // Check if columns already exist
  const hasUserType = await knex.schema.hasColumn('users', 'user_type');
  
  if (!hasUserType) {
    await knex.schema.alterTable('users', (table) => {
      // User type: human (default), agent, bot, service
      table.string('user_type', 50).defaultTo('human');
      
      // Reference to the agent configuration in universal tables
      table.integer('managed_by_agent_table_id').nullable();
      table.integer('managed_by_agent_row_id').nullable();
      
      // JSON configuration for agent-specific settings
      table.jsonb('agent_config').nullable();
      
      // Index for efficient agent queries
      table.index(['user_type'], 'users_user_type_index');
      table.index(['managed_by_agent_table_id', 'managed_by_agent_row_id'], 'users_agent_ref_index');
    });
    
    console.log('✅ Added agent-user columns to users table');
  } else {
    console.log('ℹ️ Agent-user columns already exist in users table');
  }
}

export async function down(knex) {
  const hasUserType = await knex.schema.hasColumn('users', 'user_type');
  
  if (hasUserType) {
    await knex.schema.alterTable('users', (table) => {
      table.dropIndex([], 'users_user_type_index');
      table.dropIndex([], 'users_agent_ref_index');
      
      table.dropColumn('user_type');
      table.dropColumn('managed_by_agent_table_id');
      table.dropColumn('managed_by_agent_row_id');
      table.dropColumn('agent_config');
    });
    
    console.log('✅ Removed agent-user columns from users table');
  }
}
