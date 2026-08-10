// backend/database/migrations/knex/025_create_table_column_mappings.js
// ADR-069: Column Mapping — allows tables to map columns to standard ticket fields
// Used for CardDetailModal to display consistent field labels across different tables

export async function up(knex) {
  await knex.schema.createTable('table_column_mappings', (table) => {
    table.increments('id').primary();
    
    table.integer('table_id').unsigned().notNullable()
      .references('id').inTable('universal_tables').onDelete('CASCADE');
    
    table.string('standard_field', 50).notNullable();  // e.g., 'title', 'description', 'priority'
    table.string('column_name', 100).notNullable();    // actual column name in the table
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Each table can only have one mapping per standard field
    table.unique(['table_id', 'standard_field']);
    table.index('table_id');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('table_column_mappings');
}
