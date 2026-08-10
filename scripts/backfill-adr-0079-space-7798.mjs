#!/usr/bin/env node
// One-off: backfill space 7798 (owner user 8944) with ADR-0079 layout.
// Drops the empty Password Manager project, then runs applyStarterPack
// under a temporary flag flip. Idempotent on re-run.
//
// Usage: node scripts/backfill-adr-0079-space-7798.mjs

import { dbGet, dbAll, dbRun } from '../backend/database/connection.js';
import { applyStarterPack } from '../backend/services/starter-pack/StarterPackService.js';

const SPACE_ID = 7798;
const USER_ID = 8944;
const PM_PROJECT_ID = 8375;
const FLAG_KEY = 'starter_pack_enabled';

async function main() {
  console.log(`[backfill-7798] start — space=${SPACE_ID} user=${USER_ID}`);

  // 1. Sanity: confirm space + owner match.
  const space = await dbGet('SELECT id, owner_id, type FROM spaces WHERE id = ?', [SPACE_ID]);
  if (!space) throw new Error(`space ${SPACE_ID} not found`);
  if (space.owner_id !== USER_ID) throw new Error(`space ${SPACE_ID}.owner_id=${space.owner_id}, expected ${USER_ID}`);
  if (space.type !== 'personal') throw new Error(`space ${SPACE_ID}.type=${space.type}, expected 'personal'`);

  // 2. Drop Password Manager project (CASCADE clears its tables / 0 rows).
  const pm = await dbGet('SELECT id, name FROM projects WHERE id = ? AND space_id = ?', [PM_PROJECT_ID, SPACE_ID]);
  if (pm) {
    if (pm.name !== 'Password Manager') {
      throw new Error(`refusing to drop project ${PM_PROJECT_ID}: name="${pm.name}" (expected Password Manager)`);
    }
    const rowCheck = await dbAll(
      `SELECT ut.id, ut.name, (SELECT COUNT(*) FROM table_rows tr WHERE tr.table_id = ut.id) AS rows
         FROM universal_tables ut WHERE ut.project_id = ? AND ut.deleted_at IS NULL`,
      [PM_PROJECT_ID]
    );
    const dirty = rowCheck.filter(r => Number(r.rows) > 0);
    if (dirty.length) {
      throw new Error(`refusing to drop project ${PM_PROJECT_ID}: tables have data: ${JSON.stringify(dirty)}`);
    }
    await dbRun('DELETE FROM projects WHERE id = ?', [PM_PROJECT_ID]);
    console.log(`[backfill-7798] dropped Password Manager project ${PM_PROJECT_ID} (${rowCheck.length} empty tables cascaded)`);
  } else {
    console.log(`[backfill-7798] PM project ${PM_PROJECT_ID} already gone — skipping drop`);
  }

  // 3. Save current flag value, force-enable for this run.
  const before = await dbGet('SELECT value FROM _app_settings WHERE key = ?', [FLAG_KEY]);
  const prevValue = before?.value ?? null;
  await dbRun(
    `INSERT INTO _app_settings(key, value, updated_at)
       VALUES (?, 'true'::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_at = NOW()`,
    [FLAG_KEY]
  );
  console.log(`[backfill-7798] flag '${FLAG_KEY}' temporarily forced to true (was ${prevValue})`);

  let outcome = null;
  try {
    outcome = await applyStarterPack(USER_ID);
    console.log(`[backfill-7798] applyStarterPack result:`, JSON.stringify(outcome, null, 2));
  } finally {
    // 4. Restore original flag value (or keep null → delete row if it was missing).
    if (prevValue === null) {
      await dbRun(`DELETE FROM _app_settings WHERE key = ?`, [FLAG_KEY]);
    } else {
      await dbRun(
        `UPDATE _app_settings SET value = ?::jsonb, updated_at = NOW() WHERE key = ?`,
        [JSON.stringify(prevValue), FLAG_KEY]
      );
    }
    const after = await dbGet('SELECT value FROM _app_settings WHERE key = ?', [FLAG_KEY]);
    console.log(`[backfill-7798] flag '${FLAG_KEY}' restored: ${after?.value ?? '(deleted)'}`);
  }

  // 5. Verify post-state.
  const projects = await dbAll('SELECT id, name, icon FROM projects WHERE space_id = ? ORDER BY id', [SPACE_ID]);
  const tables = await dbAll(
    `SELECT ut.id, ut.name, ut.project_id
       FROM universal_tables ut
       JOIN projects p ON p.id = ut.project_id
      WHERE p.space_id = ? AND ut.deleted_at IS NULL
      ORDER BY ut.id`,
    [SPACE_ID]
  );
  const widgets = await dbAll(
    `SELECT w.id, w.preset_name, w.title, w.dashboard_id
       FROM widgets w
       JOIN dashboards d ON d.id = w.dashboard_id
       JOIN projects p ON p.id = d.project_id
      WHERE p.space_id = ? AND w.preset_name = 'welcome_dashboard'`,
    [SPACE_ID]
  );

  console.log(`[backfill-7798] verification:`);
  console.log(`  projects: ${JSON.stringify(projects)}`);
  console.log(`  starter tables: ${tables.length}`);
  for (const t of tables) console.log(`    - ${t.id}: ${t.name} (project ${t.project_id})`);
  console.log(`  welcome_dashboard widget(s): ${widgets.length}`);
  for (const w of widgets) console.log(`    - widget ${w.id}: ${w.title}`);

  console.log(`[backfill-7798] done`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill-7798] FATAL:', err?.stack || err);
  process.exit(1);
});
