// backend/database/migrations/knex/013_create_data_sources.js
// Multi-Source Tables: Data Sources & Sync Logs
export async function up(knex) {
  // User Settings
  await knex.schema.createTable('user_settings', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.string('setting_key', 255).notNullable();
    table.text('setting_value');
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.unique(['user_id', 'setting_key']);
    table.index('user_id');
  });

  // Data Sources
  await knex.schema.createTable('data_sources', (table) => {
    table.increments('id').primary();
    table.integer('project_id').unsigned().notNullable()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.string('type', 50).notNullable(); // 'google_sheets', 'airtable', 'notion', etc.
    table.text('config'); // JSON config (encrypted)
    table.text('credentials'); // JSON credentials (encrypted)
    table.boolean('is_active').defaultTo(true);
    table.timestamp('last_sync_at');
    table.string('sync_status', 50);
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('project_id');
    table.index('type');
    table.index('is_active');
  });

  // Sync Logs
  await knex.schema.createTable('sync_logs', (table) => {
    table.increments('id').primary();
    table.integer('data_source_id').unsigned().notNullable()
      .references('id').inTable('data_sources').onDelete('CASCADE');
    table.string('status', 50).notNullable();
    table.integer('rows_synced').defaultTo(0);
    table.integer('rows_created').defaultTo(0);
    table.integer('rows_updated').defaultTo(0);
    table.integer('rows_deleted').defaultTo(0);
    table.text('error_message');
    table.integer('duration_ms');
    
    table.timestamp('started_at').defaultTo(knex.fn.now());
    table.timestamp('completed_at');
    
    table.index('data_source_id');
    table.index('status');
    table.index('started_at');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sync_logs');
  await knex.schema.dropTableIfExists('data_sources');
  await knex.schema.dropTableIfExists('user_settings');
}
