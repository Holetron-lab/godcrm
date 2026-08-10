// backend/database/migrations/knex/052_adr_0016_phase5_files_visibility.js
// ADR-0016 §Phase 5 — first-class `files.visibility` for orphan/chat uploads.
//
// Why: Phases 1+2 (fileGuard) gate /uploads via column.config.visibility, but
// orphan files (column_id IS NULL — chat attachments, agent generations,
// avatars, system uploads) were forced to `private`. Web `<img>` then had to
// proxy every request through fileGuard with cookie-auth and was rejected
// because private also requires space membership lookup that doesn't exist
// for files unbound to a column. Result: every chat image previewed broken.
//
// This migration adds a per-row `visibility` column so orphans can carry
// their own visibility and `fileGuard.lookupFileVisibility` reads it as a
// fallback. Also backfills existing orphan files with `internal` on the URL
// prefixes that historically housed user content.
//
// Acceptance criteria handled here:
//   - new column with check constraint (private | internal | public),
//     default 'private' (closed by default for new inserts that don't say)
//   - backfill: orphan files in /uploads/{spaces,projects,general,3d-models}
//     -> 'internal'; everything else stays at the new default 'private'
//   - both ops idempotent so a re-run is safe.

const PREFIXES_INTERNAL = [
  '/uploads/spaces/%',
  '/uploads/projects/%',
  '/uploads/general/%',
  '/uploads/3d-models/%',
  '/uploads/avatars/%',
];

export async function up(knex) {
  // Add column with CHECK + default in one go. Done as raw SQL because knex's
  // schema builder won't emit a proper CHECK constraint with a list shape on
  // PostgreSQL, and we want the constraint enforced at DB level.
  await knex.raw(`
    ALTER TABLE files
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'internal', 'public'))
  `);

  // Backfill orphan rows whose URL sits under historically user-content
  // prefixes. Anything else (cleanup snapshots, desktop releases, etc.)
  // stays at 'private' — admin can flip to 'public' on a case-by-case basis.
  const updateSql = `
    UPDATE files
       SET visibility = 'internal'
     WHERE column_id IS NULL
       AND visibility = 'private'
       AND (${PREFIXES_INTERNAL.map(() => 'url LIKE ?').join(' OR ')})
  `;
  const result = await knex.raw(updateSql, PREFIXES_INTERNAL);
  // pg returns { rowCount } on raw UPDATE; sqlite uses .changes — log either.
  const updated = result?.rowCount ?? result?.changes ?? 0;
  // eslint-disable-next-line no-console
  console.log(`[052_adr_0016_phase5] backfilled ${updated} orphan files to visibility='internal'`);
}

export async function down(knex) {
  await knex.raw('ALTER TABLE files DROP COLUMN IF EXISTS visibility');
}
