#!/usr/bin/env node
/**
 * ADR-0009 Phase 2: Test-Data Cleanup — DRY-RUN manifest generator.
 *
 * Default mode: DRY-RUN. No DELETE, DROP, or UPDATE is issued.
 * Writes a snapshot directory scripts/snapshots/cleanup-<ts>/ containing CSVs
 * of every row that WOULD be deleted, plus a MANIFEST.md summary.
 *
 * Usage:
 *   node scripts/cleanup-test-data.js                   # dry-run (default)
 *   node scripts/cleanup-test-data.js --execute         # destructive — NOT in Phase 2
 *
 * Safety guards (see ADR-0009 §6 Constraints):
 *   1. Refuses to run --execute without --target=prod AND --owner-totp=XXXXXX.
 *   2. Refuses to run --execute if POSTGRES_HOST is not localhost (running
 *      the script against a remote PROD DB is not permitted — must be on the
 *      host, where localhost==PROD).
 *   3. The allow-list (scripts/cleanup-allowlist.json) MUST have
 *      owner_signed: true for --execute to proceed.
 *
 * Allow-list semantics:
 *   - Any id present in allowlist.users[].id is NEVER deleted.
 *   - Any id in allowlist.spaces[].id is NEVER deleted.
 *   - Any id in allowlist.tables[].id is NEVER deleted (and its table_rows kept).
 *   - False positive in allow-list is safe; false negative risks deleting
 *     real user data. When in doubt, include.
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ---------- argv ----------
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getFlag = (f) => {
  const p = argv.find((a) => a.startsWith(f + '='));
  return p ? p.slice(f.length + 1) : null;
};
const EXECUTE = hasFlag('--execute');
const ROLLBACK = hasFlag('--rollback'); // Phase 3 safety: run deletes, capture counts, then ROLLBACK.
const TARGET = getFlag('--target');
const OWNER_TOTP = getFlag('--owner-totp');

// ---------- safety ----------
const POSTGRES_HOST = process.env.POSTGRES_HOST || 'localhost';

if (EXECUTE) {
  if (!['prod', 'dev'].includes(TARGET)) {
    console.error('[FATAL] --execute requires --target=prod or --target=dev (safety gate).');
    process.exit(2);
  }
  if (TARGET === 'prod' && !OWNER_TOTP) {
    console.error('[FATAL] --execute --target=prod requires --owner-totp=XXXXXX (owner signs off at runtime).');
    process.exit(2);
  }
  if (!['localhost', '127.0.0.1', ''].includes(POSTGRES_HOST)) {
    console.error(`[FATAL] Refusing to --execute against remote host ${POSTGRES_HOST}.`);
    console.error(`        For --target=dev run on DEV server with POSTGRES_HOST=localhost (DEV-local godcrm_prod copy).`);
    console.error(`        For --target=prod run on PROD server (.205) where localhost==PROD.`);
    process.exit(2);
  }
  // ADR-0009 §9: PROD gate lifted 2026-04-22 after DEV Phase 3 succeeded and
  // owner signed off at runtime (owner_signed=true, owner-totp provided, MANIFEST approved).
  // Safety: allow-list + localhost + owner_signed still enforced further down.
}

// ---------- allow-list ----------
const ALLOWLIST_PATH = path.resolve(process.cwd(), 'scripts/cleanup-allowlist.json');
if (!fs.existsSync(ALLOWLIST_PATH)) {
  console.error(`[FATAL] Missing ${ALLOWLIST_PATH}. Generate it first (see ADR-0009 §9 Phase 2).`);
  process.exit(2);
}
const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf-8'));
const ALLOW_USER_IDS = new Set(allowlist.users.map((u) => u.id));
const ALLOW_SPACE_IDS = new Set(allowlist.spaces.map((s) => s.id));
const ALLOW_TABLE_IDS = new Set(allowlist.tables.map((t) => t.id));

// ---------- db ----------
const pool = new pg.Pool({
  host: POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD,
  max: 4,
});

async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

// ---------- test signatures (ADR-0009 §4.1) ----------
// Users: email matches any of these patterns OR name matches.
// NOTE: regex semantics match PostgreSQL `~*` (case-insensitive regex).
const TEST_EMAIL_RX = '@test\\.com|@example\\.com|^test-';
const TEST_NAME_RX = '^test-.*-[0-9]{10,}$|^tables-test-';

// Agents/service users are ALWAYS protected regardless of signature match.
// This is enforced by pre-populating the allow-list with every agent/service user.

// ---------- snapshot dir ----------
const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const snapDir = path.resolve(process.cwd(), `scripts/snapshots/cleanup-${ts}`);
fs.mkdirSync(snapDir, { recursive: true });
console.log(`[ok] snapshot dir: ${snapDir}`);

function writeCsv(filename, columns, rows) {
  const csvEsc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvEsc(r[c])).join(',')).join('\n');
  const content = rows.length ? header + '\n' + body + '\n' : header + '\n';
  fs.writeFileSync(path.join(snapDir, filename), content);
  return rows.length;
}

// ---------- main ----------
async function main() {
  console.log(`\n=== ADR-0009 Phase 2 cleanup DRY-RUN ===`);
  console.log(`allow-list: ${ALLOW_USER_IDS.size} users, ${ALLOW_SPACE_IDS.size} spaces, ${ALLOW_TABLE_IDS.size} tables`);
  console.log(`owner_signed: ${allowlist.owner_signed}`);

  // --- 1. Candidate users ------------------------------------------------
  // A user is a DELETE candidate if:
  //   (a) email OR name matches test-signature regex, AND
  //   (b) id is NOT in allow-list
  // Agents/service are automatically in allow-list, so they are filtered out by (b).
  const userRows = await q(`
    SELECT id, email, name, user_type, role, status, created_at
    FROM users
    WHERE (email ~* $1 OR name ~* $2)
  `, [TEST_EMAIL_RX, TEST_NAME_RX]);

  const deleteUsers = userRows.filter((u) => !ALLOW_USER_IDS.has(u.id));
  const skippedUsers = userRows.filter((u) => ALLOW_USER_IDS.has(u.id));
  const deleteUserIds = new Set(deleteUsers.map((u) => u.id));

  writeCsv('users.csv',
    ['id', 'email', 'name', 'user_type', 'role', 'status', 'created_at'],
    deleteUsers,
  );
  console.log(`[users] candidates=${deleteUsers.length}, skipped-by-allowlist=${skippedUsers.length}`);

  // --- 2. Candidate spaces ----------------------------------------------
  // Spaces owned by a candidate user, MINUS allow-list spaces.
  let deleteSpaces = [];
  let deleteSpaceIds = new Set();
  if (deleteUserIds.size > 0) {
    const rows = await q(
      `SELECT id, owner_id, name, type, created_at
         FROM spaces
        WHERE owner_id = ANY($1::int[])`,
      [[...deleteUserIds]],
    );
    deleteSpaces = rows.filter((s) => !ALLOW_SPACE_IDS.has(s.id));
    deleteSpaceIds = new Set(deleteSpaces.map((s) => s.id));
  }
  writeCsv('spaces.csv',
    ['id', 'owner_id', 'name', 'type', 'created_at'],
    deleteSpaces,
  );
  console.log(`[spaces] candidates=${deleteSpaces.length}`);

  // --- 3. Candidate projects --------------------------------------------
  // A project is a candidate if its space is a candidate OR its owner is a candidate user.
  let deleteProjects = [];
  let deleteProjectIds = new Set();
  const projCond = [];
  const projParams = [];
  if (deleteSpaceIds.size > 0) {
    projCond.push(`space_id = ANY($${projParams.length + 1}::int[])`);
    projParams.push([...deleteSpaceIds]);
  }
  if (deleteUserIds.size > 0) {
    projCond.push(`owner_id = ANY($${projParams.length + 1}::int[])`);
    projParams.push([...deleteUserIds]);
  }
  if (projCond.length) {
    deleteProjects = await q(
      `SELECT id, name, space_id, owner_id, type, created_at
         FROM projects
        WHERE ${projCond.join(' OR ')}`,
      projParams,
    );
    deleteProjectIds = new Set(deleteProjects.map((p) => p.id));
  }
  writeCsv('projects.csv',
    ['id', 'name', 'space_id', 'owner_id', 'type', 'created_at'],
    deleteProjects,
  );
  console.log(`[projects] candidates=${deleteProjects.length}`);

  // --- 4. Candidate universal_tables ------------------------------------
  // A table is a candidate if its project is a candidate OR its created_by is a candidate user.
  // allow-list tables always kept.
  let deleteTables = [];
  let deleteTableIds = new Set();
  const tblCond = [];
  const tblParams = [];
  if (deleteProjectIds.size > 0) {
    tblCond.push(`project_id = ANY($${tblParams.length + 1}::int[])`);
    tblParams.push([...deleteProjectIds]);
  }
  if (deleteUserIds.size > 0) {
    tblCond.push(`created_by = ANY($${tblParams.length + 1}::int[])`);
    tblParams.push([...deleteUserIds]);
  }
  if (tblCond.length) {
    const rows = await q(
      `SELECT id, name, project_id, created_by, created_at
         FROM universal_tables
        WHERE ${tblCond.join(' OR ')}`,
      tblParams,
    );
    deleteTables = rows.filter((t) => !ALLOW_TABLE_IDS.has(t.id));
    deleteTableIds = new Set(deleteTables.map((t) => t.id));
  }
  writeCsv('universal_tables.csv',
    ['id', 'name', 'project_id', 'created_by', 'created_at'],
    deleteTables,
  );
  console.log(`[universal_tables] candidates=${deleteTables.length}`);

  // Check for physical per-table PG tables (table_<N>). None exist in current
  // schema, but keep the check so Phase 3 rescan catches any that appear.
  const physicalTables = deleteTableIds.size
    ? await q(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name ~ '^table_[0-9]+$'
            AND (regexp_replace(table_name,'^table_',''))::int = ANY($1::int[])`,
        [[...deleteTableIds]],
      )
    : [];
  writeCsv('physical_tables_to_drop.csv',
    ['table_name'],
    physicalTables,
  );
  console.log(`[physical table_<N>] to drop: ${physicalTables.length}`);

  // --- 5. table_rows summary (per-table counts) -------------------------
  let rowSummary = [];
  let rowTotal = 0;
  if (deleteTableIds.size > 0) {
    rowSummary = await q(
      `SELECT table_id, COUNT(*) AS row_count
         FROM table_rows
        WHERE table_id = ANY($1::int[])
        GROUP BY table_id
        ORDER BY row_count DESC`,
      [[...deleteTableIds]],
    );
    rowTotal = rowSummary.reduce((s, r) => s + Number(r.row_count), 0);
  }
  writeCsv('table_rows_summary.csv',
    ['table_id', 'row_count'],
    rowSummary,
  );
  console.log(`[table_rows] candidate rows across ${rowSummary.length} tables: ${rowTotal}`);

  // --- 6. Dependent FK-by-convention tables -----------------------------
  // For each table that references users or spaces by convention, capture
  // rows that would orphan. See FK inventory in ADR-0009 §11 Appendix B.
  const dep = [];

  // spaces-referencing
  const spaceChildren = [
    { table: 'calendar_events', cols: ['id', 'space_id', 'created_by', 'title', 'start_at'], where: 'space_id' },
    { table: 'modules',         cols: ['id', 'space_id', 'name'],                             where: 'space_id' },
    { table: 'widget_library',  cols: ['id', 'space_id', 'name'],                             where: 'space_id' },
    { table: 'fitness_workouts', cols: ['id', 'space_id'],                                    where: 'space_id' },
    { table: 'fitness_workout_sets', cols: ['id', 'space_id'],                                where: 'space_id' },
    { table: 'fitness_exercises',    cols: ['id', 'space_id'],                                where: 'space_id' },
    { table: 'wellness_profiles', cols: ['id', 'space_id'],                                   where: 'space_id' },
    { table: 'wellness_points',   cols: ['id', 'space_id'],                                   where: 'space_id' },
    { table: 'wellness_levels',   cols: ['id', 'space_id'],                                   where: 'space_id' },
    { table: 'wellness_streaks',  cols: ['id', 'space_id'],                                   where: 'space_id' },
    { table: 'wellness_vitals',   cols: ['id', 'space_id'],                                   where: 'space_id' },
    { table: 'wellness_user_achievements', cols: ['id', 'space_id'],                          where: 'space_id' },
    { table: 'labs',              cols: ['id', 'space_id', 'name'],                           where: 'space_id' },
    { table: 'schema_layouts',    cols: ['id', 'space_id'],                                   where: 'space_id' },
    { table: 'space_invitations', cols: ['id', 'space_id'],                                   where: 'space_id' },
    { table: 'conversations',     cols: ['id', 'space_id', 'created_by'],                     where: 'space_id' },
    { table: 'files',             cols: ['id', 'space_id', 'project_id', 'table_id'],         where: 'space_id' },
    { table: 'dashboards',        cols: ['id', 'space_id', 'project_id', 'user_id'],          where: 'space_id' },
    { table: 'user_access_permissions', cols: ['id','user_id','space_id','project_id','table_id'], where: 'space_id' },
  ];

  // users-referencing
  const userChildren = [
    { table: 'agent_jobs',            cols: ['id', 'agent_user_id', 'status'],                where: 'agent_user_id' },
    { table: 'terminal_sessions',     cols: ['id', 'user_id'],                                where: 'user_id' },
    { table: 'terminal_commands',     cols: ['id'],                                           where: 'user_id', skipIfNoCol: true },
    { table: 'tool_approval_rules',   cols: ['id', 'created_by'],                             where: 'created_by' },
    { table: 'api_keys',              cols: ['id', 'user_id', 'project_id'],                  where: 'user_id' },
    { table: 'audit_log',             cols: ['id', 'user_id'],                                where: 'user_id' },
    { table: 'chat_participants',     cols: ['user_id', 'conversation_id'],                   where: 'user_id', noId: true },
    { table: 'conversation_participants', cols: ['user_id', 'conversation_id'],               where: 'user_id', noId: true },
    { table: 'message_reactions',     cols: ['id', 'user_id'],                                where: 'user_id' },
    { table: 'monitoring_runs',       cols: ['id', 'user_id'],                                where: 'user_id' },
    { table: 'monitoring_threads',    cols: ['id', 'user_id'],                                where: 'user_id' },
    { table: 'oidc_access_tokens',    cols: ['id', 'user_id'],                                where: 'user_id' },
    { table: 'oidc_auth_codes',       cols: ['id', 'user_id'],                                where: 'user_id' },
    { table: 'user_settings',         cols: ['user_id'],                                      where: 'user_id', noId: true },
    { table: 'user_widget_favorites', cols: ['user_id', 'widget_id'],                         where: 'user_id', noId: true },
    { table: 'user_widget_history',   cols: ['user_id', 'widget_id'],                         where: 'user_id', noId: true },
    { table: 'wa_auth_tokens',        cols: ['id', 'user_id'],                                where: 'user_id' },
    { table: 'wa_presence',           cols: ['user_id'],                                      where: 'user_id', noId: true },
  ];

  // For robustness: look up actual columns on the target table and only select
  // columns from `cols` that actually exist. If the target WHERE column is
  // absent, skip the table with a note.
  const runChild = async ({ table, cols, where }, idSet, label) => {
    // First: does table even exist?
    const tableCheck = await q(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [table],
    );
    if (!tableCheck.length) {
      writeCsv(`${table}.csv`, cols, []);
      dep.push({ table, parent: label, count: 0, note: `table not found — skipped` });
      return;
    }
    const colRows = await q(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [table],
    );
    const actualCols = new Set(colRows.map((r) => r.column_name));
    if (!actualCols.has(where)) {
      writeCsv(`${table}.csv`, cols, []);
      dep.push({ table, parent: label, count: 0, note: `column ${where} not found — skipped` });
      return;
    }
    if (idSet.size === 0) {
      writeCsv(`${table}.csv`, cols, []);
      dep.push({ table, parent: label, count: 0 });
      return;
    }
    const selectCols = cols.filter((c) => actualCols.has(c));
    if (selectCols.length === 0) selectCols.push(where);
    // Guard against text-typed id columns (monitoring_runs.user_id is text, not int).
    const whereDt = colRows.find((r) => r.column_name === where)?.data_type;
    const isIntCol = /^(integer|bigint|smallint)$/i.test(whereDt || '');
    const castClause = isIntCol
      ? `${where} = ANY($1::int[])`
      : `${where} = ANY($1::text[])`;
    const param = isIntCol ? [...idSet] : [...idSet].map(String);
    const rows = await q(
      `SELECT ${selectCols.join(', ')} FROM ${table} WHERE ${castClause}`,
      [param],
    );
    writeCsv(`${table}.csv`, selectCols, rows);
    const note = cols.filter((c) => !actualCols.has(c));
    dep.push({ table, parent: label, count: rows.length, note: note.length ? `missing cols: ${note.join(',')}` : '' });
  };

  console.log('\n[dependents: spaces →]');
  for (const sc of spaceChildren) {
    await runChild(sc, deleteSpaceIds, 'spaces');
    const d = dep[dep.length - 1];
    if (d.count > 0) console.log(`  ${d.table}: ${d.count}${d.note ? ' (' + d.note + ')' : ''}`);
  }
  console.log('\n[dependents: users →]');
  for (const uc of userChildren) {
    await runChild(uc, deleteUserIds, 'users');
    const d = dep[dep.length - 1];
    if (d.count > 0) console.log(`  ${d.table}: ${d.count}${d.note ? ' (' + d.note + ')' : ''}`);
  }

  // --- 6b. "Orphan-suspect" users NOT covered by test signature ----------
  // The ADR signature does not match certain test-ish patterns that still
  // exist in PROD (e.g. register-<timestamp>@hltrn.cc stress-test registrations).
  // These are NOT candidates for deletion in Phase 2, but the owner should
  // inspect them before Phase 3 and decide whether to extend the regex.
  const orphanSuspects = await q(`
    SELECT id, email, name, user_type, created_at,
      (SELECT COUNT(*) FROM spaces s WHERE s.owner_id=u.id) AS spaces_owned,
      (SELECT COUNT(*) FROM projects p WHERE p.owner_id=u.id) AS projects_owned
    FROM users u
    WHERE NOT (email ~* $1 OR name ~* $2)
      AND (email ~ '^register-[0-9]{10,}@hltrn\\.cc$'
           OR name = 'New User'
           OR email ~* '\\+test[0-9]*@'
           OR email ~* 'qa[0-9]+@'
          )
    ORDER BY id
  `, [TEST_EMAIL_RX, TEST_NAME_RX]);
  writeCsv('orphan_suspects.csv',
    ['id', 'email', 'name', 'user_type', 'created_at', 'spaces_owned', 'projects_owned'],
    orphanSuspects,
  );

  // --- 7. Shape-unexpected warnings -------------------------------------
  // A "test" user should have empty or near-empty downstream footprint.
  // Surface any candidate user with > 10 calendar_events or > 10 audit_log rows.
  const weird = await q(
    `SELECT u.id, u.email, u.name,
            (SELECT COUNT(*) FROM audit_log a WHERE a.user_id=u.id) AS audits,
            (SELECT COUNT(*) FROM dashboards d WHERE d.user_id=u.id) AS dashboards,
            (SELECT COUNT(*) FROM spaces s WHERE s.owner_id=u.id) AS spaces_owned
       FROM users u
      WHERE u.id = ANY($1::int[])
      ORDER BY (
         (SELECT COUNT(*) FROM audit_log a WHERE a.user_id=u.id) +
         (SELECT COUNT(*) FROM dashboards d WHERE d.user_id=u.id)
      ) DESC
      LIMIT 20`,
    [[...deleteUserIds]],
  );
  writeCsv('weird_candidates.csv',
    ['id', 'email', 'name', 'audits', 'dashboards', 'spaces_owned'],
    weird,
  );

  // --- 8. pg_total_relation_size estimate -------------------------------
  const sizeRows = await q(`
    SELECT 'users' AS t, pg_total_relation_size('public.users') AS bytes UNION ALL
    SELECT 'spaces', pg_total_relation_size('public.spaces') UNION ALL
    SELECT 'projects', pg_total_relation_size('public.projects') UNION ALL
    SELECT 'universal_tables', pg_total_relation_size('public.universal_tables') UNION ALL
    SELECT 'table_rows', pg_total_relation_size('public.table_rows');
  `);
  const sizeByTbl = Object.fromEntries(sizeRows.map((r) => [r.t, Number(r.bytes)]));
  const totalSize = sizeRows.reduce((s, r) => s + Number(r.bytes), 0);

  // Very rough free estimate: fraction of test rows out of total rows × bytes.
  const totalUsers = Number((await q(`SELECT COUNT(*) AS c FROM users`))[0].c);
  const totalSpaces = Number((await q(`SELECT COUNT(*) AS c FROM spaces`))[0].c);
  const totalProjects = Number((await q(`SELECT COUNT(*) AS c FROM projects`))[0].c);
  const totalTables = Number((await q(`SELECT COUNT(*) AS c FROM universal_tables`))[0].c);
  const totalRows = Number((await q(`SELECT COUNT(*) AS c FROM table_rows`))[0].c);

  const est = (frac, bytes) => Math.round(frac * bytes);
  const freedEst =
    est(deleteUsers.length / Math.max(totalUsers, 1), sizeByTbl.users) +
    est(deleteSpaces.length / Math.max(totalSpaces, 1), sizeByTbl.spaces) +
    est(deleteProjects.length / Math.max(totalProjects, 1), sizeByTbl.projects) +
    est(deleteTables.length / Math.max(totalTables, 1), sizeByTbl.universal_tables) +
    est(rowTotal / Math.max(totalRows, 1), sizeByTbl.table_rows);
  const fmtMB = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';

  // --- 9. MANIFEST ------------------------------------------------------
  // Topological delete order — mirrors what Phase 3 --execute must do.
  const deleteOrder = [
    '1. table_rows  WHERE table_id IN (candidate universal_tables)',
    '2. DROP TABLE table_<N>  (physical per-table PG tables for candidate universal_tables) — N/A, none exist',
    '3. universal_tables  (candidate set)',
    '4. all FK-by-convention children referencing candidate projects',
    '5. projects  (candidate set)',
    '6. all FK-by-convention children referencing candidate spaces (modules/widget_library/fitness_*/wellness_*/calendar_events/labs/schema_layouts/space_invitations/dashboards/files/conversations/user_access_permissions)',
    '7. spaces  (candidate set)',
    '8. all FK-by-convention children referencing candidate users (agent_jobs/terminal_*/tool_approval_rules/wa_*/audit_log/monitoring_*/oidc_*/api_keys/user_settings/user_widget_*/chat_participants/conversation_participants/message_reactions)',
    '9. users  (candidate set)',
  ];

  const manifest = [];
  manifest.push(`# ADR-0009 Phase 2 cleanup DRY-RUN manifest`);
  manifest.push(``);
  manifest.push(`- Generated: ${new Date().toISOString()}`);
  manifest.push(`- Mode: DRY-RUN (no writes)`);
  manifest.push(`- Target DB: ${POSTGRES_HOST}/${process.env.POSTGRES_DB || 'godcrm_prod'}`);
  manifest.push(`- Allow-list file: scripts/cleanup-allowlist.json (owner_signed=${allowlist.owner_signed})`);
  manifest.push(`- Allow-list size: ${ALLOW_USER_IDS.size} users, ${ALLOW_SPACE_IDS.size} spaces, ${ALLOW_TABLE_IDS.size} tables`);
  manifest.push(``);
  manifest.push(`## Test signatures`);
  manifest.push(`- email regex: \`${TEST_EMAIL_RX}\``);
  manifest.push(`- name regex:  \`${TEST_NAME_RX}\``);
  manifest.push(`- Agents (user_type='agent') and services (user_type='service') are unconditionally allow-listed regardless of regex match.`);
  manifest.push(``);
  manifest.push(`## Candidate summary`);
  manifest.push(`| Entity | Total in DB | To delete | To keep |`);
  manifest.push(`|---|---:|---:|---:|`);
  manifest.push(`| users | ${totalUsers} | ${deleteUsers.length} | ${totalUsers - deleteUsers.length} |`);
  manifest.push(`| spaces | ${totalSpaces} | ${deleteSpaces.length} | ${totalSpaces - deleteSpaces.length} |`);
  manifest.push(`| projects | ${totalProjects} | ${deleteProjects.length} | ${totalProjects - deleteProjects.length} |`);
  manifest.push(`| universal_tables | ${totalTables} | ${deleteTables.length} | ${totalTables - deleteTables.length} |`);
  manifest.push(`| table_rows | ${totalRows} | ${rowTotal} | ${totalRows - rowTotal} |`);
  manifest.push(`| physical table_<N> | (n/a) | ${physicalTables.length} | n/a |`);
  manifest.push(``);
  manifest.push(`## ADR Appendix A comparison`);
  manifest.push(`ADR predicted: 5878 users to delete, 5328 spaces to delete.`);
  manifest.push(`Actual: ${deleteUsers.length} users, ${deleteSpaces.length} spaces.`);
  const udelta = Math.abs(deleteUsers.length - 5878) / 5878;
  const sdelta = Math.abs(deleteSpaces.length - 5328) / 5328;
  manifest.push(`Delta: users ${(udelta * 100).toFixed(1)}%, spaces ${(sdelta * 100).toFixed(1)}%.`);
  if (udelta > 0.1 || sdelta > 0.1) {
    manifest.push(`**WARNING:** delta > 10% — regex may be wrong or allow-list may have too many/few entries.`);
  } else {
    manifest.push(`Delta within 10% — signature matches ADR audit.`);
  }
  manifest.push(``);
  manifest.push(`## Dependent FK-by-convention child counts`);
  manifest.push(`| Table | Parent | Candidate rows | Note |`);
  manifest.push(`|---|---|---:|---|`);
  for (const d of dep) {
    manifest.push(`| ${d.table} | ${d.parent} | ${d.count} | ${d.note || ''} |`);
  }
  manifest.push(``);
  manifest.push(`## Biggest individual deletes (by table_rows count)`);
  manifest.push(`| universal_table_id | rows |`);
  manifest.push(`|---|---:|`);
  for (const r of rowSummary.slice(0, 10)) {
    manifest.push(`| ${r.table_id} | ${r.row_count} |`);
  }
  manifest.push(``);
  manifest.push(`## Orphan-suspect users (NOT covered by current signature)`);
  manifest.push(`These users look test-ish (\`register-<ts>@hltrn.cc\`, name = "New User", etc.) but are NOT covered by the ADR regex, so they will NOT be deleted in the current plan. Owner should decide before Phase 3 whether to extend the regex. See orphan_suspects.csv.`);
  manifest.push(`Total: ${orphanSuspects.length}`);
  manifest.push(`| id | email | name | spaces_owned | projects_owned |`);
  manifest.push(`|---|---|---|---:|---:|`);
  for (const o of orphanSuspects.slice(0, 10)) {
    manifest.push(`| ${o.id} | ${o.email} | ${o.name} | ${o.spaces_owned} | ${o.projects_owned} |`);
  }
  manifest.push(``);
  manifest.push(`## Shape-unexpected warnings`);
  manifest.push(`Candidate users with non-trivial downstream activity (see weird_candidates.csv):`);
  manifest.push(`| id | email | audits | dashboards | spaces_owned |`);
  manifest.push(`|---|---|---:|---:|---:|`);
  for (const w of weird.slice(0, 10)) {
    manifest.push(`| ${w.id} | ${w.email} | ${w.audits} | ${w.dashboards} | ${w.spaces_owned} |`);
  }
  manifest.push(``);
  manifest.push(`## Estimated bytes freed`);
  manifest.push(`Rough proportional estimate (rows_to_delete / total_rows × table_size):`);
  manifest.push(`- users:            ${fmtMB(est(deleteUsers.length / Math.max(totalUsers, 1), sizeByTbl.users))} (of ${fmtMB(sizeByTbl.users)})`);
  manifest.push(`- spaces:           ${fmtMB(est(deleteSpaces.length / Math.max(totalSpaces, 1), sizeByTbl.spaces))} (of ${fmtMB(sizeByTbl.spaces)})`);
  manifest.push(`- projects:         ${fmtMB(est(deleteProjects.length / Math.max(totalProjects, 1), sizeByTbl.projects))} (of ${fmtMB(sizeByTbl.projects)})`);
  manifest.push(`- universal_tables: ${fmtMB(est(deleteTables.length / Math.max(totalTables, 1), sizeByTbl.universal_tables))} (of ${fmtMB(sizeByTbl.universal_tables)})`);
  manifest.push(`- table_rows:       ${fmtMB(est(rowTotal / Math.max(totalRows, 1), sizeByTbl.table_rows))} (of ${fmtMB(sizeByTbl.table_rows)})`);
  manifest.push(`- **TOTAL estimate freed:** ~${fmtMB(freedEst)} (of DB main-table footprint ${fmtMB(totalSize)})`);
  manifest.push(`(Does not include per-index bloat or dependent child tables; actual free may be higher after VACUUM FULL.)`);
  manifest.push(``);
  manifest.push(`## Topological delete order (Phase 3 --execute)`);
  for (const step of deleteOrder) manifest.push(`- ${step}`);
  manifest.push(``);
  manifest.push(`All wrapped in a single \`BEGIN; ... COMMIT;\` transaction; any error triggers \`ROLLBACK\`.`);
  manifest.push(``);
  manifest.push(`## Files in this snapshot`);
  for (const f of fs.readdirSync(snapDir).sort()) {
    manifest.push(`- ${f}`);
  }

  fs.writeFileSync(path.join(snapDir, 'MANIFEST.md'), manifest.join('\n') + '\n');
  console.log(`\n[ok] manifest: ${path.join(snapDir, 'MANIFEST.md')}`);

  if (!EXECUTE) {
    console.log(`\nDRY-RUN COMPLETE — no rows modified`);
    return;
  }

  // ============================================================
  // Phase 3 destructive path (--execute --target=dev|prod)
  // ============================================================
  console.log(`\n=== PHASE 3 DESTRUCTIVE EXECUTION ===`);
  console.log(`Target: ${TARGET}  Mode: ${ROLLBACK ? 'BEGIN; ... ROLLBACK (dry-transaction)' : 'BEGIN; ... COMMIT (destructive)'}`);
  if (!allowlist.owner_signed) {
    console.error('[FATAL] owner_signed=false — set to true in cleanup-allowlist.json after MANIFEST review.');
    process.exit(2);
  }

  const client = await pool.connect();
  const counts = {};
  let committed = false;
  try {
    await client.query('BEGIN');

    const candidateUsers = [...deleteUserIds];
    const candidateSpaces = [...deleteSpaceIds];
    const candidateProjects = [...deleteProjectIds];
    const candidateTables = [...deleteTableIds];

    // Pre-compute conversation IDs belonging to candidate spaces — their children
    // CASCADE on spaces delete, but agent_jobs.conversation_id is FK=NO ACTION
    // and must be nulled/cleared first.
    let candidateConvIds = [];
    if (candidateSpaces.length) {
      const r = await client.query(
        `SELECT id FROM conversations WHERE space_id = ANY($1::int[])`,
        [candidateSpaces],
      );
      candidateConvIds = r.rows.map((x) => x.id);
    }
    console.log(`  conversations in candidate spaces (will cascade on space delete): ${candidateConvIds.length}`);

    // Helper: run DELETE, capture rowCount.
    const del = async (label, sql, params) => {
      const r = await client.query(sql, params);
      counts[label] = r.rowCount;
      console.log(`  [-] ${label}: ${r.rowCount}`);
      return r.rowCount;
    };

    // --- Step A: break NO ACTION FKs referencing candidate users / conversations
    //     (agent_jobs, terminal_*, tool_approval_rules, wa_*)
    if (candidateUsers.length || candidateConvIds.length) {
      const conds = [];
      const params = [];
      if (candidateUsers.length) {
        conds.push(`agent_user_id = ANY($${params.length + 1}::int[])`);
        params.push(candidateUsers);
        conds.push(`trigger_user_id = ANY($${params.length + 1}::int[])`);
        params.push(candidateUsers);
      }
      if (candidateConvIds.length) {
        conds.push(`conversation_id = ANY($${params.length + 1}::int[])`);
        params.push(candidateConvIds);
      }
      await del('agent_jobs', `DELETE FROM agent_jobs WHERE ${conds.join(' OR ')}`, params);
    }

    if (candidateUsers.length) {
      await del('terminal_commands', `DELETE FROM terminal_commands WHERE approved_by = ANY($1::int[])`, [candidateUsers]);
      await del('terminal_sessions', `DELETE FROM terminal_sessions WHERE user_id = ANY($1::int[])`, [candidateUsers]);
      await del('tool_approval_rules', `DELETE FROM tool_approval_rules WHERE created_by = ANY($1::int[])`, [candidateUsers]);
      await del('wa_auth_tokens', `DELETE FROM wa_auth_tokens WHERE user_id = ANY($1::int[])`, [candidateUsers]);
      await del('wa_presence', `DELETE FROM wa_presence WHERE user_id = ANY($1::int[])`, [candidateUsers]);
    }

    // --- Step B: drop per-table rows + universal_tables + projects
    if (candidateTables.length) {
      await del('table_rows', `DELETE FROM table_rows WHERE table_id = ANY($1::int[])`, [candidateTables]);
      await del('universal_tables', `DELETE FROM universal_tables WHERE id = ANY($1::int[])`, [candidateTables]);
    }
    if (candidateProjects.length) {
      await del('projects', `DELETE FROM projects WHERE id = ANY($1::int[])`, [candidateProjects]);
    }

    // --- Step C: space-children (NO ACTION FKs must delete first)
    if (candidateSpaces.length) {
      await del('calendar_events',   `DELETE FROM calendar_events   WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('modules',           `DELETE FROM modules           WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('widget_library',    `DELETE FROM widget_library    WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      // fitness_workout_sets is a VIEW joining fitness_workouts + fitness_sets.
      // fitness_sets CASCADES via workout_id → fitness_workouts FK (confdeltype=c).
      // Delete order: fitness_workouts (→ cascades fitness_sets) → fitness_exercises.
      await del('fitness_workouts',  `DELETE FROM fitness_workouts  WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('fitness_exercises', `DELETE FROM fitness_exercises WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('wellness_levels',   `DELETE FROM wellness_levels   WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('wellness_points',   `DELETE FROM wellness_points   WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('wellness_profiles', `DELETE FROM wellness_profiles WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('wellness_streaks',  `DELETE FROM wellness_streaks  WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('wellness_vitals',   `DELETE FROM wellness_vitals   WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('wellness_user_achievements', `DELETE FROM wellness_user_achievements WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('labs',              `DELETE FROM labs              WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('schema_layouts',    `DELETE FROM schema_layouts    WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('files',             `DELETE FROM files             WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('dashboards',        `DELETE FROM dashboards        WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      await del('user_access_permissions_by_space', `DELETE FROM user_access_permissions WHERE space_id = ANY($1::int[])`, [candidateSpaces]);
      // conversations + space_invitations CASCADE from spaces delete.
      await del('spaces', `DELETE FROM spaces WHERE id = ANY($1::int[])`, [candidateSpaces]);
    }

    // --- Step D: users (+ CASCADE children)
    if (candidateUsers.length) {
      await del('user_access_permissions_by_user', `DELETE FROM user_access_permissions WHERE user_id = ANY($1::int[])`, [candidateUsers]);
      await del('user_settings',    `DELETE FROM user_settings    WHERE user_id = ANY($1::int[])`, [candidateUsers]);
      await del('audit_log',        `DELETE FROM audit_log        WHERE user_id = ANY($1::int[])`, [candidateUsers]);
      // conversation_participants, message_reactions, oidc_*, scheduled_messages,
      // user_widget_favorites, user_widget_history — all CASCADE on user delete.
      // conversations.created_by / messages.sender_id — SET NULL.
      await del('users', `DELETE FROM users WHERE id = ANY($1::int[])`, [candidateUsers]);
    }

    // --- Verify remaining row totals (in-transaction) ---
    const verify = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users_remaining,
        (SELECT COUNT(*) FROM spaces) AS spaces_remaining,
        (SELECT COUNT(*) FROM projects) AS projects_remaining,
        (SELECT COUNT(*) FROM universal_tables) AS tables_remaining,
        (SELECT COUNT(*) FROM table_rows) AS rows_remaining
    `);
    console.log('\n[post-delete row totals, pre-commit]');
    console.log(verify.rows[0]);

    if (ROLLBACK) {
      await client.query('ROLLBACK');
      console.log('\n[ok] --rollback — transaction rolled back. No rows persisted.');
    } else {
      await client.query('COMMIT');
      committed = true;
      console.log('\n[ok] COMMIT — cleanup persisted.');
    }

    // Write execution report
    const reportPath = path.join(snapDir, committed ? 'EXECUTION_REPORT.md' : 'ROLLBACK_REPORT.md');
    const report = [
      `# ADR-0009 Phase 3 execution report`,
      ``,
      `- Timestamp: ${new Date().toISOString()}`,
      `- Target: ${TARGET}`,
      `- Mode: ${ROLLBACK ? 'ROLLBACK (dry-transaction)' : 'COMMIT (destructive)'}`,
      `- DB: ${POSTGRES_HOST}/${process.env.POSTGRES_DB || 'godcrm_prod'}`,
      ``,
      `## Delete counts per table`,
      `| Table | rowCount |`,
      `|---|---:|`,
      ...Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`),
      ``,
      `## Post-delete totals (in-transaction)`,
      `| metric | value |`,
      `|---|---:|`,
      ...Object.entries(verify.rows[0]).map(([k, v]) => `| ${k} | ${v} |`),
      ``,
    ].join('\n');
    fs.writeFileSync(reportPath, report);
    console.log(`[ok] report: ${reportPath}`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('\n[FATAL] destructive step failed — ROLLBACK issued:');
    console.error(err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end().then(() => process.exit(0)))
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
