// backend/database/migrations/knex/003_create_projects.js
// Projects: Container for universal tables
export async function up(knex) {
  await knex.schema.createTable('projects', (table) => {
    table.increments('id').primary();
    table.integer('space_id').unsigned()
      .references('id').inTable('spaces').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.text('description');
    table.string('icon', 50);
    table.integer('primary_table_id').unsigned();
    table.string('type', 50).notNullable();
    table.integer('owner_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    
    // Theme colors
    table.string('theme_primary', 20).defaultTo('#0ea5e9');
    table.string('theme_secondary', 20).defaultTo('#8b5cf6');
    table.string('theme_tertiary', 20).defaultTo('#10b981');
    
    // Settings JSON
    table.text('settings');
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes
    table.index('owner_id');
    table.index('space_id');
    table.index('type');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('projects');
}
