/**
 * Clone all doc_* tables from project 146 (Development/Knowledge Base)
 * to project 183 (Holetron/Knowledge Base)
 *
 * Usage: node backend/scripts/clone-doc-tables.js
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

const SOURCE_PROJECT_ID = 146;
const TARGET_PROJECT_ID = 183;

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateBaseId() {
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return result;
}

async function cloneTable(client, sourceTableId) {
  // Get source table
  const { rows: [source] } = await client.query(
    'SELECT * FROM universal_tables WHERE id = $1', [sourceTableId]
  );
  if (!source) throw new Error(`Table ${sourceTableId} not found`);

  // Get columns
  const { rows: columns } = await client.query(
    'SELECT * FROM table_columns WHERE table_id = $1 ORDER BY order_index', [sourceTableId]
  );

  // Get rows
  const { rows: dataRows } = await client.query(
    'SELECT * FROM table_rows WHERE table_id = $1', [sourceTableId]
  );

  // Create new table
  const { rows: [newTable] } = await client.query(`
    INSERT INTO universal_tables (
      project_id, name, display_name, description, icon, is_system,
      show_in_nav, order_index, config, table_type, color, folder_path
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
  `, [
    TARGET_PROJECT_ID,
    source.name,
    source.display_name,
    source.description,
    source.icon,
    source.is_system || 0,
    source.show_in_nav,
    source.order_index || 0,
    source.config || '{}',
    source.table_type,
    source.color,
    source.folder_path
  ]);

  const newTableId = newTable.id;

  // Copy columns
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
      col.config,
      col.order_index,
      col.is_visible,
      col.is_required,
      col.is_system,
      col.is_from_source,
      col.is_primary_key,
      col.is_locked,
      col.formula,
      col.options,
      col.required,
      col.unique_constraint,
      col.default_value,
      col.is_readonly,
      col.width,
      col.min_width,
      col.max_width,
      col.mapping
    ]);
  }

  // Copy data rows
  for (const row of dataRows) {
    const baseId = generateBaseId();
    await client.query(`
      INSERT INTO table_rows (table_id, base_id, data, created_by)
      VALUES ($1, $2, $3, $4)
    `, [newTableId, baseId, row.data, row.created_by]);
  }

  return {
    sourceId: sourceTableId,
    newId: newTableId,
    name: source.name,
    displayName: source.display_name,
    columnsCount: columns.length,
    rowsCount: dataRows.length
  };
}

async function main() {
  const client = await pool.connect();

  try {
    // Get all doc_* tables from source project
    const { rows: docTables } = await client.query(
      `SELECT id, name, display_name FROM universal_tables
       WHERE project_id = $1 AND name LIKE 'doc_%'
       ORDER BY id`,
      [SOURCE_PROJECT_ID]
    );

    console.log(`Found ${docTables.length} doc_* tables in project ${SOURCE_PROJECT_ID}`);
    console.log('='.repeat(80));

    const mapping = [];
    const errors = [];
    let successCount = 0;

    for (let i = 0; i < docTables.length; i++) {
      const table = docTables[i];
      try {
        // Use a transaction per table so failures don't cascade
        await client.query('BEGIN');
        const result = await cloneTable(client, table.id);
        await client.query('COMMIT');

        mapping.push(result);
        successCount++;
        console.log(`[${i + 1}/${docTables.length}] OK: ${result.sourceId} -> ${result.newId} | ${result.name} (${result.columnsCount} cols, ${result.rowsCount} rows)`);
      } catch (err) {
        await client.query('ROLLBACK');
        errors.push({ tableId: table.id, name: table.name, error: err.message });
        console.error(`[${i + 1}/${docTables.length}] FAIL: ${table.id} | ${table.name} | ${err.message}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\nSUMMARY:`);
    console.log(`  Total doc tables found: ${docTables.length}`);
    console.log(`  Successfully cloned: ${successCount}`);
    console.log(`  Failed: ${errors.length}`);

    if (errors.length > 0) {
      console.log(`\nFAILED TABLES:`);
      for (const err of errors) {
        console.log(`  ${err.tableId} | ${err.name} | ${err.error}`);
      }
    }

    console.log(`\nCOMPLETE MAPPING (SOURCE_ID -> NEW_ID):`);
    console.log(JSON.stringify(mapping.map(m => ({
      sourceId: m.sourceId,
      newId: m.newId,
      name: m.name,
      displayName: m.displayName
    })), null, 2));

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
