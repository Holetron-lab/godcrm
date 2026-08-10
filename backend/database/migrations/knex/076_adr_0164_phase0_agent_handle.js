// Migration 076: ADR-164 Phase 0 — Agent Passport & Residence Topology (schema).
//
// D2: users.handle — globally unique slug for `<<@slug>>` routing, owned by the
//     passport (users row), not by any space-level agents table.
// D6: one passport per residence — UNIQUE (managed_by_agent_table_id,
//     managed_by_agent_row_id) WHERE user_type='agent'. Rows with NULL pointer
//     columns stay distinct (PG NULLS DISTINCT), so passports without a
//     residence do not conflict.
//
// Backfill covers ONLY the manually verified core-agent list from table 1784
// (space 11). Everything else keeps handle = NULL until an explicit
// issue_passport (Phase 2). This migration creates no users rows: agents whose
// passport was never auto-minted are skipped and logged.
//
// Dirty-data policy: all integrity checks run BEFORE any DDL and throw with an
// actionable message, so a failed run leaves the schema untouched (knex wraps
// the migration in a transaction either way).

const HANDLE_INDEX = 'users_handle_lower_unique';
const RESIDENCE_INDEX = 'users_agent_residence_unique';

const AGENTS_TABLE_ID = 1784; // 'AI Agents' in space 11 — core agents' residence

// Manually verified core-agent list (ADR-164 Phase 0 §2): row id in table 1784
// → global handle. Matches the `slug` column of each row as of 2026-07-05.
const CORE_HANDLES = [
  { rowId: 31112, handle: 'orchestrator' },
  { rowId: 31113, handle: 'developer-ralph' },
  { rowId: 31114, handle: 'frontend-developer' },
  { rowId: 31115, handle: 'test-runner' },
  { rowId: 33484, handle: 'sysadmin' },
  { rowId: 33485, handle: 'frontend-qa' },
  { rowId: 33491, handle: 'architect' },
  { rowId: 110507, handle: 'agent-smith' },
  { rowId: 152693, handle: 'officenet' },
  { rowId: 153581, handle: 'watchdog' },
  { rowId: 166740, handle: 'cryptoralph' },
  { rowId: 187025, handle: 'logistics-consultant' },
];

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 076] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  // --- Pre-flight 1: two passports pointing at the same residence would make
  // the D6 index fail halfway. Refuse loudly; duplicates are resolved manually
  // with the owner (ADR-164 Risks table), never auto-deleted.
  const dupes = await knex.raw(`
    SELECT managed_by_agent_table_id AS table_id,
           managed_by_agent_row_id   AS row_id,
           array_agg(id ORDER BY id) AS user_ids,
           array_agg(email ORDER BY id) AS emails
      FROM users
     WHERE user_type = 'agent'
       AND managed_by_agent_table_id IS NOT NULL
       AND managed_by_agent_row_id IS NOT NULL
     GROUP BY 1, 2
    HAVING count(*) > 1
  `);
  if (dupes.rows.length > 0) {
    const detail = dupes.rows
      .map((r) => `  residence (${r.table_id}, ${r.row_id}) ← users ${r.user_ids.join(', ')} [${r.emails.join(', ')}]`)
      .join('\n');
    throw new Error(
      `[Migration 076] ${dupes.rows.length} residence(s) have multiple agent passports — ` +
      `resolve manually before re-running (ADR-164 Phase 0 pre-migration audit):\n${detail}`
    );
  }

  // --- Pre-flight 2: a handle we are about to backfill must not already be
  // taken by a different user (case-insensitive), or the D2 index would fail.
  const hasHandle = await knex.schema.hasColumn('users', 'handle');
  if (hasHandle) {
    for (const { rowId, handle } of CORE_HANDLES) {
      const clash = await knex.raw(
        `SELECT id, email FROM users
          WHERE lower(handle) = lower(?)
            AND NOT (managed_by_agent_table_id = ? AND managed_by_agent_row_id = ?)`,
        [handle, AGENTS_TABLE_ID, rowId]
      );
      if (clash.rows.length > 0) {
        throw new Error(
          `[Migration 076] handle '${handle}' already taken by users ` +
          `${clash.rows.map((r) => `${r.id} (${r.email})`).join(', ')} — resolve manually before re-running.`
        );
      }
    }
  }

  if (!hasHandle) {
    await knex.schema.alterTable('users', (table) => {
      table.text('handle').nullable();
    });
  }

  // --- Backfill core agents. Idempotent: only touches rows whose handle is
  // NULL; skipped agents (no auto-minted passport) get one via issue_passport
  // in Phase 2 instead.
  for (const { rowId, handle } of CORE_HANDLES) {
    const updated = await knex('users')
      .where({
        user_type: 'agent',
        managed_by_agent_table_id: AGENTS_TABLE_ID,
        managed_by_agent_row_id: rowId,
      })
      .whereNull('handle')
      .update({ handle });
    const existing = updated === 0
      ? await knex('users').where({ managed_by_agent_table_id: AGENTS_TABLE_ID, managed_by_agent_row_id: rowId }).whereNotNull('handle').first('id')
      : null;
    if (updated > 0) {
      console.log(`[Migration 076] handle '${handle}' → residence (${AGENTS_TABLE_ID}, ${rowId})`);
    } else if (existing) {
      console.log(`[Migration 076] handle for residence (${AGENTS_TABLE_ID}, ${rowId}) already set — skipped`);
    } else {
      console.log(`[Migration 076] no passport for residence (${AGENTS_TABLE_ID}, ${rowId}) — skipped (issue_passport in Phase 2)`);
    }
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${HANDLE_INDEX}
      ON users (lower(handle))
   WHERE handle IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${RESIDENCE_INDEX}
      ON users (managed_by_agent_table_id, managed_by_agent_row_id)
   WHERE user_type = 'agent'
  `);

  console.log(`[Migration 076] users.handle + ${HANDLE_INDEX} + ${RESIDENCE_INDEX} ensured`);
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS ${HANDLE_INDEX}`);
  await knex.raw(`DROP INDEX IF EXISTS ${RESIDENCE_INDEX}`);
  const hasHandle = await knex.schema.hasColumn('users', 'handle');
  if (hasHandle) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('handle');
    });
  }
  console.log('[Migration 076] users.handle and ADR-164 indexes removed');
}
