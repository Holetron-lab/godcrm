// backend/database/migrations/knex/014_create_monitoring_automations.js
// Additional tables from SQLite schema that need PostgreSQL equivalents
// ADR-017: Database Abstraction Layer

/**
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // Storage Providers
  await knex.schema.createTable('storage_providers', (table) => {
    table.string('id', 100).primary();
    table.string('name', 255).notNullable();
    table.string('type', 50).notNullable();
    table.boolean('is_default').defaultTo(false);
    table.boolean('is_enabled').defaultTo(true);
    table.json('config');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Monitoring Runs (AI/LLM traces)
  await knex.schema.createTable('monitoring_runs', (table) => {
    table.string('id', 100).primary();
    table.string('parent_run_id', 100)
      .references('id').inTable('monitoring_runs').onDelete('SET NULL');
    table.string('type', 50).notNullable();
    table.string('name', 255);
    table.string('status', 50).defaultTo('running');
    table.text('input');
    table.text('output');
    table.text('error');
    table.integer('tokens_prompt').defaultTo(0);
    table.integer('tokens_completion').defaultTo(0);
    table.decimal('cost', 10, 6).defaultTo(0);
    table.integer('duration_ms').defaultTo(0);
    table.string('model', 100);
    table.string('provider', 100);
    table.string('user_id', 100);
    table.json('user_props');
    table.json('tags');
    table.json('metadata');
    table.json('params');
    table.string('template_id', 100);
    table.string('runtime', 100);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('ended_at');

    table.index('type');
    table.index('user_id');
    table.index('created_at');
    table.index('parent_run_id');
  });

  // Monitoring Events
  await knex.schema.createTable('monitoring_events', (table) => {
    table.increments('id').primary();
    table.string('run_id', 100)
      .references('id').inTable('monitoring_runs').onDelete('CASCADE');
    table.string('event_type', 50).notNullable();
    table.string('event_name', 255).notNullable();
    table.bigInteger('timestamp').notNullable();
    table.json('data');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('run_id');
  });

  // Monitoring Feedback
  await knex.schema.createTable('monitoring_feedback', (table) => {
    table.increments('id').primary();
    table.string('run_id', 100)
      .references('id').inTable('monitoring_runs').onDelete('CASCADE');
    table.string('user_id', 100);
    table.integer('score');
    table.text('comment');
    table.json('metadata');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('run_id');
  });

  // Monitoring Threads
  await knex.schema.createTable('monitoring_threads', (table) => {
    table.string('id', 100).primary();
    table.string('name', 255);
    table.json('metadata');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Automations
  await knex.schema.createTable('automations', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable();
    table.text('description');
    table.integer('table_id').unsigned().notNullable()
      .references('id').inTable('universal_tables').onDelete('CASCADE');
    table.boolean('is_active').defaultTo(true);
    table.string('trigger_type', 50).notNullable();
    table.json('trigger_config');
    table.json('actions');
    table.integer('run_count').defaultTo(0);
    table.timestamp('last_run_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.integer('created_by').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');

    table.index('table_id');
    table.index('is_active');
  });

  // Automation Logs
  await knex.schema.createTable('automation_logs', (table) => {
    table.increments('id').primary();
    table.integer('automation_id').unsigned().notNullable()
      .references('id').inTable('automations').onDelete('CASCADE');
    table.integer('row_id').unsigned();
    table.string('status', 50).notNullable();
    table.json('input');
    table.json('output');
    table.text('error');
    table.integer('duration_ms');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('automation_id');
    table.index('created_at');
  });

  // System Form Configs (dynamic form configurations)
  await knex.schema.createTable('system_form_configs', (table) => {
    table.string('id', 100).primary();
    table.string('name', 255).notNullable();
    table.string('entity_type', 100).notNullable();
    table.json('fields');
    table.json('validation');
    table.json('layout');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('entity_type');
  });

  // User Access Permissions
  await knex.schema.createTable('user_access_permissions', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.string('resource_type', 100).notNullable();
    table.string('resource_id', 100).notNullable();
    table.string('permission', 50).notNullable();
    table.integer('granted_by').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.unique(['user_id', 'resource_type', 'resource_id', 'permission']);
    table.index('user_id');
    table.index(['resource_type', 'resource_id']);
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('user_access_permissions');
  await knex.schema.dropTableIfExists('system_form_configs');
  await knex.schema.dropTableIfExists('automation_logs');
  await knex.schema.dropTableIfExists('automations');
  await knex.schema.dropTableIfExists('monitoring_threads');
  await knex.schema.dropTableIfExists('monitoring_feedback');
  await knex.schema.dropTableIfExists('monitoring_events');
  await knex.schema.dropTableIfExists('monitoring_runs');
  await knex.schema.dropTableIfExists('storage_providers');
}
