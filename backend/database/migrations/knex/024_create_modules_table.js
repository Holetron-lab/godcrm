// backend/database/migrations/knex/024_create_modules_table.js
// ADR-065: Module Separation — separate modules table with FK on widgets
// Stores module-specific data: sidebar_order, access_level, is_pinned, etc.

export async function up(knex) {
  // Step 1: Create modules table
  await knex.schema.createTable('modules', (table) => {
    table.increments('id').primary();

    table.integer('widget_id').unsigned().notNullable()
      .references('id').inTable('widgets').onDelete('CASCADE');
    table.integer('space_id').unsigned().notNullable()
      .references('id').inTable('spaces');

    table.integer('sidebar_order').defaultTo(0);
    table.text('sidebar_icon');
    table.text('access_level').defaultTo('member');
    table.boolean('is_pinned').defaultTo(false);
    table.boolean('is_default').defaultTo(false);

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique('widget_id');
    table.index('space_id');
  });

  // Step 2: Data migration — create module records for existing is_module=true widgets
  // Resolve space_id via: widget → dashboard → (space_id OR project → space_id)
  await knex.raw(`
    INSERT INTO modules (widget_id, space_id, sidebar_order, created_at, updated_at)
    SELECT
      w.id,
      COALESCE(d.space_id, p.space_id),
      ROW_NUMBER() OVER (PARTITION BY COALESCE(d.space_id, p.space_id) ORDER BY w.id) - 1,
      NOW(),
      NOW()
    FROM widgets w
    JOIN dashboards d ON w.dashboard_id = d.id
    LEFT JOIN projects p ON d.project_id = p.id
    WHERE w.is_module = true
      AND COALESCE(d.space_id, p.space_id) IS NOT NULL
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('modules');
}
