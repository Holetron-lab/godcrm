/**
 * Migration 039: Add tool approval rules table and approval columns to messages
 *
 * Ticket #74072: Tool Approval Flow — DB Migration
 *
 * Creates a `tool_approval_rules` table that stores per-tool approval
 * configuration (risk level, whether approval is required, which agents
 * can auto-approve, timeout).
 *
 * Also adds `approval_status`, `approved_by`, and `approved_at` columns
 * to the `messages` table so that tool_call messages can carry inline
 * approval state (matching the pattern used by TerminalService).
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // ========================================
  // TOOL_APPROVAL_RULES TABLE
  // ========================================
  await knex.schema.createTable('tool_approval_rules', (table) => {
    table.increments('id').primary();
    table.string('tool_name', 255).notNullable();        // e.g. 'write_file', 'delete_row', '*'
    table.string('tool_pattern', 255);                    // glob pattern e.g. 'delete_*', 'mcp__*'
    table.string('risk_level', 20).defaultTo('medium');   // 'safe', 'medium', 'dangerous'
    table.boolean('requires_approval').defaultTo(true);

    // Agents that skip approval for this tool (stored as integer array)
    if (isPostgres) {
      table.specificType('auto_approve_for_agent_ids', 'INTEGER[]');
    } else {
      table.text('auto_approve_for_agent_ids'); // JSON string in SQLite
    }

    table.integer('timeout_seconds').defaultTo(300);      // 5 min default
    table.integer('created_by')
      .references('id').inTable('users');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // CHECK constraint on risk_level (Postgres only)
  if (isPostgres) {
    await knex.raw(`
      ALTER TABLE tool_approval_rules
        ADD CONSTRAINT chk_tool_approval_risk_level
        CHECK (risk_level IN ('safe', 'medium', 'dangerous'))
    `);
  }

  // Indexes
  await knex.schema.alterTable('tool_approval_rules', (table) => {
    table.index('tool_name', 'idx_tool_approval_rules_tool_name');
    table.index('risk_level', 'idx_tool_approval_rules_risk_level');
  });

  // ========================================
  // DEFAULT RULES: dangerous tools that need approval
  // ========================================
  const defaultRules = [
    { tool_name: 'write_file', risk_level: 'dangerous', requires_approval: true },
    { tool_name: 'delete_row', risk_level: 'dangerous', requires_approval: true },
    { tool_name: 'delete_rows', risk_level: 'dangerous', requires_approval: true },
    { tool_name: 'execute_sql', risk_level: 'dangerous', requires_approval: true },
    { tool_name: 'run_migration', risk_level: 'dangerous', requires_approval: true },
  ];

  for (const rule of defaultRules) {
    await knex('tool_approval_rules').insert(rule);
  }

  // ========================================
  // ADD APPROVAL COLUMNS TO MESSAGES TABLE
  // ========================================
  const hasApprovalStatus = await knex.schema.hasColumn('messages', 'approval_status');
  if (!hasApprovalStatus) {
    await knex.schema.alterTable('messages', (table) => {
      table.string('approval_status', 20);   // null, 'pending', 'approved', 'rejected'
      table.integer('approved_by')
        .references('id').inTable('users');
      table.timestamp('approved_at');
    });

    // Index for fast pending approval lookups
    await knex.schema.alterTable('messages', (table) => {
      table.index('approval_status', 'idx_messages_approval_status');
    });
  }

  console.log('[Migration 039] Created tool_approval_rules table and added approval columns to messages');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // Drop CHECK constraint (Postgres only)
  if (isPostgres) {
    await knex.raw('ALTER TABLE tool_approval_rules DROP CONSTRAINT IF EXISTS chk_tool_approval_risk_level');
  }

  // Drop the tool_approval_rules table
  await knex.schema.dropTableIfExists('tool_approval_rules');

  // Remove approval columns from messages
  const hasApprovalStatus = await knex.schema.hasColumn('messages', 'approval_status');
  if (hasApprovalStatus) {
    await knex.schema.alterTable('messages', (table) => {
      table.dropIndex('approval_status', 'idx_messages_approval_status');
    });
    await knex.schema.alterTable('messages', (table) => {
      table.dropColumn('approved_at');
      table.dropColumn('approved_by');
      table.dropColumn('approval_status');
    });
  }

  console.log('[Migration 039 DOWN] Dropped tool_approval_rules table and approval columns from messages');
}
