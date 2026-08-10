// backend/database/migrations/knex/011_create_webhooks.js
// Webhooks System
export async function up(knex) {
  // Webhooks
  await knex.schema.createTable('webhooks', (table) => {
    table.increments('id').primary();
    table.integer('project_id').unsigned()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.integer('table_id').unsigned()
      .references('id').inTable('universal_tables').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.text('url').notNullable();
    table.text('events'); // JSON array
    table.text('secret');
    table.boolean('is_active').defaultTo(true);
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('project_id');
    table.index('table_id');
    table.index('is_active');
  });

  // Webhook Logs
  await knex.schema.createTable('webhook_logs', (table) => {
    table.increments('id').primary();
    table.integer('webhook_id').unsigned().notNullable()
      .references('id').inTable('webhooks').onDelete('CASCADE');
    table.string('event', 100).notNullable();
    table.text('payload');
    table.integer('status_code');
    table.text('response');
    table.integer('duration_ms');
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index('webhook_id');
    table.index('created_at');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('webhook_logs');
  await knex.schema.dropTableIfExists('webhooks');
}
