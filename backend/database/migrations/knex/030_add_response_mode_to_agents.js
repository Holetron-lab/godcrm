/**
 * Migration 030: Add response_mode column to AI Agents tables (ADR-091 Phase 1 Task 2)
 *
 * Adds a `response_mode` select column to every AI Agents universal table
 * (table_columns metadata) and backfills existing agent rows' JSON data
 * with the default value 'mention_only'.
 *
 * response_mode options:
 *   - 'always'       — Always respond in group chats
 *   - 'topic_only'   — Respond only when message is topic-relevant
 *   - 'mention_only' — Only respond when explicitly @mentioned or /commanded
 *
 * Default: 'mention_only' — backward compatible with ADR-078 solo/group logic.
 * In solo chat (1 human + 1 agent), agent always auto-responds regardless of
 * response_mode; the setting only affects group chat behavior.
 *
 * Two-level resolution (ADR-091 D3):
 *   1. Per-conversation override (sub_agents JSONB / conversation_participants)
 *   2. Global agent config (this column on AI Agents table row data)
 *   3. Fallback default: 'mention_only'
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // Find all AI Agents tables (match various naming conventions)
  const agentsTables = await knex.raw(
    isPostgres
      ? `SELECT ut.id, ut.name
         FROM universal_tables ut
         WHERE LOWER(ut.name) = 'agents'
           OR LOWER(ut.name) = 'ai agents'
           OR LOWER(ut.name) LIKE '%ai_agents%'
           OR ut.name LIKE '%Agents%'
           OR ut.name LIKE '%agents%'`
      : `SELECT ut.id, ut.name
         FROM universal_tables ut
         WHERE LOWER(ut.name) = 'agents'
           OR LOWER(ut.name) = 'ai agents'
           OR LOWER(ut.name) LIKE '%ai_agents%'
           OR ut.name LIKE '%Agents%'
           OR ut.name LIKE '%agents%'`
  );

  const tables = isPostgres ? agentsTables.rows : agentsTables;

  const columnConfig = JSON.stringify({
    icon: '💬',
    options: [
      { value: 'always', label: 'Always respond' },
      { value: 'topic_only', label: 'Topic only' },
      { value: 'mention_only', label: 'Mention only' }
    ],
    defaultValue: 'mention_only'
  });

  for (const table of tables) {
    const tableId = table.id;

    // Step 1: Add response_mode to table_columns if not already present
    const existingCol = await knex.raw(
      isPostgres
        ? `SELECT id FROM table_columns WHERE table_id = $1 AND column_name = 'response_mode' LIMIT 1`
        : `SELECT id FROM table_columns WHERE table_id = ? AND column_name = 'response_mode' LIMIT 1`,
      [tableId]
    );
    const existingRows = isPostgres ? existingCol.rows : existingCol;

    if (!existingRows || existingRows.length === 0) {
      // Get next order_index
      const maxOrderResult = await knex.raw(
        isPostgres
          ? `SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM table_columns WHERE table_id = $1`
          : `SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM table_columns WHERE table_id = ?`,
        [tableId]
      );
      const nextOrder = isPostgres
        ? maxOrderResult.rows[0].next_order
        : maxOrderResult[0].next_order;

      await knex.raw(
        isPostgres
          ? `INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
             VALUES ($1, 'response_mode', 'Response Mode', 'select', $2::jsonb, 150, false, $3, NOW(), NOW())`
          : `INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
             VALUES (?, 'response_mode', 'Response Mode', 'select', ?, 150, 0, ?, datetime('now'), datetime('now'))`,
        [tableId, columnConfig, nextOrder]
      );
      console.log(`[Migration 030] Added response_mode column to table_columns for table ${tableId} (${table.name})`);
    } else {
      console.log(`[Migration 030] response_mode column already exists in table_columns for table ${tableId}, skipping`);
    }

    // Step 2: Backfill existing agent rows with response_mode = 'mention_only' in JSON data
    if (isPostgres) {
      const result = await knex.raw(`
        UPDATE table_rows
        SET data = jsonb_set(data::jsonb, '{response_mode}', '"mention_only"'),
            updated_at = NOW()
        WHERE table_id = $1
          AND (data::jsonb ->> 'response_mode') IS NULL
      `, [tableId]);
      const count = result.rowCount || 0;
      if (count > 0) {
        console.log(`[Migration 030] Backfilled ${count} agent rows with response_mode='mention_only' in table ${tableId}`);
      }
    } else {
      // SQLite: fetch and update individually
      const rowsMissing = await knex.raw(`
        SELECT id, data FROM table_rows
        WHERE table_id = ?
          AND json_extract(data, '$.response_mode') IS NULL
      `, [tableId]);

      let count = 0;
      for (const row of rowsMissing) {
        try {
          const parsed = JSON.parse(row.data || '{}');
          parsed.response_mode = 'mention_only';
          await knex.raw(
            `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
            [JSON.stringify(parsed), row.id]
          );
          count++;
        } catch (parseErr) {
          console.warn(`[Migration 030] Failed to parse data for row ${row.id}, skipping`);
        }
      }
      if (count > 0) {
        console.log(`[Migration 030] Backfilled ${count} agent rows with response_mode='mention_only' in table ${tableId}`);
      }
    }
  }

  console.log(`[Migration 030] Completed: processed ${tables.length} AI Agents tables`);
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // Find all AI Agents tables
  const agentsTables = await knex.raw(
    isPostgres
      ? `SELECT ut.id, ut.name
         FROM universal_tables ut
         WHERE LOWER(ut.name) = 'agents'
           OR LOWER(ut.name) = 'ai agents'
           OR LOWER(ut.name) LIKE '%ai_agents%'
           OR ut.name LIKE '%Agents%'
           OR ut.name LIKE '%agents%'`
      : `SELECT ut.id, ut.name
         FROM universal_tables ut
         WHERE LOWER(ut.name) = 'agents'
           OR LOWER(ut.name) = 'ai agents'
           OR LOWER(ut.name) LIKE '%ai_agents%'
           OR ut.name LIKE '%Agents%'
           OR ut.name LIKE '%agents%'`
  );

  const tables = isPostgres ? agentsTables.rows : agentsTables;

  for (const table of tables) {
    // Remove response_mode column metadata
    await knex.raw(
      isPostgres
        ? `DELETE FROM table_columns WHERE table_id = $1 AND column_name = 'response_mode'`
        : `DELETE FROM table_columns WHERE table_id = ? AND column_name = 'response_mode'`,
      [table.id]
    );

    // Remove response_mode from row JSON data
    if (isPostgres) {
      await knex.raw(`
        UPDATE table_rows
        SET data = data::jsonb - 'response_mode',
            updated_at = NOW()
        WHERE table_id = $1
          AND data::jsonb ? 'response_mode'
      `, [table.id]);
    } else {
      const rows = await knex.raw(
        `SELECT id, data FROM table_rows WHERE table_id = ? AND json_extract(data, '$.response_mode') IS NOT NULL`,
        [table.id]
      );
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data || '{}');
          delete parsed.response_mode;
          await knex.raw(
            `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
            [JSON.stringify(parsed), row.id]
          );
        } catch (parseErr) {
          // skip
        }
      }
    }

    console.log(`[Migration 030 DOWN] Removed response_mode from table ${table.id} (${table.name})`);
  }
}
