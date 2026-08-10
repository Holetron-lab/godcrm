/**
 * Migration 021: Create Labs Tables (ADR-043)
 * 
 * Laboratories feature for AI workflow management.
 * Creates tables for:
 * - labs_projects: Lab project configurations
 * - labs_nodes: Workflow nodes (AI agents, tools, etc.)
 * - labs_edges: Connections between nodes
 * - labs_ai_templates: Reusable AI workflow templates
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // ========================================
  // LABS_PROJECTS TABLE
  // ========================================
  await knex.schema.createTable('labs_projects', (table) => {
    table.increments('id').primary();
    
    // Reference to space (optional - can be null for global projects)
    table.integer('space_id').unsigned()
      .references('id').inTable('spaces').onDelete('SET NULL');
    
    // Unique project identifier
    table.string('project_id', 255).unique().notNullable();
    
    // Project metadata
    table.string('title', 255).notNullable();
    table.text('description');
    
    // Configuration stored as JSON
    if (isPostgres) {
      table.jsonb('settings').defaultTo('{}');
    } else {
      table.text('settings').defaultTo('{}');
    }
    
    // Default AI configuration
    table.integer('ai_default_provider_id');
    table.integer('ai_default_agent_id');
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Indexes for labs_projects
  await knex.schema.alterTable('labs_projects', (table) => {
    table.index('space_id', 'idx_labs_projects_space');
    table.index('project_id', 'idx_labs_projects_project_id');
  });

  // ========================================
  // LABS_NODES TABLE
  // ========================================
  await knex.schema.createTable('labs_nodes', (table) => {
    table.increments('id').primary();
    
    // Project and node identification
    table.string('project_id', 255).notNullable();
    table.string('node_id', 255).notNullable();
    
    // Node type and metadata
    table.string('type', 100).notNullable(); // 'ai-agent', 'tool', 'input', 'output', etc.
    table.string('title', 255).notNullable();
    table.text('content');
    
    // Configuration stored as JSON
    if (isPostgres) {
      table.jsonb('meta').defaultTo('{}');
      table.jsonb('ai_config').defaultTo('{}');
      table.jsonb('ai_routing_config').defaultTo('{}');
      table.jsonb('ui_config').defaultTo('{}');
    } else {
      table.text('meta').defaultTo('{}');
      table.text('ai_config').defaultTo('{}');
      table.text('ai_routing_config').defaultTo('{}');
      table.text('ui_config').defaultTo('{}');
    }
    
    // AI configuration
    table.integer('ai_agent_id');
    table.integer('ai_provider_id');
    table.boolean('ai_visible').defaultTo(true);
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Unique constraint: one node per (project, node_id)
    table.unique(['project_id', 'node_id']);
  });

  // Indexes for labs_nodes
  await knex.schema.alterTable('labs_nodes', (table) => {
    table.index('project_id', 'idx_labs_nodes_project');
  });

  // ========================================
  // LABS_EDGES TABLE
  // ========================================
  await knex.schema.createTable('labs_edges', (table) => {
    table.increments('id').primary();
    
    // Project and edge identification
    table.string('project_id', 255).notNullable();
    table.string('edge_id', 255).notNullable();
    
    // Connection details
    table.string('source_node_id', 255).notNullable();
    table.string('target_node_id', 255).notNullable();
    table.string('source_handle', 100);
    table.string('target_handle', 100);
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Unique constraint: one edge per (project, edge_id)
    table.unique(['project_id', 'edge_id']);
  });

  // Indexes for labs_edges
  await knex.schema.alterTable('labs_edges', (table) => {
    table.index('project_id', 'idx_labs_edges_project');
  });

  // ========================================
  // LABS_AI_TEMPLATES TABLE
  // ========================================
  await knex.schema.createTable('labs_ai_templates', (table) => {
    table.increments('id').primary();
    
    // Unique template identifier for MindWorkflow integration
    table.string('mindworkflow_id', 100).unique().notNullable();
    
    // Template metadata
    table.string('name', 255).notNullable();
    table.string('category', 100).notNullable();
    table.text('description');
    
    // AI prompts
    table.text('system_prompt');
    table.text('user_prompt_example');
    
    // Configuration stored as JSON
    if (isPostgres) {
      table.jsonb('inputs').defaultTo('[]');
      table.jsonb('settings').defaultTo('{}');
      table.jsonb('routing_config').defaultTo('{}');
    } else {
      table.text('inputs').defaultTo('[]');
      table.text('settings').defaultTo('{}');
      table.text('routing_config').defaultTo('{}');
    }
    
    // Default AI agent
    table.integer('ai_agent_id');
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  console.log('✅ Created Labs tables: labs_projects, labs_nodes, labs_edges, labs_ai_templates');
}

export async function down(knex) {
  // Drop tables in reverse order to handle dependencies
  await knex.schema.dropTableIfExists('labs_ai_templates');
  await knex.schema.dropTableIfExists('labs_edges');
  await knex.schema.dropTableIfExists('labs_nodes');
  await knex.schema.dropTableIfExists('labs_projects');
  
  console.log('✅ Dropped Labs tables');
}