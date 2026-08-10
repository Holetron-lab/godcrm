// Script to create CRM automations for Calendar → Tickets in GERAVIKA space
// Run once, then delete. After this, rules are managed via CRM UI.

import { dbAll, dbRun, dbGet, sqlNow } from '../backend/database/connection.js';
import crypto from 'crypto';

async function main() {
  // Find or create automations_list table in System Data (project 101, space 37)
  let automationsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = 101 AND name = 'automations_list'"
  );

  if (!automationsTable) {
    const now = new Date().toISOString();
    const result = await dbRun(
      "INSERT INTO universal_tables (name, display_name, project_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
      ['automations_list', 'Automations', 101, now, now]
    );
    automationsTable = { id: result.lastID || result.lastInsertRowid };
    console.log('Created automations_list table:', automationsTable.id);

    const columns = [
      { column_name: 'name', display_name: 'Name', type: 'text', order_index: 0 },
      { column_name: 'description', display_name: 'Description', type: 'text', order_index: 1 },
      { column_name: 'table_id', display_name: 'Table ID', type: 'number', order_index: 2 },
      { column_name: 'table_name', display_name: 'Table', type: 'text', order_index: 3 },
      { column_name: 'trigger_type', display_name: 'Trigger', type: 'select', order_index: 4 },
      { column_name: 'action_type', display_name: 'Action', type: 'select', order_index: 5 },
      { column_name: 'is_active', display_name: 'Active', type: 'checkbox', order_index: 6 },
      { column_name: 'trigger_config', display_name: 'Trigger Config', type: 'text', order_index: 7 },
      { column_name: 'action_config', display_name: 'Action Config', type: 'text', order_index: 8 },
      { column_name: 'last_run', display_name: 'Last Run', type: 'date', order_index: 9 },
      { column_name: 'run_count', display_name: 'Run Count', type: 'number', order_index: 10 },
      { column_name: 'created_at', display_name: 'Created At', type: 'date', order_index: 11 }
    ];
    for (const col of columns) {
      await dbRun(
        'INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES ($1, $2, $3, $4, $5, true)',
        [automationsTable.id, col.column_name, col.display_name, col.type, col.order_index]
      );
    }
    console.log('Created automation columns');
  } else {
    console.log('automations_list table exists:', automationsTable.id);
  }

  // Find or create logs table
  let logsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = 101 AND name = 'automation_logs_list'"
  );
  if (!logsTable) {
    const now = new Date().toISOString();
    const result = await dbRun(
      "INSERT INTO universal_tables (name, display_name, project_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
      ['automation_logs_list', 'Automation Logs', 101, now, now]
    );
    logsTable = { id: result.lastID || result.lastInsertRowid };
    console.log('Created logs table:', logsTable.id);
    const logCols = [
      { column_name: 'automation_id', display_name: 'Automation ID', type: 'number', order_index: 0 },
      { column_name: 'automation_name', display_name: 'Automation', type: 'text', order_index: 1 },
      { column_name: 'status', display_name: 'Status', type: 'select', order_index: 2 },
      { column_name: 'trigger_data', display_name: 'Trigger Data', type: 'text', order_index: 3 },
      { column_name: 'result_data', display_name: 'Result', type: 'text', order_index: 4 },
      { column_name: 'error_message', display_name: 'Error', type: 'text', order_index: 5 },
      { column_name: 'duration_ms', display_name: 'Duration (ms)', type: 'number', order_index: 6 },
      { column_name: 'executed_at', display_name: 'Executed At', type: 'date', order_index: 7 }
    ];
    for (const col of logCols) {
      await dbRun(
        'INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES ($1, $2, $3, $4, $5, true)',
        [logsTable.id, col.column_name, col.display_name, col.type, col.order_index]
      );
    }
    console.log('Created log columns');
  } else {
    console.log('automation_logs_list exists:', logsTable.id);
  }

  console.log('Tables ready:', { automationsTableId: automationsTable.id, logsTableId: logsTable.id });

  // Create automations
  const now = new Date().toISOString();
  const automations = [
    {
      name: 'Personal Calendar → Task',
      description: 'When a new event syncs from geramonnn@gmail.com, auto-create a Task in Family Task Board. Excludes holidays/birthdays.',
      table_id: 2671,
      table_name: 'google_calendar_events',
      trigger_type: 'row_create',
      trigger_config: JSON.stringify({}),
      action_type: 'create_row',
      action_config: JSON.stringify({
        targetTableId: 2649,
        conditions: [
          { field: 'calendar_name', operator: 'equals', value: 'geramonnn@gmail.com' },
          { field: 'status', operator: 'not_equals', value: 'cancelled' },
          { field: 'title', operator: 'not_contains', value: 'праздник' },
          { field: 'title', operator: 'not_contains', value: 'holiday' }
        ],
        fieldMappings: [
          { sourceColumnId: 'title', targetColumnId: 'what' },
          { sourceColumnId: 'description', targetColumnId: 'why' },
          { sourceColumnId: 'start_datetime', targetColumnId: 'scheduled_date' },
          { sourceColumnId: 'end_datetime', targetColumnId: 'due_date' },
          { targetColumnId: 'state', staticValue: 24275 },
          { targetColumnId: 'type', staticValue: 24269 },
          { targetColumnId: 'priority', staticValue: 24272 }
        ]
      }),
      is_active: true, run_count: 0, last_run: null, created_at: now
    },
    {
      name: 'Family Calendar → Task',
      description: 'Auto-create Task from Family Group calendar events.',
      table_id: 2671,
      table_name: 'google_calendar_events',
      trigger_type: 'row_create',
      trigger_config: JSON.stringify({}),
      action_type: 'create_row',
      action_config: JSON.stringify({
        targetTableId: 2649,
        conditions: [
          { field: 'calendar_name', operator: 'contains', value: 'Семейная' },
          { field: 'status', operator: 'not_equals', value: 'cancelled' }
        ],
        fieldMappings: [
          { sourceColumnId: 'title', targetColumnId: 'what' },
          { sourceColumnId: 'description', targetColumnId: 'why' },
          { sourceColumnId: 'start_datetime', targetColumnId: 'scheduled_date' },
          { sourceColumnId: 'end_datetime', targetColumnId: 'due_date' },
          { targetColumnId: 'state', staticValue: 24275 },
          { targetColumnId: 'type', staticValue: 24269 },
          { targetColumnId: 'priority', staticValue: 24272 }
        ]
      }),
      is_active: true, run_count: 0, last_run: null, created_at: now
    },
    {
      name: 'New Event → Notification',
      description: 'Notify on new calendar events (exclude Thai holidays).',
      table_id: 2671,
      table_name: 'google_calendar_events',
      trigger_type: 'row_create',
      trigger_config: JSON.stringify({}),
      action_type: 'notification',
      action_config: JSON.stringify({
        notificationType: 'in_app',
        conditions: [
          { field: 'calendar_name', operator: 'not_contains', value: 'Праздники' },
          { field: 'status', operator: 'not_equals', value: 'cancelled' }
        ],
        recipients: ['1'],
        messageTemplate: '📅 New event: {{title}} ({{start_datetime}})'
      }),
      is_active: false, run_count: 0, last_run: null, created_at: now
    }
  ];

  for (const auto of automations) {
    const baseId = 'auto_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const result = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
      [automationsTable.id, baseId, JSON.stringify(auto), now, now]
    );
    const id = result.lastID || result.lastInsertRowid;
    console.log(`Created: #${id} - ${auto.name} [${auto.trigger_type} → ${auto.action_type}] active=${auto.is_active}`);
  }

  // Verify
  const all = await dbAll('SELECT id, data FROM table_rows WHERE table_id = $1', [automationsTable.id]);
  console.log(`\nTotal automations in GERAVIKA space: ${all.length}`);
  for (const a of all) {
    const d = JSON.parse(a.data);
    console.log(`  #${a.id}: ${d.name} [${d.trigger_type} → ${d.action_type}] active=${d.is_active}`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
