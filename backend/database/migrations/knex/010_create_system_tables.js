// backend/database/migrations/knex/010_create_system_tables.js
// System Tables: Audit Log, System Settings, API Keys, Schema Layouts
export async function up(knex) {
  // Audit Log
  await knex.schema.createTable('audit_log', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    table.string('action', 100).notNullable();
    table.string('entity_type', 100);
    table.string('entity_id', 255);
    table.text('details');
    table.string('ip_address', 45);
    table.text('user_agent');
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index('user_id');
    table.index('action');
    table.index('entity_type');
    table.index('created_at');
  });

  // System Settings
  await knex.schema.createTable('system_settings', (table) => {
    table.string('key', 255).primary();
    table.text('value');
    table.string('type', 50).defaultTo('string');
    table.text('description');
    
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // API Keys
  await knex.schema.createTable('api_keys', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    
    // Key identification
    table.string('key_prefix', 20).notNullable();
    table.string('key_hash', 255).notNullable();
    table.string('name', 255).notNullable();
    
    // Permissions (JSON array)
    table.text('scopes').defaultTo('["*"]');
    
    // Rate limiting
    table.integer('rate_limit').defaultTo(1000);
    
    // Usage tracking
    table.timestamp('last_used_at');
    table.integer('request_count').defaultTo(0);
    
    // Expiration
    table.timestamp('expires_at');
    table.boolean('is_active').defaultTo(true);
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('key_prefix');
    table.index('user_id');
    table.index('is_active');
  });

  // Schema Layouts
  await knex.schema.createTable('schema_layouts', (table) => {
    table.increments('id').primary();
    table.integer('space_id').unsigned().notNullable().unique()
      .references('id').inTable('spaces').onDelete('CASCADE');
    table.text('layout').notNullable();
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('schema_layouts');
  await knex.schema.dropTableIfExists('api_keys');
  await knex.schema.dropTableIfExists('system_settings');
  await knex.schema.dropTableIfExists('audit_log');
}
