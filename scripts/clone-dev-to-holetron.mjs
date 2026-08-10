/**
 * Clone tables WITH DATA from Development space (space_id=11)
 * into Holetron space (space_id=36).
 *
 * Steps:
 *  1. Clean up empty Holetron projects (176-182, 184, 185)
 *  2. Clone non-form, non-empty tables from Dev into mapped Holetron projects
 *  3. Update relation_table references in column configs
 *
 * Usage: node scripts/clone-dev-to-holetron.mjs
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'godcrm_prod',
  user: 'godcrm',
  password: 'godcrm_dev_2026'
});

// ─── Configuration ───────────────────────────────────────────────────────────

const DEV_SPACE_ID = 11;
const HOL_SPACE_ID = 36;

// Project mapping: Dev project ID → Holetron project ID
const PROJECT_MAP = {
  117: 176,  // ADR Projects
  119: 177,  // Agent Activity
  120: 178,  // Quality Reports
  121: 179,  // DORA Metrics
  // 122: SKIP (Bug Tracker — not needed)
  123: 181,  // Dictionaries
  131: 80,   // System Data → existing Holetron System Data project
  138: 182,  // Architecture & ADR
  146: 183,  // Knowledge Base → already cloned docs
};

const SKIP_DEV_PROJECTS = new Set([122]);
const CLEANUP_HOL_PROJECTS = [176, 177, 178, 179, 180, 181, 182, 184, 185];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateBaseId() {
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return result;
}

/**
 * Convert boolean values to integers for PostgreSQL integer columns.
 * The pg driver sometimes returns booleans for columns that are actually
 * stored as integer (0/1). This causes "invalid input syntax for type integer"
 * errors on insert.
 */
function boolToInt(val) {
  if (val === true) return 1;
  if (val === false) return 0;
  return val;
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function logErr(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ERROR: ${msg}`);
}

// ─── Step 1: Clean up empty Holetron projects ────────────────────────────────

async function cleanupEmptyProjects(client) {
  log('=== Step 1: Clean up empty Holetron projects ===');

  for (const pid of CLEANUP_HOL_PROJECTS) {
    const { rows: [{ count: dataRows }] } = await client.query(`
      SELECT count(*) FROM table_rows tr
      JOIN universal_tables ut ON tr.table_id = ut.id
      WHERE ut.project_id = $1
    `, [pid]);

    const { rows: [proj] } = await client.query(
      'SELECT name FROM projects WHERE id = $1', [pid]
    );

    if (parseInt(dataRows) === 0) {
      const { rows: tables } = await client.query(
        'SELECT id FROM universal_tables WHERE project_id = $1', [pid]
      );
      for (const t of tables) {
        await client.query('DELETE FROM table_columns WHERE table_id = $1', [t.id]);
        await client.query('DELETE FROM table_rows WHERE table_id = $1', [t.id]);
      }
      await client.query('DELETE FROM universal_tables WHERE project_id = $1', [pid]);
      log(`  Cleaned project ${pid} (${proj ? proj.name : '?'}) — removed ${tables.length} empty tables`);
    } else {
      log(`  Kept project ${pid} (${proj ? proj.name : '?'}) — has ${dataRows} data rows`);
    }
  }
}

// ─── Clone a single table ────────────────────────────────────────────────────

async function cloneTable(client, sourceTable, targetProjectId) {
  // Create new table entry
  const { rows: [newTable] } = await client.query(`
    INSERT INTO universal_tables (
      project_id, name, display_name, description, icon, is_system,
      show_in_nav, order_index, config, table_type, color, folder_path, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id
  `, [
    targetProjectId,
    sourceTable.name,
    sourceTable.display_name,
    sourceTable.description,
    sourceTable.icon,
    boolToInt(sourceTable.is_system) ?? 0,
    boolToInt(sourceTable.show_in_nav) ?? 1,
    boolToInt(sourceTable.order_index) ?? 0,
    sourceTable.config ? (typeof sourceTable.config === 'string' ? sourceTable.config : JSON.stringify(sourceTable.config)) : '{}',
    sourceTable.table_type,
    sourceTable.color,
    sourceTable.folder_path,
    sourceTable.created_by
  ]);

  const newTableId = newTable.id;

  // Copy columns
  const { rows: columns } = await client.query(
    'SELECT * FROM table_columns WHERE table_id = $1 ORDER BY order_index', [sourceTable.id]
  );

  for (const col of columns) {
    await client.query(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config,
        order_index, is_visible, is_required, is_system,
        is_from_source, is_primary_key, is_locked, formula,
        options, required, unique_constraint, default_value,
        is_readonly, width, min_width, max_width, mapping
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    `, [
      newTableId,
      col.column_name,
      col.display_name,
      col.type,
      col.config ? (typeof col.config === 'string' ? col.config : JSON.stringify(col.config)) : null,
      boolToInt(col.order_index) ?? 0,
      boolToInt(col.is_visible) ?? 1,
      boolToInt(col.is_required) ?? 0,
      boolToInt(col.is_system) ?? 0,
      boolToInt(col.is_from_source) ?? 0,
      boolToInt(col.is_primary_key) ?? 0,
      boolToInt(col.is_locked) ?? 0,
      col.formula,
      col.options ? (typeof col.options === 'string' ? col.options : JSON.stringify(col.options)) : null,
      boolToInt(col.required) ?? 0,
      boolToInt(col.unique_constraint) ?? 0,
      col.default_value,
      boolToInt(col.is_readonly) ?? 0,
      col.width,
      col.min_width,
      col.max_width,
      col.mapping
    ]);
  }

  // Copy data rows in batches
  const { rows: dataRows } = await client.query(
    'SELECT * FROM table_rows WHERE table_id = $1', [sourceTable.id]
  );

  const BATCH_SIZE = 500;
  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const batch = dataRows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = [];
    let paramIdx = 1;

    for (const row of batch) {
      const baseId = generateBaseId();
      placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3})`);
      values.push(
        newTableId,
        baseId,
        row.data ? (typeof row.data === 'string' ? row.data : JSON.stringify(row.data)) : '{}',
        row.created_by
      );
      paramIdx += 4;
    }

    await client.query(
      `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES ${placeholders.join(', ')}`,
      values
    );
  }

  return {
    sourceId: sourceTable.id,
    newId: newTableId,
    name: sourceTable.name,
    displayName: sourceTable.display_name,
    columnsCount: columns.length,
    rowsCount: dataRows.length
  };
}

// ─── Get tables with data (excluding form_* and 0-row tables) ────────────────

async function getTablesWithData(client, projectId) {
  const { rows } = await client.query(`
    SELECT ut.*, (SELECT count(*) FROM table_rows WHERE table_id = ut.id) as row_count
    FROM universal_tables ut
    WHERE ut.project_id = $1
    ORDER BY ut.id
  `, [projectId]);

  return rows.filter(t => {
    const rc = parseInt(t.row_count);
    const isForm = t.name.startsWith('form_');
    return rc > 0 && !isForm;
  });
}

// ─── Clone tables for a project with dedup logic ─────────────────────────────

async function cloneProjectTables(client, devProj, holProj, tablesWithData, tableIdMap, results, errors, stats) {
  // Determine which tables to skip (already exist by name in target project)
  const { rows: existingTables } = await client.query(
    'SELECT name FROM universal_tables WHERE project_id = $1', [holProj]
  );
  const existingNames = new Set(existingTables.map(t => t.name));

  const toClone = tablesWithData.filter(t => !existingNames.has(t.name));
  const skipped = tablesWithData.filter(t => existingNames.has(t.name));

  if (skipped.length > 0) {
    log(`  Skipping ${skipped.length} tables already present in Holetron project ${holProj}:`);
    for (const t of skipped) {
      log(`    - ${t.name} (${t.display_name || ''}) [${t.row_count} rows]`);
    }
  }
  log(`  Cloning ${toClone.length} tables...`);

  for (let i = 0; i < toClone.length; i++) {
    const table = toClone[i];
    try {
      await client.query('BEGIN');
      const result = await cloneTable(client, table, holProj);
      await client.query('COMMIT');

      tableIdMap[result.sourceId] = result.newId;
      results.push(result);
      stats.tablesCloned++;
      stats.rowsCloned += result.rowsCount;
      log(`  [${i + 1}/${toClone.length}] OK: ${result.sourceId} -> ${result.newId} | ${result.name} (${result.columnsCount} cols, ${result.rowsCount} rows)`);
    } catch (err) {
      await client.query('ROLLBACK');
      errors.push({ tableId: table.id, name: table.name, error: err.message });
      logErr(`  [${i + 1}/${toClone.length}] FAIL: ${table.id} | ${table.name} | ${err.message}`);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  const tableIdMap = {}; // old_table_id -> new_table_id
  const errors = [];
  const results = [];
  const stats = { tablesCloned: 0, rowsCloned: 0 };

  try {
    // ─── Step 1: Cleanup ───────────────────────────────────────────────
    await client.query('BEGIN');
    await cleanupEmptyProjects(client);
    await client.query('COMMIT');

    // ─── Step 2 & 3: Clone tables per project ──────────────────────────
    log('');
    log('=== Step 2 & 3: Clone tables from Dev to Holetron ===');

    for (const [devProjStr, holProj] of Object.entries(PROJECT_MAP)) {
      const devProj = parseInt(devProjStr);
      if (SKIP_DEV_PROJECTS.has(devProj)) continue;

      const { rows: [devProjInfo] } = await client.query('SELECT name FROM projects WHERE id = $1', [devProj]);
      const { rows: [holProjInfo] } = await client.query('SELECT name FROM projects WHERE id = $1', [holProj]);

      log('');
      log(`--- Dev ${devProj} (${devProjInfo?.name}) -> Holetron ${holProj} (${holProjInfo?.name}) ---`);

      const tablesWithData = await getTablesWithData(client, devProj);
      log(`  Found ${tablesWithData.length} tables with data (non-form)`);

      await cloneProjectTables(client, devProj, holProj, tablesWithData, tableIdMap, results, errors, stats);
    }

    // ─── Step 4: Update relation references ────────────────────────────
    log('');
    log('=== Step 4: Update relation_table references in column configs ===');

    const newTableIds = Object.values(tableIdMap);
    if (newTableIds.length > 0) {
      const { rows: relationCols } = await client.query(`
        SELECT tc.id, tc.table_id, tc.column_name, tc.config
        FROM table_columns tc
        WHERE tc.table_id = ANY($1)
          AND tc.type = 'relation'
          AND tc.config IS NOT NULL
      `, [newTableIds]);

      let updatedCount = 0;
      for (const col of relationCols) {
        let config;
        try {
          config = typeof col.config === 'string' ? JSON.parse(col.config) : col.config;
        } catch (e) {
          continue; // skip unparseable configs
        }
        if (!config) continue;

        let changed = false;

        if (config.relation_table && tableIdMap[config.relation_table]) {
          const oldRef = config.relation_table;
          config.relation_table = tableIdMap[config.relation_table];
          log(`  Col ${col.id} (table ${col.table_id}, "${col.column_name}"): relation_table ${oldRef} -> ${config.relation_table}`);
          changed = true;
        }

        if (config.relatedTableId && tableIdMap[config.relatedTableId]) {
          const oldRef = config.relatedTableId;
          config.relatedTableId = tableIdMap[config.relatedTableId];
          log(`  Col ${col.id} (table ${col.table_id}, "${col.column_name}"): relatedTableId ${oldRef} -> ${config.relatedTableId}`);
          changed = true;
        }

        if (changed) {
          await client.query(
            'UPDATE table_columns SET config = $1 WHERE id = $2',
            [JSON.stringify(config), col.id]
          );
          updatedCount++;
        }
      }
      log(`  Updated ${updatedCount} relation column configs`);
    } else {
      log('  No tables cloned, nothing to update');
    }

    // ─── Summary ───────────────────────────────────────────────────────
    log('');
    log('='.repeat(80));
    log('SUMMARY');
    log('='.repeat(80));
    log(`  Total tables cloned:    ${stats.tablesCloned}`);
    log(`  Total rows cloned:      ${stats.rowsCloned}`);
    log(`  Errors:                 ${errors.length}`);
    log('');

    if (errors.length > 0) {
      log('FAILED TABLES:');
      for (const err of errors) {
        log(`  ${err.tableId} | ${err.name} | ${err.error}`);
      }
      log('');
    }

    log('TABLE ID MAPPING (old -> new):');
    for (const [oldId, newId] of Object.entries(tableIdMap)) {
      const match = results.find(r => r.sourceId === parseInt(oldId));
      log(`  ${oldId} -> ${newId}  ${match ? '| ' + match.name + ' (' + match.rowsCount + ' rows)' : ''}`);
    }

    // Verify final state
    log('');
    log('=== Final Holetron state ===');
    const { rows: holProjects } = await client.query(
      'SELECT id, name FROM projects WHERE space_id = $1 ORDER BY id', [HOL_SPACE_ID]
    );
    for (const p of holProjects) {
      const { rows: [{ count: tc }] } = await client.query(
        'SELECT count(*) FROM universal_tables WHERE project_id = $1', [p.id]
      );
      const { rows: [{ count: rc }] } = await client.query(
        'SELECT count(*) FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id WHERE ut.project_id = $1', [p.id]
      );
      log(`  Project ${p.id} | ${p.name} | tables: ${tc} | rows: ${rc}`);
    }

  } catch (err) {
    logErr('Fatal error: ' + err.message);
    console.error(err.stack);
    try { await client.query('ROLLBACK'); } catch (_) {}
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
