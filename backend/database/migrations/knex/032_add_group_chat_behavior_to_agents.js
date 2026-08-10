/**
 * Migration 032: Add group_chat_behavior column to AI Agents tables
 * Ticket #40734 / ADR-085
 *
 * Adds a `group_chat_behavior` select column to every AI Agents universal table
 * (table_columns metadata) and backfills existing agent rows' JSON data
 * with the default value 'always_respond'.
 *
 * group_chat_behavior options:
 *   - 'always_respond' — Agent responds to every message in group chats
 *   - 'mention_only'   — Agent only responds when explicitly @mentioned or /commanded
 *   - 'silent'         — Agent never auto-responds in group chats (still responds in solo)
 *
 * Default: 'always_respond' — backward compatible with existing behavior.
 *
 * This is separate from the `response_mode` column (migration 030) which controls
 * per-conversation overrides. `group_chat_behavior` is a global agent-level setting
 * that defines the agent's default behavior in group conversations.
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
    icon: '👥',
    options: [
      { value: 'always_respond', label: 'Always respond' },
      { value: 'mention_only', label: 'Mention only' },
      { value: 'silent', label: 'Silent' }
    ],
    defaultValue: 'always_respond'
  });

  for (const table of tables) {
    const tableId = table.id;

    // Step 1: Add group_chat_behavior to table_columns if not already present
    const existingCol = await knex.raw(
      isPostgres
        ? `SELECT id FROM table_columns WHERE table_id = $1 AND column_name = 'group_chat_behavior' LIMIT 1`
        : `SELECT id FROM table_columns WHERE table_id = ? AND column_name = 'group_chat_behavior' LIMIT 1`,
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
             VALUES ($1, 'group_chat_behavior', 'Group Chat Behavior', 'select', $2::jsonb, 170, false, $3, NOW(), NOW())`
          : `INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
             VALUES (?, 'group_chat_behavior', 'Group Chat Behavior', 'select', ?, 170, 0, ?, datetime('now'), datetime('now'))`,
        [tableId, columnConfig, nextOrder]
      );
      console.log(`[Migration 032] Added group_chat_behavior column to table_columns for table ${tableId} (${table.name})`);
    } else {
      console.log(`[Migration 032] group_chat_behavior column already exists in table_columns for table ${tableId}, skipping`);
    }

    // Step 2: Backfill existing agent rows with group_chat_behavior = 'always_respond' in JSON data
    if (isPostgres) {
      const result = await knex.raw(`
        UPDATE table_rows
        SET data = jsonb_set(data::jsonb, '{group_chat_behavior}', '"always_respond"'),
            updated_at = NOW()
        WHERE table_id = $1
          AND (data::jsonb ->> 'group_chat_behavior') IS NULL
      `, [tableId]);
      const count = result.rowCount || 0;
      if (count > 0) {
        console.log(`[Migration 032] Backfilled ${count} agent rows with group_chat_behavior='always_respond' in table ${tableId}`);
      }
    } else {
      // SQLite: fetch and update individually
      const rowsMissing = await knex.raw(`
        SELECT id, data FROM table_rows
        WHERE table_id = ?
          AND json_extract(data, '$.group_chat_behavior') IS NULL
      `, [tableId]);

      let count = 0;
      for (const row of rowsMissing) {
        try {
          const parsed = JSON.parse(row.data || '{}');
          parsed.group_chat_behavior = 'always_respond';
          await knex.raw(
            `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
            [JSON.stringify(parsed), row.id]
          );
          count++;
        } catch (parseErr) {
          console.warn(`[Migration 032] Failed to parse data for row ${row.id}, skipping`);
        }
      }
      if (count > 0) {
        console.log(`[Migration 032] Backfilled ${count} agent rows with group_chat_behavior='always_respond' in table ${tableId}`);
      }
    }
  }

  console.log(`[Migration 032] Completed: processed ${tables.length} AI Agents tables`);
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
    // Remove group_chat_behavior column metadata
    await knex.raw(
      isPostgres
        ? `DELETE FROM table_columns WHERE table_id = $1 AND column_name = 'group_chat_behavior'`
        : `DELETE FROM table_columns WHERE table_id = ? AND column_name = 'group_chat_behavior'`,
      [table.id]
    );

    // Remove group_chat_behavior from row JSON data
    if (isPostgres) {
      await knex.raw(`
        UPDATE table_rows
        SET data = data::jsonb - 'group_chat_behavior',
            updated_at = NOW()
        WHERE table_id = $1
          AND data::jsonb ? 'group_chat_behavior'
      `, [table.id]);
    } else {
      const rows = await knex.raw(
        `SELECT id, data FROM table_rows WHERE table_id = ? AND json_extract(data, '$.group_chat_behavior') IS NOT NULL`,
        [table.id]
      );
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data || '{}');
          delete parsed.group_chat_behavior;
          await knex.raw(
            `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
            [JSON.stringify(parsed), row.id]
          );
        } catch (parseErr) {
          // skip
        }
      }
    }

    console.log(`[Migration 032 DOWN] Removed group_chat_behavior from table ${table.id} (${table.name})`);
  }
}
