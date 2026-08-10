// backend/database/migrations/knex/002_create_spaces.js
// Spaces: Business, Personal, Admin, AI workspaces
export async function up(knex) {
  await knex.schema.createTable('spaces', (table) => {
    table.increments('id').primary();
    table.integer('owner_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.text('description');
    table.string('icon', 50).defaultTo('📁');
    table.enu('type', ['business', 'personal', 'admin', 'ai']).notNullable();
    
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
    table.index('type');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('spaces');
}
