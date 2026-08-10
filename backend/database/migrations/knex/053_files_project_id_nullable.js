// Migration 053: T-138802 — make files.project_id nullable.
//
// Why: system uploads (avatars, agent generations, document snapshots,
// chat attachments uploaded without an active project context) genuinely
// have no owning project. The previous NOT NULL constraint forced every
// caller to invent or look up a project_id, and the MCP `upload_file` tool
// just dropped the column from the INSERT — DB then rejected with
// "null value in column \"project_id\" violates not-null constraint".
//
// No FK was attached and no backend code reads `files.project_id` as a
// non-null invariant (verified via grep). Existing rows already carry
// project_id values, so dropping NOT NULL has no data effect.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    // SQLite: column was created via knex schema builder which already
    // allows NULL by default — nothing to do.
    return;
  }
  await knex.raw('ALTER TABLE files ALTER COLUMN project_id DROP NOT NULL');
  console.log('[Migration 053] files.project_id is now nullable');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;
  // Reinstating NOT NULL would fail if any rows now have null project_id;
  // backfill to a sentinel project before reversing in production.
  await knex.raw(`
    UPDATE files SET project_id = 0 WHERE project_id IS NULL
  `);
  await knex.raw('ALTER TABLE files ALTER COLUMN project_id SET NOT NULL');
}
