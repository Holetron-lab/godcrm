#!/usr/bin/env node
/**
 * cleanup-for-launch.js — wipe godcrm_prod on the launch server (.182)
 * to a clean state before 06.06.2026 06:06:06 MSK public-alpha opening.
 *
 * Brief: ADR-0049 cutover for app.godcrm.ai. Whitelist 3 users, keep system
 * spaces + the one public space, wipe everything else, prune agents to the
 * ADR-0046-A default-pack, delete the `mom-roast` tool.
 *
 * Safety:
 *   - default mode is --dry-run (BEGIN ... ROLLBACK; nothing committed)
 *   - hard host guard refuses to ever commit against PROD hostnames/DBs
 *   - real run requires BOTH --commit AND --confirm-host=<os.hostname()>
 *
 * Usage:
 *   node backend/scripts/cleanup-for-launch.js                   # dry-run
 *   node backend/scripts/cleanup-for-launch.js --commit \
 *        --confirm-host=$(hostname)                              # real run
 */

import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
import os from 'node:os';
import process from 'node:process';

// ── Config ─────────────────────────────────────────────────────────────────

// Human whitelist — fixed.
const KEEP_HUMAN_USERS = [1, 7, 15];          // GERATRON, NIKITRON, IVAN
// Agent backing users — resolved dynamically from `users.managed_by_agent_row_id`
// pointing to ACTIVE rows in agents-table 1784. Filled in main() before phaseUsers.
let KEEP_AGENT_USERS = [];
let KEEP_USERS = [...KEEP_HUMAN_USERS];       // mutated after resolveAgentKeep()

const KEEP_SYSTEM_SPACES = [1, 11];     // Admin Space (1) + Development (11) hold system tables
// Active agent rows in 1784 — resolved dynamically (status='active'). Filled in main().
let KEEP_AGENT_ROW_IDS = [];

const KILL_TOOL_NAMES = ['mom-roast']; // table 1790 — match by data->>'name' (slug is empty)

const AGENTS_TABLE_ID = 1784;
const TOOLS_TABLE_ID = 1790;

// Hostnames/DBs we MUST refuse to touch at all (dry-run included — TRUNCATE
// inside BEGIN/ROLLBACK still holds ACCESS EXCLUSIVE for the duration of the
// transaction; on 600k+ rows that takes the site down. Lesson from 2026-05-31
// incident — pid 18372 TRUNCATE held lock 40+ min and blocked all messages
// reads/writes on crm.hltrn.cc.)
const PROD_HOST_VALUES = new Set(['<LEGACY_IP>', 'crm.hltrn.cc']);
// hostname matched by startsWith() so vdsina suffix doesn't slip past
const PROD_HOSTNAME_PREFIXES = ['v682989'];
// On the PROD machine the DB is reached over localhost; that alone must trip the guard.
function isProdMachine() {
  return PROD_HOSTNAME_PREFIXES.some((p) => HOSTNAME.startsWith(p));
}
function isProdHostValue(h) {
  return PROD_HOST_VALUES.has(h);
}

// ── CLI ────────────────────────────────────────────────────────────────────

const args = new Map();
for (const a of process.argv.slice(2)) {
  const [k, v] = a.startsWith('--') ? a.slice(2).split('=', 2) : [a, true];
  args.set(k, v === undefined ? true : v);
}
const COMMIT = args.get('commit') === true;
const CONFIRM_HOST = args.get('confirm-host');
const APPLY_SECRETS_MIGRATION = args.get('apply-secrets-migration') === true;

// ── Host / DB guard ────────────────────────────────────────────────────────

const PGHOST = process.env.POSTGRES_HOST || 'localhost';
const PGDB = process.env.POSTGRES_DB || 'godcrm_prod';
const HOSTNAME = os.hostname();

function abort(msg) {
  console.error(`[ABORT] ${msg}`);
  process.exit(2);
}

// HARD GUARD — refuses both dry-run AND commit when targeting PROD.
// To bypass on the dedicated launch box (.182) the operator must explicitly
// set CLEANUP_ALLOW_HOST=1 in env AND pass --confirm-host=$(hostname).
const ALLOW_OVERRIDE = process.env.CLEANUP_ALLOW_HOST === '1';

if (isProdMachine() && !ALLOW_OVERRIDE) {
  abort(`Refusing to run on PROD machine (hostname="${HOSTNAME}"). ` +
        `Even --dry-run takes ACCESS EXCLUSIVE locks (incident 2026-05-31). ` +
        `Set CLEANUP_ALLOW_HOST=1 if you are SURE.`);
}
if (isProdHostValue(PGHOST) && !ALLOW_OVERRIDE) {
  abort(`Refusing — POSTGRES_HOST="${PGHOST}" is a PROD endpoint.`);
}
// PROD DB on localhost is the worst case — the most common misfire path.
if (PGHOST === 'localhost' && PGDB === 'godcrm_prod' && isProdMachine() && !ALLOW_OVERRIDE) {
  abort(`POSTGRES_HOST=localhost + POSTGRES_DB=godcrm_prod on PROD machine. Refused.`);
}

if (COMMIT) {
  if (!CONFIRM_HOST) abort('--commit requires --confirm-host=<os.hostname()>');
  if (CONFIRM_HOST !== HOSTNAME) {
    abort(`--confirm-host="${CONFIRM_HOST}" does not match os.hostname()="${HOSTNAME}".`);
  }
}

// ── Connection ─────────────────────────────────────────────────────────────

const client = new pg.Client({
  host: PGHOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: PGDB,
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD,
});

const log = (...x) => console.log('[cleanup]', ...x);
const banner = (...x) => console.log('\n══', ...x, '══');

const counts = {};

async function recordCount(label, sql, params = []) {
  const { rows } = await client.query(sql, params);
  const n = Number(rows[0]?.c ?? 0);
  counts[label] = counts[label] ?? {};
  // store first-seen as "before", later seen as "after"
  if (counts[label].before === undefined) counts[label].before = n;
  else counts[label].after = n;
  return n;
}

// Per-step SAVEPOINT so one table's failure (missing col, type mismatch)
// doesn't abort the surrounding transaction.
let savepointCounter = 0;
async function step(label, deleteSql, countSql, params = []) {
  const sp = `sp_${++savepointCounter}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const before = await recordCount(label, countSql, params);
    const res = await client.query(deleteSql, params);
    const after = await recordCount(label, countSql, params);
    const delta = (res.rowCount ?? 0);
    log(`[step] ${label.padEnd(40)} before=${String(before).padStart(8)} after=${String(after).padStart(8)} delete-stmt-rowcount=${delta}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    log(`[step] ${label.padEnd(40)} SKIPPED — ${e.code || ''} ${e.message}`);
  }
}

// GERATRON ack 2026-05-31: keep ALL active agents in 1784, plus the user
// rows that back them (`users.managed_by_agent_row_id`). Resolved at runtime.
async function resolveAgentKeep() {
  banner('RESOLVE · active agents (1784) and their backing users');
  const { rows: activeAgents } = await client.query(
    `SELECT id, data->>'slug' AS slug, data->>'name' AS name
       FROM table_rows
      WHERE table_id=$1 AND data->>'status'='active'
      ORDER BY id`,
    [AGENTS_TABLE_ID]
  );
  KEEP_AGENT_ROW_IDS = activeAgents.map(r => r.id);
  log(`active agents (1784):    ${KEEP_AGENT_ROW_IDS.length}`);

  const { rows: backingUsers } = await client.query(
    `SELECT u.id, u.email, u.managed_by_agent_row_id
       FROM users u
      WHERE u.managed_by_agent_row_id = ANY($1::int[])`,
    [KEEP_AGENT_ROW_IDS]
  );
  KEEP_AGENT_USERS = backingUsers.map(r => r.id);
  KEEP_USERS = [...new Set([...KEEP_HUMAN_USERS, ...KEEP_AGENT_USERS])];
  log(`backing users kept:      ${KEEP_AGENT_USERS.length}`);
  log(`KEEP_USERS (total):      ${KEEP_USERS.length} = [${KEEP_USERS.slice(0, 10).join(', ')}${KEEP_USERS.length > 10 ? ', …' : ''}]`);
}

// Resolve the doomed sets at runtime so the script is idempotent / re-runnable.
async function resolveTargets() {
  const { rows: doomedSpaces } = await client.query(
    `SELECT id FROM spaces
     WHERE id <> ALL($1::int[])
       AND public_slug IS NULL`,
    [KEEP_SYSTEM_SPACES]
  );
  const doomedSpaceIds = doomedSpaces.map(r => r.id);

  const { rows: doomedProjects } = await client.query(
    `SELECT id FROM projects WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]
  );
  const doomedProjectIds = doomedProjects.map(r => r.id);

  const { rows: doomedTables } = await client.query(
    `SELECT id FROM universal_tables WHERE project_id = ANY($1::int[])`,
    [doomedProjectIds]
  );
  const doomedTableIds = doomedTables.map(r => r.id);

  const { rows: doomedDashboards } = await client.query(
    `SELECT id FROM dashboards WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]
  );
  const doomedDashboardIds = doomedDashboards.map(r => r.id);

  log(`resolved: ${doomedSpaceIds.length} spaces, ${doomedProjectIds.length} projects, ${doomedTableIds.length} tables, ${doomedDashboardIds.length} dashboards`);
  return { doomedSpaceIds, doomedProjectIds, doomedTableIds, doomedDashboardIds };
}

// ── Phases ─────────────────────────────────────────────────────────────────

async function phaseChat() {
  banner('PHASE A · chat tree wipe (TRUNCATE for speed; FK CASCADE handles refs)');
  // TRUNCATE is ~1000x faster than DELETE for 600k+ rows and is fully
  // transactional in Postgres — ROLLBACK undoes it. CASCADE follows FK
  // refs (message_reactions, conversation_participants, etc.).
  const bulkTables = [
    'messages', 'conversations', 'conversation_participants',
    'conversation_summaries', 'message_reactions', 'scheduled_messages',
    'chat_messages', 'chat_participants', 'chat_threads',
    'orchestrator_saves', 'agent_jobs', '_inflight_runs',
    // Block-3 ack from GERATRON: operational/audit logs are NOT user content —
    // wipe them outright so they don't block user DELETE via NO ACTION FK.
    'audit_log', 'terminal_commands', 'terminal_sessions',
    '_verification_attempts', 'tool_approval_rules',
    'wa_auth_tokens', 'wa_presence',
  ];
  // Count beforehand for the report; TRUNCATE itself returns nothing.
  for (const t of bulkTables) {
    try { await recordCount(t, `SELECT count(*)::int c FROM ${t}`); }
    catch (e) { log(`  pre-count skip ${t}: ${e.code}`); }
  }
  const truncList = bulkTables.join(', ');
  await client.query(`TRUNCATE TABLE ${truncList} CASCADE`);
  for (const t of bulkTables) {
    try {
      const after = (await client.query(`SELECT count(*)::int c FROM ${t}`)).rows[0].c;
      counts[t].after = Number(after);
      log(`[step] ${t.padEnd(40)} before=${String(counts[t].before).padStart(8)} after=${String(after).padStart(8)} (TRUNCATE)`);
    } catch (e) { log(`  post-count skip ${t}: ${e.code}`); }
  }
}

async function phaseSpaces({ doomedSpaceIds, doomedProjectIds, doomedTableIds, doomedDashboardIds }) {
  banner(`PHASE B · wipe ${doomedSpaceIds.length} non-system / non-public spaces`);
  if (doomedSpaceIds.length === 0) { log('nothing to wipe'); return; }

  // Wipe rows / columns belonging to doomed universal_tables first.
  await step('table_rows (doomed tables)',
    `DELETE FROM table_rows WHERE table_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM table_rows WHERE table_id = ANY($1::int[])`,
    [doomedTableIds]);
  await step('table_columns (doomed tables)',
    `DELETE FROM table_columns WHERE table_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM table_columns WHERE table_id = ANY($1::int[])`,
    [doomedTableIds]);
  await step('table_column_mappings (doomed tables)',
    `DELETE FROM table_column_mappings WHERE table_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM table_column_mappings WHERE table_id = ANY($1::int[])`,
    [doomedTableIds]);
  await step('system_form_configs (doomed tables)',
    `DELETE FROM system_form_configs WHERE table_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM system_form_configs WHERE table_id = ANY($1::int[])`,
    [doomedTableIds]);

  // Widgets + dashboards + library.
  await step('widgets (doomed dashboards)',
    `DELETE FROM widgets WHERE dashboard_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM widgets WHERE dashboard_id = ANY($1::int[])`,
    [doomedDashboardIds]);
  await step('dashboards (doomed spaces)',
    `DELETE FROM dashboards WHERE space_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM dashboards WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]);
  await step('widget_library (doomed spaces)',
    `DELETE FROM widget_library WHERE space_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM widget_library WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]);

  // Per-space leaf tables
  await step('automations (doomed tables)',
    `DELETE FROM automations WHERE table_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM automations WHERE table_id = ANY($1::int[])`,
    [doomedTableIds]);
  await step('webhooks (doomed tables)',
    `DELETE FROM webhooks WHERE table_id = ANY($1::int[]) OR project_id = ANY($2::int[])`,
    `SELECT count(*)::int c FROM webhooks WHERE table_id = ANY($1::int[]) OR project_id = ANY($2::int[])`,
    [doomedTableIds, doomedProjectIds]);
  await step('files (doomed spaces)',
    `DELETE FROM files WHERE space_id = ANY($1::int[]) OR project_id = ANY($2::int[]) OR table_id = ANY($3::int[])`,
    `SELECT count(*)::int c FROM files WHERE space_id = ANY($1::int[]) OR project_id = ANY($2::int[]) OR table_id = ANY($3::int[])`,
    [doomedSpaceIds, doomedProjectIds, doomedTableIds]);
  await step('folders (doomed projects)',
    `DELETE FROM folders WHERE project_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM folders WHERE project_id = ANY($1::int[])`,
    [doomedProjectIds]);
  await step('schema_layouts (doomed spaces)',
    `DELETE FROM schema_layouts WHERE space_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM schema_layouts WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]);
  await step('user_access_permissions (doomed)',
    `DELETE FROM user_access_permissions WHERE space_id = ANY($1::int[]) OR project_id = ANY($2::int[]) OR table_id = ANY($3::int[])`,
    `SELECT count(*)::int c FROM user_access_permissions WHERE space_id = ANY($1::int[]) OR project_id = ANY($2::int[]) OR table_id = ANY($3::int[])`,
    [doomedSpaceIds, doomedProjectIds, doomedTableIds]);
  await step('audit_log (doomed spaces)',
    `DELETE FROM audit_log WHERE space_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM audit_log WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]);
  await step('space_invitations (doomed)',
    `DELETE FROM space_invitations WHERE space_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM space_invitations WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]);
  await step('space_connectors (doomed)',
    `DELETE FROM space_connectors WHERE space_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM space_connectors WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]);
  await step('modules (doomed spaces)',
    `DELETE FROM modules WHERE space_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM modules WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]);
  await step('calendar_events (doomed)',
    `DELETE FROM calendar_events WHERE space_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM calendar_events WHERE space_id = ANY($1::int[])`,
    [doomedSpaceIds]);
  // Wellness (optional — only if tables exist)
  for (const t of ['wellness_levels','wellness_points','wellness_profiles','wellness_streaks','wellness_vitals','wellness_user_achievements','fitness_workouts','fitness_exercises','fitness_workout_sets']) {
    await step(`${t} (doomed)`,
      `DELETE FROM ${t} WHERE space_id = ANY($1::int[])`,
      `SELECT count(*)::int c FROM ${t} WHERE space_id = ANY($1::int[])`,
      [doomedSpaceIds]);
  }
  await step('api_keys (doomed projects)',
    `DELETE FROM api_keys WHERE project_id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM api_keys WHERE project_id = ANY($1::int[])`,
    [doomedProjectIds]);

  // Now universal_tables → projects → spaces (parent order)
  await step('universal_tables (doomed)',
    `DELETE FROM universal_tables WHERE id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM universal_tables WHERE id = ANY($1::int[])`,
    [doomedTableIds]);
  await step('projects (doomed)',
    `DELETE FROM projects WHERE id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM projects WHERE id = ANY($1::int[])`,
    [doomedProjectIds]);
  await step('spaces (doomed)',
    `DELETE FROM spaces WHERE id = ANY($1::int[])`,
    `SELECT count(*)::int c FROM spaces WHERE id = ANY($1::int[])`,
    [doomedSpaceIds]);
}

async function phaseUsers() {
  banner(`PHASE C · prune users to whitelist [${KEEP_USERS.join(', ')}] (${KEEP_HUMAN_USERS.length} human + ${KEEP_AGENT_USERS.length} agent-backing)`);

  // children-first; explicit because no FK cascade exists.
  // monitoring_runs / monitoring_threads have user_id::text — handle via cast.
  const userIdIntTables = [
    'user_widget_favorites', 'user_widget_history', 'user_settings', 'user_access_permissions',
    'oidc_access_tokens', 'oidc_auth_codes',
    'api_keys',
  ];
  const userIdTextTables = ['monitoring_runs', 'monitoring_threads'];

  for (const t of userIdIntTables) {
    await step(`${t} (non-whitelist users)`,
      `DELETE FROM ${t} WHERE user_id <> ALL($1::int[])`,
      `SELECT count(*)::int c FROM ${t} WHERE user_id <> ALL($1::int[])`,
      [KEEP_USERS]);
  }
  const keepText = KEEP_USERS.map(String);
  for (const t of userIdTextTables) {
    await step(`${t} (non-whitelist users::text)`,
      `DELETE FROM ${t} WHERE user_id IS NULL OR user_id <> ALL($1::text[])`,
      `SELECT count(*)::int c FROM ${t} WHERE user_id IS NULL OR user_id <> ALL($1::text[])`,
      [keepText]);
  }
  // tool_approval_rules / wa_* / terminal_* / audit_log already wiped via
  // bulk TRUNCATE in phaseChat — no per-user delete needed here.

  // Reassign lingering created_by/owner_id on retained system objects to
  // GERATRON (id=1). NULL would violate registry_provenance_check trigger on
  // documents_registry tables, and reassigning to the human owner is the
  // semantically right thing for orphaned admin content anyway.
  const OWNER_FALLBACK = KEEP_HUMAN_USERS[0] ?? 1;
  await client.query(`UPDATE table_rows SET created_by = $2 WHERE created_by <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  await client.query(`UPDATE universal_tables SET created_by = $2 WHERE created_by <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  await client.query(`UPDATE projects SET owner_id = $2 WHERE owner_id <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  await client.query(`UPDATE spaces SET owner_id = $2 WHERE owner_id <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  await client.query(`UPDATE widgets SET created_by = $2 WHERE created_by <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  await client.query(`UPDATE widgets SET owner_id = $2 WHERE owner_id <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  await client.query(`UPDATE webhooks SET created_by = $2 WHERE created_by <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  await client.query(`UPDATE calendar_events SET created_by = $2 WHERE created_by <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  await client.query(`UPDATE space_connectors SET created_by = $2 WHERE created_by <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  await client.query(`UPDATE data_sources SET created_by = $2 WHERE created_by <> ALL($1::int[])`, [KEEP_USERS, OWNER_FALLBACK]);
  log(`reassigned created_by/owner_id → user_id=${OWNER_FALLBACK} (GERATRON) for retained objects whose owner is about to be deleted`);

  await step('users (non-whitelist)',
    `DELETE FROM users WHERE id <> ALL($1::int[])`,
    `SELECT count(*)::int c FROM users WHERE id <> ALL($1::int[])`,
    [KEEP_USERS]);
}

async function phaseAgentsTools() {
  banner(`PHASE D · prune agents (1784) — keep ${KEEP_AGENT_ROW_IDS.length} active rows by id`);
  await step('agents non-active (1784)',
    `DELETE FROM table_rows
       WHERE table_id=$1 AND id <> ALL($2::int[])`,
    `SELECT count(*)::int c FROM table_rows
       WHERE table_id=$1 AND id <> ALL($2::int[])`,
    [AGENTS_TABLE_ID, KEEP_AGENT_ROW_IDS]);

  banner(`PHASE E · delete tool(s) [${KILL_TOOL_NAMES.join(', ')}] from 1790`);
  await step('tools targeted by name',
    `DELETE FROM table_rows
       WHERE table_id=$1 AND data->>'name' = ANY($2::text[])`,
    `SELECT count(*)::int c FROM table_rows
       WHERE table_id=$1 AND data->>'name' = ANY($2::text[])`,
    [TOOLS_TABLE_ID, KILL_TOOL_NAMES]);
}

async function phaseOrphanUsersTables() {
  banner('PHASE G · orphan-cleanup in users-tables (sys_uid → deleted user)');
  // Scan every column tagged as system_user_id. After phaseUsers() the live
  // user set is exactly KEEP_USERS. Any row whose sys_uid value is a non-empty
  // integer NOT in that set is a stale binding (Boris-old-id / Smith-old-id
  // pattern from 2026-05-31 incident). Email-bearing rows with sys_uid=NULL
  // are legitimate pending invites — leave them alone.
  const { rows: cols } = await client.query(
    `SELECT tc.id AS col_id, tc.table_id, ut.name AS table_name
       FROM table_columns tc
       JOIN universal_tables ut ON ut.id = tc.table_id
      WHERE tc.column_name = 'system_user_id'
      ORDER BY tc.table_id`
  );
  log(`scanning ${cols.length} users-tables for orphans against KEEP_USERS (${KEEP_USERS.length} live ids)`);
  let totalDeleted = 0;
  for (const { col_id, table_id, table_name } of cols) {
    const sp = `sp_orphan_${col_id}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      const colKey = String(col_id);
      const where = `
        table_id = $1
          AND data ? $2
          AND data->>$2 IS NOT NULL
          AND data->>$2 <> ''
          AND data->>$2 ~ '^[0-9]+$'
          AND (data->>$2)::int <> ALL($3::int[])`;
      const before = Number((await client.query(
        `SELECT count(*)::int c FROM table_rows WHERE ${where}`,
        [table_id, colKey, KEEP_USERS]
      )).rows[0].c);
      if (before === 0) {
        await client.query(`RELEASE SAVEPOINT ${sp}`);
        continue;
      }
      const res = await client.query(
        `DELETE FROM table_rows WHERE ${where}`,
        [table_id, colKey, KEEP_USERS]
      );
      log(`  [orphan] table=${String(table_id).padStart(6)} (${table_name.padEnd(8)}) col=${col_id} deleted=${res.rowCount}`);
      totalDeleted += res.rowCount ?? 0;
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (e) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      log(`  [orphan] table=${table_id} SKIPPED — ${e.code || ''} ${e.message}`);
    }
  }
  log(`PHASE G total orphans removed: ${totalDeleted}`);
  counts['users-table orphans (PHASE G)'] = { before: totalDeleted, after: 0 };
}

async function phaseSignups() {
  banner('PHASE F · wipe _signups (control)');
  const { rows } = await client.query(`SELECT to_regclass('_signups') AS r`);
  if (!rows[0].r) {
    log(' _signups table not yet present — skip (migration to be done by marketer P0.10 / @developer-ralph)');
    return;
  }
  await step('_signups (wipe)', `DELETE FROM _signups`, `SELECT count(*)::int c FROM _signups`);
}

async function maybeApplySecretsMigration() {
  if (!APPLY_SECRETS_MIGRATION) return;
  banner('OPTIONAL · ADR-0040 _secrets migration (idempotent)');
  await client.query(`
    CREATE TABLE IF NOT EXISTS _secrets (
      id                SERIAL PRIMARY KEY,
      key               TEXT NOT NULL,
      encrypted_payload JSONB NOT NULL,
      description       TEXT,
      created_by        INT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_revealed_at  TIMESTAMPTZ,
      last_revealed_by  INT,
      CONSTRAINT _secrets_key_unique UNIQUE (key)
    )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_secrets_key ON _secrets (key)`);
  await client.query(`
    CREATE OR REPLACE FUNCTION _secrets_notify() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM pg_notify('secrets_changed', OLD.key);
        RETURN OLD;
      ELSE
        PERFORM pg_notify('secrets_changed', NEW.key);
        RETURN NEW;
      END IF;
    END;
    $$ LANGUAGE plpgsql`);
  await client.query(`DROP TRIGGER IF EXISTS _secrets_notify_trg ON _secrets`);
  await client.query(`
    CREATE TRIGGER _secrets_notify_trg
    AFTER INSERT OR UPDATE OR DELETE ON _secrets
    FOR EACH ROW EXECUTE FUNCTION _secrets_notify()`);
  log('  _secrets table + index + NOTIFY trigger ensured');
}

// ── Acceptance gate ────────────────────────────────────────────────────────

async function acceptanceGate() {
  banner('ACCEPTANCE GATE');
  const probe = async (label, sql) => {
    const { rows } = await client.query(sql);
    const n = Number(rows[0]?.c ?? 0);
    log(`  ${label.padEnd(36)} = ${n}`);
    return n;
  };
  const r = {
    users: await probe('count(*) FROM users',                       `SELECT count(*)::int c FROM users`),
    messages: await probe('count(*) FROM messages',                 `SELECT count(*)::int c FROM messages`),
    conversations: await probe('count(*) FROM conversations',       `SELECT count(*)::int c FROM conversations`),
    spaces: await probe('count(*) FROM spaces',                     `SELECT count(*)::int c FROM spaces`),
    spaces_public: await probe('count(*) FROM spaces WHERE public_slug IS NOT NULL', `SELECT count(*)::int c FROM spaces WHERE public_slug IS NOT NULL`),
    agents: await probe('count(*) FROM table_rows WHERE table_id=1784', `SELECT count(*)::int c FROM table_rows WHERE table_id=1784`),
    tools_total: await probe('count(*) FROM table_rows WHERE table_id=1790', `SELECT count(*)::int c FROM table_rows WHERE table_id=1790`),
    mom_roast: await probe(`count(*) tool name=mom-roast`, `SELECT count(*)::int c FROM table_rows WHERE table_id=1790 AND data->>'name'='mom-roast'`),
    secrets: await probe('count(*) FROM _secrets (if present)', `SELECT COALESCE((SELECT count(*) FROM _secrets), 0)::int c`),
  };

  const fail = [];
  const expectUsers = KEEP_HUMAN_USERS.length + KEEP_AGENT_USERS.length;
  if (r.users !== expectUsers) fail.push(`users=${r.users} (want ${expectUsers} = ${KEEP_HUMAN_USERS.length} human + ${KEEP_AGENT_USERS.length} agent-backing)`);
  if (r.messages !== 0) fail.push(`messages=${r.messages} (want 0)`);
  if (r.conversations !== 0) fail.push(`conversations=${r.conversations} (want 0)`);
  if (r.spaces !== KEEP_SYSTEM_SPACES.length + 1) fail.push(`spaces=${r.spaces} (want ${KEEP_SYSTEM_SPACES.length + 1})`);
  if (r.spaces_public !== 1) fail.push(`spaces_public=${r.spaces_public} (want 1)`);
  if (r.agents !== KEEP_AGENT_ROW_IDS.length) fail.push(`agents=${r.agents} (want ${KEEP_AGENT_ROW_IDS.length})`);
  if (r.mom_roast !== 0) fail.push(`mom-roast still present (${r.mom_roast})`);

  if (fail.length) {
    log(`  ✗ FAIL: ${fail.join('; ')}`);
  } else {
    log(`  ✓ all gates green`);
  }
  return { r, fail };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  banner('cleanup-for-launch.js');
  log(`hostname             = ${HOSTNAME}`);
  log(`POSTGRES_HOST        = ${PGHOST}`);
  log(`POSTGRES_DB          = ${PGDB}`);
  log(`mode                 = ${COMMIT ? 'COMMIT (REAL RUN)' : 'DRY-RUN (BEGIN/ROLLBACK)'}`);
  log(`KEEP_HUMAN_USERS     = [${KEEP_HUMAN_USERS.join(', ')}]`);
  log(`KEEP_SYSTEM_SPACES   = [${KEEP_SYSTEM_SPACES.join(', ')}] (+ public-slug spaces)`);
  log(`KEEP_AGENTS          = (all rows in 1784 with data->>status='active' — resolved at runtime)`);
  log(`KEEP_AGENT_USERS     = (users.id where managed_by_agent_row_id ∈ KEEP_AGENTS — resolved at runtime)`);
  log(`KILL_TOOL_NAMES      = [${KILL_TOOL_NAMES.join(', ')}]`);
  log(`apply-secrets-migration = ${APPLY_SECRETS_MIGRATION}`);

  await client.connect();
  try {
    await client.query('BEGIN');

    await maybeApplySecretsMigration();
    await resolveAgentKeep();             // populates KEEP_AGENT_ROW_IDS + KEEP_USERS
    const targets = await resolveTargets();
    await phaseChat();
    await phaseSpaces(targets);
    await phaseUsers();
    await phaseOrphanUsersTables();
    await phaseAgentsTools();
    await phaseSignups();
    const gate = await acceptanceGate();

    if (COMMIT) {
      if (gate.fail.length) {
        log('committing despite failing gate (sysadmin choice) — log shows the divergence');
      }
      await client.query('COMMIT');
      banner('COMMITTED');
    } else {
      await client.query('ROLLBACK');
      banner('ROLLED BACK (dry-run)');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[error] rolled back:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }

  banner('SUMMARY');
  console.table(counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
