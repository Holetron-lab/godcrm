// Script to create pipeline automations for Space 11 (Development)
// Ticket #75053: ticket routing, agent health check, DORA metrics, failure alerting
// Run once on dev, verify, then run on prod.

import { dbAll, dbRun, dbGet } from '../backend/database/connection.js';
import crypto from 'crypto';

async function main() {
  const SPACE_ID = 11;
  const TICKETS_TABLE_ID = 1708;

  // Find System Data project for this space
  const systemProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [SPACE_ID]
  );
  if (!systemProject) {
    console.error('System Data project not found for space', SPACE_ID);
    process.exit(1);
  }

  // Find automations_list table
  const autoTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automations_list'",
    [systemProject.id]
  );
  if (!autoTable) {
    console.error('automations_list table not found in System Data project', systemProject.id);
    process.exit(1);
  }
  const AUTOMATIONS_TABLE_ID = autoTable.id;
  console.log('Found automations_list table:', AUTOMATIONS_TABLE_ID);

  // Check for duplicates
  const existing = await dbAll('SELECT id, data FROM table_rows WHERE table_id = ?', [AUTOMATIONS_TABLE_ID]);
  const existingNames = new Set(existing.map(r => {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    return d.name;
  }));

  const now = new Date().toISOString();

  const automations = [
    {
      name: 'Ticket Auto-Routing',
      description: 'Auto-assign new tickets to agents based on type and title keywords. Triggers on row_create for Tickets table.',
      table_id: TICKETS_TABLE_ID,
      table_name: 'Tickets',
      trigger_type: 'row_create',
      trigger_config: JSON.stringify({}),
      action_type: 'ticket_routing',
      action_config: JSON.stringify({
        space_id: 11,
        default_agent: 'DEV_RALPH',
        type_routing: {
          // Map type option IDs to agent keys
          '24269': 'DEVELOPER',    // task → Developer
        },
      }),
      is_active: true,
      run_count: 0,
      last_run: null,
      created_at: now,
    },
    {
      name: 'Agent Health Check (every 30 min)',
      description: 'Monitor agent activity. Alert if no activity in last 2 hours (dead agent detection).',
      table_id: null,
      table_name: null,
      trigger_type: 'schedule',
      trigger_config: JSON.stringify({
        cron: '*/30 * * * *',
        timezone: 'Asia/Bangkok',
      }),
      action_type: 'agent_health_check',
      action_config: JSON.stringify({
        space_id: 11,
        threshold_hours: 2,
        topic: 'notifications',
        notify: true,
      }),
      is_active: true,
      run_count: 0,
      last_run: null,
      created_at: now,
    },
    {
      name: 'DORA Metrics (daily 23:00)',
      description: 'Auto-calculate DORA metrics: deployment frequency, lead time, change failure rate, MTTR.',
      table_id: null,
      table_name: null,
      trigger_type: 'schedule',
      trigger_config: JSON.stringify({
        cron: '0 23 * * *',
        timezone: 'Asia/Bangkok',
      }),
      action_type: 'dora_metrics',
      action_config: JSON.stringify({
        space_id: 11,
        period_days: 1,
        topic: 'notifications',
        notify: true,
      }),
      is_active: true,
      run_count: 0,
      last_run: null,
      created_at: now,
    },
    {
      name: 'Failure Alerting (every 15 min)',
      description: 'Check agent failure rate in last 30 min. Alert if above 30% threshold.',
      table_id: null,
      table_name: null,
      trigger_type: 'schedule',
      trigger_config: JSON.stringify({
        cron: '*/15 * * * *',
        timezone: 'Asia/Bangkok',
      }),
      action_type: 'failure_alerting',
      action_config: JSON.stringify({
        space_id: 11,
        window_minutes: 30,
        threshold_pct: 30,
        min_sample: 3,
        topic: 'notifications',
      }),
      is_active: true,
      run_count: 0,
      last_run: null,
      created_at: now,
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const auto of automations) {
    if (existingNames.has(auto.name)) {
      console.log(`SKIP (exists): ${auto.name}`);
      skipped++;
      continue;
    }

    const baseId = 'pipeline_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const result = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [AUTOMATIONS_TABLE_ID, baseId, JSON.stringify(auto), now, now]
    );
    const id = result.lastID || result.lastInsertRowid;
    console.log(`CREATED: #${id} - ${auto.name} [${auto.trigger_type} → ${auto.action_type}]`);
    created++;
  }

  // Verify
  const all = await dbAll('SELECT id, data FROM table_rows WHERE table_id = ?', [AUTOMATIONS_TABLE_ID]);
  console.log(`\nTotal automations in Space 11: ${all.length} (created: ${created}, skipped: ${skipped})`);
  for (const a of all) {
    const d = typeof a.data === 'string' ? JSON.parse(a.data) : a.data;
    console.log(`  #${a.id}: ${d.name} [${d.trigger_type} → ${d.action_type}] active=${d.is_active}`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
