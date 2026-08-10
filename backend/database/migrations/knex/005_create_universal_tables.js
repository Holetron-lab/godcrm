// backend/database/migrations/knex/005_create_universal_tables.js
// Universal Tables: Core CRM data structure
export async function up(knex) {
  await knex.schema.createTable('universal_tables', (table) => {
    table.increments('id').primary();
    table.integer('project_id').unsigned().notNullable()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.text('description');
    table.string('icon', 50);
    table.boolean('is_system').defaultTo(false);
    table.string('sync_target', 255);
    
    // Documents widget v4 columns
    table.text('folder_path');
    table.string('table_type', 50);
    table.string('base_id', 50);
    table.integer('created_by').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes
    table.index('project_id');
    table.index('is_system');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('universal_tables');
}
