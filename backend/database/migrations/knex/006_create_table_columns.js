// backend/database/migrations/knex/006_create_table_columns.js
// Table Columns: Dynamic column definitions
export async function up(knex) {
  await knex.schema.createTable('table_columns', (table) => {
    table.increments('id').primary();
    table.integer('table_id').unsigned().notNullable()
      .references('id').inTable('universal_tables').onDelete('CASCADE');
    table.string('column_name', 255).notNullable();
    table.string('display_name', 255);
    table.string('type', 50).notNullable();
    table.text('config'); // JSON config
    table.integer('order_index').defaultTo(0);
    table.boolean('is_visible').defaultTo(true);
    table.boolean('is_required').defaultTo(false);
    table.boolean('is_system').defaultTo(false);
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes
    table.index('table_id');
    table.index(['table_id', 'column_name']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('table_columns');
}
