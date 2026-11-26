#!/usr/bin/env node
/**
 * ADR-156 Phase 5A — Bootstrap BDD logical tables.
 *
 * Creates the 5 CRM logical tables (bdd_specs, bdd_criteria, bdd_links,
 * bdd_tests, bdd_test_runs) inside space_id=11.
 *
 * This script is IDEMPOTENT: if a table with the same `name` already exists
 * in space 11, it is skipped. Column adds are not back-filled — existing
 * tables are NOT altered. If you change the schema, drop the table first or
 * add columns manually via the CRM admin UI.
 *
 * Usage:
 *   node scripts/bootstrap-bdd-tables.js            # actually creates
 *   node scripts/bootstrap-bdd-tables.js --dry-run  # just prints plan
 *
 * It uses direct SQL (pg driver) because this is a one-shot provisioning
 * script, not a hot path. Matches the pattern used in
 * scripts/clone-dev-to-holetron.mjs.
 */

import pg from 'pg';
const { Pool } = pg;

// --- config ---------------------------------------------------------------
const SPACE_ID = 11;
// Single parent project to host all 5 BDD tables. You can override with
// --project-id <id>. If not provided, will pick (or create) a project named
// "BDD / ADR-156" inside space 11.
const DEFAULT_PROJECT_NAME = 'BDD / ADR-156';
const DRY_RUN = process.argv.includes('--dry-run');
const projectFlagIdx = process.argv.indexOf('--project-id');
const PROJECT_ID_OVERRIDE = projectFlagIdx >= 0 ? parseInt(process.argv[projectFlagIdx + 1], 10) : null;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
});

// --- schema definitions ---------------------------------------------------
// Each column: { name, type, required?, config? }
// `type` values map to CRM internal types: text, number, date, checkbox,
// json, relation, select. (See backend/services/ColumnService.js for the
// full list.) The runtime uses these as hints only — the underlying
// storage is always a JSONB blob in `table_rows.data`.

const TABLES = [
  {
    name: 'bdd_specs',
    icon: 'BookOpen',
    description: 'BDD feature specifications (Given/When/Then). One row per spec.',
    columns: [
      { name: 'title',         type: 'text',     required: true },
      { name: 'feature_file',  type: 'text' },
      { name: 'source_doc_id', type: 'number' },   // FK → documents.id (logical)
      { name: 'author',        type: 'text' },
      { name: 'status',        type: 'select',   config: { options: ['draft','active','retired'] } },
      { name: 'body_md',       type: 'text' },     // raw Gherkin
      { name: 'tags',          type: 'json' },     // [str, ...]
      { name: 'created_at',    type: 'date' },
      { name: 'updated_at',    type: 'date' },
    ],
  },
  {
    name: 'bdd_criteria',
    icon: 'CheckSquare',
    description: 'Acceptance criteria. Each row belongs to one bdd_specs row.',
    columns: [
      // ADR-156 Appendix C §1.5: `code` is the stable identity for a criterion
      // (e.g. ADR-156-AC1). Appendix C §1.6 introduces `previous_codes TEXT[]`
      // to track rename history so old references still resolve.
      { name: 'code',            type: 'text' },
      { name: 'previous_codes',  type: 'json' }, // logical TEXT[] — stored as JSON array
      { name: 'spec_id',         type: 'number', required: true },
      { name: 'source_doc_id',   type: 'number' },
      { name: 'title',           type: 'text',   required: true },
      { name: 'description',     type: 'text' },
      { name: 'status',          type: 'select', config: { options: ['pending','in_progress','agent_claimed','failed','verified','orphaned'] } },
      { name: 'claimed_at',      type: 'date' },
      { name: 'claimed_by_agent',type: 'text' },
      { name: 'failed_at',       type: 'date' },
      { name: 'failed_test_id',  type: 'number' },
      { name: 'priority',        type: 'select', config: { options: ['must','should','could','low','normal','high','blocker'] } },
      { name: 'order_index',     type: 'number' },
      { name: 'orphaned_at',     type: 'date' },
    ],
  },
  {
    name: 'bdd_links',
    icon: 'Link',
    description: 'Generic link table: (from_kind, from_id) ↔ (to_kind, to_id).',
    columns: [
      { name: 'from_kind', type: 'text', required: true }, // 'spec' | 'criterion' | 'test' | 'doc' | 'ticket'
      { name: 'from_id',   type: 'number', required: true },
      { name: 'to_kind',   type: 'text', required: true },
      { name: 'to_id',     type: 'number', required: true },
      { name: 'relation',  type: 'text' },                 // 'verifies' | 'covers' | 'derived_from' | ...
      { name: 'metadata',  type: 'json' },
    ],
  },
  {
    name: 'bdd_tests',
    icon: 'FlaskConical',
    description: 'Executable tests attached to a criterion.',
    columns: [
      // ADR-156 Appendix C §1.5: derived test code `{criterion_code}-T{m}`.
      { name: 'code',            type: 'text' },
      { name: 'criterion_id',    type: 'number', required: true },
      // ADR-156 Appendix C §1.4: parent criterion code (redundant with
      // criterion_id but used by the parser for direct code-based resolution).
      { name: 'criterion_code',  type: 'text' },
      { name: 'title',           type: 'text',   required: true },
      // ADR-156 Appendix C §1.4: runner kind — one of bash|http|sql|mcp.
      { name: 'runner',          type: 'select', config: { options: ['bash','http','sql','mcp'] } },
      // Legacy shape from iteration 1; kept for back-compat with existing rows.
      { name: 'kind',            type: 'select', config: { options: ['npm','pytest','curl','mcp','claude','other'] } },
      // ADR-156 Appendix C §1.4: test `type` (smoke|integration|contract|regression).
      { name: 'type',            type: 'select', config: { options: ['smoke','integration','contract','regression'] } },
      // Per-runner allow patterns / tool allowlist.
      { name: 'runner_config',   type: 'json' },
      { name: 'command',         type: 'text',   required: true }, // executed by worker
      // ADR-156 Appendix C §2.6: first-run review gate.
      { name: 'review_status',   type: 'select', config: { options: ['pending','approved','rejected','revoked'] } },
      { name: 'created_by',      type: 'text' },
      { name: 'is_blocking',     type: 'checkbox' },
      { name: 'disabled',        type: 'checkbox' },
      { name: 'disabled_reason', type: 'text' },
      { name: 'disabled_at',     type: 'date' },
      { name: 'last_status',     type: 'text' },
      { name: 'last_run_at',     type: 'date' },
      { name: 'timeout_ms',      type: 'number' },
    ],
  },
  {
    name: 'bdd_test_runs',
    icon: 'Activity',
    description: 'Individual execution records for bdd_tests.',
    columns: [
      { name: 'test_id',          type: 'number', required: true },
      { name: 'status',           type: 'select', config: { options: ['queued','running','passed','failed','timeout','error'] } },
      { name: 'exit_code',        type: 'number' },
      { name: 'duration_ms',      type: 'number' },
      { name: 'stdout_tail',      type: 'text' },
      { name: 'stderr_tail',      type: 'text' },
      { name: 'assertion_result', type: 'json' },
      { name: 'score',            type: 'number' },
      { name: 'triggered_by',     type: 'text' },      // 'worker' | 'agent' | 'human' | 'cron'
      { name: 'triggered_by_id',  type: 'text' },
      { name: 'run_hash',         type: 'text' },
      { name: 'started_at',       type: 'date' },
      { name: 'finished_at',      type: 'date' },
      { name: 'claimed_at',       type: 'date' },
    ],
  },
  {
    // ADR-0003 §C-4: every BDD state transition and TOTP-signed ownership act
    // is recorded here. Append-only; never mutate rows after insert.
    name: 'bdd_audit_log',
    icon: 'ScrollText',
    description: 'Append-only audit trail for BDD criterion state transitions and TOTP-signed ownership acts (ADR-0003 §C-4).',
    columns: [
      { name: 'criterion_id', type: 'number', required: true },
      { name: 'spec_id',      type: 'number' },
      { name: 'doc_id',       type: 'number' },
      { name: 'action',       type: 'select', config: { options: ['verify','waive','regress','unverify','lock','unlock'] } },
      { name: 'from_status',  type: 'text' },
      { name: 'to_status',    type: 'text' },
      { name: 'user_id',      type: 'number' },
      { name: 'actor_kind',   type: 'select', config: { options: ['user','agent','system'] } },
      { name: 'totp_hash',    type: 'text' },
      { name: 'reason',       type: 'text' },
      { name: 'caused_by',    type: 'text' },    // e.g. 'ticket:125586:reopen'
      { name: 'ip',           type: 'text' },
      { name: 'ts',           type: 'date' },
    ],
  },
];

// --- helpers --------------------------------------------------------------
async function findOrCreateProject(client) {
  if (PROJECT_ID_OVERRIDE) {
    const r = await client.query(
      'SELECT id, name, space_id FROM projects WHERE id = $1',
      [PROJECT_ID_OVERRIDE]
    );
    if (r.rows.length === 0) throw new Error(`--project-id ${PROJECT_ID_OVERRIDE} not found`);
    if (r.rows[0].space_id !== SPACE_ID) {
      throw new Error(`project ${PROJECT_ID_OVERRIDE} is in space ${r.rows[0].space_id}, not ${SPACE_ID}`);
    }
    return r.rows[0];
  }

  const existing = await client.query(
    'SELECT id, name FROM projects WHERE space_id = $1 AND name = $2 LIMIT 1',
    [SPACE_ID, DEFAULT_PROJECT_NAME]
  );
  if (existing.rows.length) return existing.rows[0];

  if (DRY_RUN) {
    console.log(`[dry-run] would create project "${DEFAULT_PROJECT_NAME}" in space ${SPACE_ID}`);
    return { id: '<new>', name: DEFAULT_PROJECT_NAME };
  }

  // Best-effort default owner: prefer space owner, else user id 1.
  const space = await client.query('SELECT owner_id FROM spaces WHERE id = $1', [SPACE_ID]);
  const ownerId = space.rows[0]?.owner_id || 1;

  const created = await client.query(`
    INSERT INTO projects (space_id, name, type, owner_id, icon, description, created_at, updated_at)
    VALUES ($1, $2, 'custom', $3, '🧪', 'ADR-156 Phase 5A — BDD/test-runner tables', NOW(), NOW())
    RETURNING id, name
  `, [SPACE_ID, DEFAULT_PROJECT_NAME, ownerId]);
  console.log(`  created project id=${created.rows[0].id} name="${DEFAULT_PROJECT_NAME}"`);
  return created.rows[0];
}

async function tableExists(client, projectId, tableName) {
  const r = await client.query(`
    SELECT ut.id
    FROM universal_tables ut
    JOIN projects p ON ut.project_id = p.id
    WHERE p.space_id = $1 AND ut.name = $2
    LIMIT 1
  `, [SPACE_ID, tableName]);
  return r.rows[0] || null;
}

async function createTable(client, projectId, spec) {
  // NOTE: PostgreSQL schema inherits SQLite heritage — is_system / is_required /
  // is_visible are INTEGER (0|1), not BOOLEAN. Pass 0/1 to avoid type errors.
  const r = await client.query(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 0, NOW(), NOW())
    RETURNING id
  `, [projectId, spec.name, spec.description, spec.icon || '📊']);
  const tableId = r.rows[0].id;

  for (let i = 0; i < spec.columns.length; i++) {
    const col = spec.columns[i];
    await client.query(`
      INSERT INTO table_columns
        (table_id, column_name, display_name, type, is_required, order_index, is_visible, config, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 1, $7, NOW(), NOW())
    `, [
      tableId,
      col.name,
      col.displayName || col.name,
      col.type,
      col.required ? 1 : 0,
      i,
      JSON.stringify(col.config || {}),
    ]);
  }
  return tableId;
}

/**
 * Idempotent column add — inserts a table_columns row for each column in
 * `spec.columns` that does NOT already exist for `tableId`. Safe to run on a
 * table that was bootstrapped by an earlier version of this script.
 *
 * ADR-156 Appendix C §1.6 specifically requires a `previous_codes TEXT[]`
 * column on `bdd_criteria` — this function is the migration path.
 */
async function ensureColumns(client, tableId, spec) {
  const existing = await client.query(
    'SELECT column_name FROM table_columns WHERE table_id = $1',
    [tableId]
  );
  const have = new Set(existing.rows.map(r => r.column_name));

  const maxOrder = await client.query(
    'SELECT COALESCE(MAX(order_index), -1) AS m FROM table_columns WHERE table_id = $1',
    [tableId]
  );
  let nextOrder = (maxOrder.rows[0]?.m ?? -1) + 1;

  const added = [];
  for (const col of spec.columns) {
    if (have.has(col.name)) continue;
    if (DRY_RUN) {
      console.log(`    [dry-run] would add column "${col.name}" (${col.type}) to ${spec.name}`);
      added.push(col.name);
      continue;
    }
    await client.query(`
      INSERT INTO table_columns
        (table_id, column_name, display_name, type, is_required, order_index, is_visible, config, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 1, $7, NOW(), NOW())
    `, [
      tableId,
      col.name,
      col.displayName || col.name,
      col.type,
      col.required ? 1 : 0,
      nextOrder++,
      JSON.stringify(col.config || {}),
    ]);
    added.push(col.name);
  }
  return added;
}

// --- main -----------------------------------------------------------------
async function main() {
  console.log(`ADR-156 Phase 5A — bootstrap BDD tables (space_id=${SPACE_ID}${DRY_RUN ? ', DRY RUN' : ''})`);

  const client = await pool.connect();
  try {
    const project = await findOrCreateProject(client);
    console.log(`  project: id=${project.id} name="${project.name}"`);

    const results = [];
    for (const spec of TABLES) {
      const existing = await tableExists(client, project.id, spec.name);
      if (existing) {
        // ADR-156 Appendix C §1.6 migration: idempotently add any new columns
        // introduced by this version of the script (e.g. previous_codes,
        // runner_config, review_status).
        const added = await ensureColumns(client, existing.id, spec);
        if (added.length) {
          console.log(`  [migrate] table "${spec.name}" (id=${existing.id}) — added columns: ${added.join(', ')}`);
          results.push({ name: spec.name, status: 'migrated', id: existing.id, added });
        } else {
          console.log(`  [skip] table "${spec.name}" already exists (id=${existing.id}) — no new columns`);
          results.push({ name: spec.name, status: 'skipped', id: existing.id });
        }
        continue;
      }
      if (DRY_RUN) {
        console.log(`  [dry-run] would create table "${spec.name}" (${spec.columns.length} columns)`);
        results.push({ name: spec.name, status: 'would_create' });
        continue;
      }
      const tableId = await createTable(client, project.id, spec);
      console.log(`  [created] table "${spec.name}" id=${tableId} (${spec.columns.length} columns)`);
      results.push({ name: spec.name, status: 'created', id: tableId });
    }

    console.log('\nSummary:');
    for (const r of results) console.log(`  - ${r.name}: ${r.status}${r.id ? ` (id=${r.id})` : ''}`);
    console.log('\nDone.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('bootstrap-bdd-tables: FAILED');
  console.error(e);
  process.exit(1);
});
