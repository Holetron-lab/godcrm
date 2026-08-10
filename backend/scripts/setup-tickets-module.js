/**
 * Setup Tickets Module — ADR-098: Unified Execution Ecosystem
 *
 * Creates or verifies the Tickets module tables and Kanban widget for a space.
 * This script can be run multiple times safely (idempotent).
 *
 * Usage:
 *   node backend/scripts/setup-tickets-module.js [--space-id=N] [--project-id=N]
 *
 * If no space-id given, runs for the Development space.
 * If no project-id given, uses the first project in the space.
 *
 * Creates:
 *   1. Ticket States dictionary table (with 7 ADR-098 states)
 *   2. Ticket Types dictionary table
 *   3. Tickets main table (with all ADR-098 columns)
 *   4. Kanban Board widget bound to Tickets table, grouped by state
 */

import { dbGet, dbAll, dbRun, isPostgres, safeJsonParse } from '../database/connection.js';
import { createTicketsModuleTables } from '../services/SystemTablesCreator.js';

// Parse CLI arguments
const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [key, val] = arg.replace(/^--/, '').split('=');
    return [key, val || true];
  })
);

async function main() {
  console.log('=== ADR-098: Tickets Module Setup ===\n');

  // 1. Find target space
  let spaceId = args['space-id'] ? Number(args['space-id']) : null;

  if (!spaceId) {
    const devSpace = await dbGet(
      "SELECT id, name FROM spaces WHERE LOWER(name) = 'development' LIMIT 1"
    );
    if (devSpace) {
      spaceId = devSpace.id;
      console.log(`Using Development space: id=${spaceId} name="${devSpace.name}"`);
    } else {
      console.error('No Development space found. Use --space-id=N to specify.');
      process.exit(1);
    }
  }

  // 2. Find target project
  let projectId = args['project-id'] ? Number(args['project-id']) : null;

  if (!projectId) {
    const project = await dbGet(
      'SELECT id, name FROM projects WHERE space_id = ? ORDER BY id LIMIT 1',
      [spaceId]
    );
    if (project) {
      projectId = project.id;
      console.log(`Using project: id=${projectId} name="${project.name}"`);
    } else {
      console.error(`No projects found in space ${spaceId}. Create a project first.`);
      process.exit(1);
    }
  }

  // 3. Check if Tickets table already exists in this project
  const existingTickets = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'Tickets'",
    [projectId]
  );

  if (existingTickets) {
    console.log(`\n✅ Tickets table already exists: id=${existingTickets.id}`);

    // Verify related tables
    const existingStates = await dbGet(
      "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'Ticket States'",
      [projectId]
    );
    const existingTypes = await dbGet(
      "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'Ticket Types'",
      [projectId]
    );

    console.log(`   Ticket States: ${existingStates ? `id=${existingStates.id}` : '❌ MISSING'}`);
    console.log(`   Ticket Types: ${existingTypes ? `id=${existingTypes.id}` : '❌ MISSING'}`);

    // Check Kanban widget
    await ensureKanbanWidget(spaceId, projectId, existingTickets.id, existingStates?.id);
    return;
  }

  // 4. Create Tickets module tables
  console.log('\nCreating Tickets module tables...');
  const result = await createTicketsModuleTables(projectId);

  console.log(`\n✅ Tables created:`);
  console.log(`   Tickets: id=${result.ticketsTableId}`);
  console.log(`   Ticket States: id=${result.statesTableId} (${result.stateRowIds.length} states seeded)`);
  console.log(`   Ticket Types: id=${result.typesTableId}`);

  // 5. Create Kanban widget
  await ensureKanbanWidget(spaceId, projectId, result.ticketsTableId, result.statesTableId);

  console.log('\n=== Tickets Module Setup Complete ===');
  console.log('\nIMPORTANT: Update the following constants in your code if table IDs differ:');
  console.log(`   TICKETS_TABLE_ID = ${result.ticketsTableId}  (backend/routes/v3/tickets.js)`);
  console.log(`   TICKETS_TABLE_ID = ${result.ticketsTableId}  (backend/services/ChainHandoffService.js)`);
  console.log(`   TICKETS_TABLE_ID = ${result.ticketsTableId}  (src/features/tickets/api/ticketsApi.ts)`);
}

/**
 * Ensure a Kanban Board widget exists for the Tickets table.
 * Creates it on the default dashboard if not found.
 */
async function ensureKanbanWidget(spaceId, projectId, ticketsTableId, statesTableId) {
  // Find dashboard for this project
  let dashboard = await dbGet(
    'SELECT id FROM dashboards WHERE project_id = ? ORDER BY is_default DESC, id LIMIT 1',
    [projectId]
  );

  if (!dashboard) {
    // Create default dashboard
    const dashResult = await dbRun(
      isPostgres()
        ? `INSERT INTO dashboards (project_id, space_id, name, icon, is_default, created_at, updated_at)
           VALUES ($1, $2, 'Main Dashboard', '📊', true, NOW(), NOW()) RETURNING id`
        : `INSERT INTO dashboards (project_id, space_id, name, icon, is_default, created_at, updated_at)
           VALUES (?, ?, 'Main Dashboard', '📊', 1, datetime('now'), datetime('now'))`,
      [projectId, spaceId]
    );
    const dashId = dashResult.lastInsertRowid || dashResult.lastID || dashResult?.rows?.[0]?.id;
    dashboard = { id: dashId };
    console.log(`   Created dashboard: id=${dashId}`);
  }

  // Check if Kanban widget already exists for this table
  const existingWidget = await dbGet(
    isPostgres()
      ? `SELECT id FROM widgets WHERE dashboard_id = $1 AND preset_name = 'kanban_board' AND config::text LIKE $2`
      : `SELECT id FROM widgets WHERE dashboard_id = ? AND preset_name = 'kanban_board' AND config LIKE ?`,
    [dashboard.id, `%"table_id":${ticketsTableId}%`]
  );

  if (existingWidget) {
    console.log(`\n✅ Kanban widget already exists: id=${existingWidget.id}`);
    return;
  }

  // Create Kanban widget bound to Tickets table
  const kanbanConfig = {
    table_id: ticketsTableId,
    group_by_column: 'state',
    card_title_column: 'what',
    card_subtitle_column: 'why',
    card_columns: ['assigned_to', 'priority', 'phase', 'adr_ref', 'progress'],
    visible_columns: ['acceptance_criteria', 'chain_id', 'depends_on', 'scheduled_date', 'due_date'],
    kanban: {
      statusColumn: 'state',
      titleColumn: 'what',
      descriptionColumn: 'why',
      scheduledDateColumn: 'scheduled_date',
      dueDateColumn: 'due_date',
      colorColumn: 'priority',
    },
    // ADR-098: Bind to Ticket States table for column headers
    states_table_id: statesTableId,
  };

  const position = { x: 0, y: 0, w: 12, h: 8 };

  const widgetResult = await dbRun(
    isPostgres()
      ? `INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, description, icon, config, position, is_visible, is_module, created_at, updated_at)
         VALUES ($1, 'preset', 'kanban_board', $2, $3, '📋', $4::jsonb, $5::jsonb, true, true, NOW(), NOW()) RETURNING id`
      : `INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, description, icon, config, position, is_visible, is_module, created_at, updated_at)
         VALUES (?, 'preset', 'kanban_board', ?, ?, '📋', ?, ?, 1, 1, datetime('now'), datetime('now'))`,
    [
      dashboard.id,
      'Tickets Board',
      'ADR-098: Development task board with 7-status workflow',
      JSON.stringify(kanbanConfig),
      JSON.stringify(position),
    ]
  );
  const widgetId = widgetResult.lastInsertRowid || widgetResult.lastID || widgetResult?.rows?.[0]?.id;

  console.log(`\n✅ Kanban widget created: id=${widgetId}`);
  console.log(`   Config: table_id=${ticketsTableId}, group_by=state, states_table=${statesTableId}`);

  // Create module entry for sidebar
  try {
    await dbRun(
      isPostgres()
        ? `INSERT INTO modules (widget_id, space_id, sidebar_order, sidebar_icon, is_pinned, created_at, updated_at)
           VALUES ($1, $2, 0, '🎫', true, NOW(), NOW())`
        : `INSERT INTO modules (widget_id, space_id, sidebar_order, sidebar_icon, is_pinned, created_at, updated_at)
           VALUES (?, ?, 0, '🎫', 1, datetime('now'), datetime('now'))`,
      [widgetId, spaceId]
    );
    console.log(`   Module entry created (sidebar, pinned)`);
  } catch (err) {
    console.log(`   Module entry: skipped (${err.message})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Setup failed:', err);
    process.exit(1);
  });
