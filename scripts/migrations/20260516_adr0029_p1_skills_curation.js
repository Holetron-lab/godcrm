#!/usr/bin/env node
// Migration 2026-05-16: ADR-0029 Phase 1 — Skills Curation Pipeline foundation.
//
// Doc: 139099 (widget 218 ADR registry)
// Ticket: T-139147 (chain ADR-0029)
// Companion DOWN: scripts/rollback/20260516_adr0029_p1_skills_curation_down.js
// Pre-flight backup (REQUIRED):
//   /root/backups/adr-0029-p1-pre-2026-05-16-rows.jsonl
//   /root/backups/adr-0029-p1-pre-2026-05-16-cols.jsonl
//   /root/backups/adr-0029-p1-pre-2026-05-16-utabs.jsonl
//
// Scope (per ADR §3.1):
//   STEP 1  Create skill_sources virtual table (project 244 Knowledge Pipeline)
//           + 10 columns + 4 seed rows (autoskills/antigravity/anthropic-official/internal).
//   STEP 2  Create skill_adoptions virtual table (project 245 Skills & Prompts)
//           + 10 columns. No seed.
//   STEP 3  Extend table 3710 (Skills) with 18 new columns per ADR §3.1.
//           Extend status enum with imported/adapted/deprecated/blocked.
//   STEP 4  Back-fill 3 existing Skills rows (115385/115386/115387) with
//           source_id=internal/license=proprietary/release_gate=internal-only.
//   STEP 5  Migrate row 119821 (system-audit) from 1790 → 3710 (copy then delete).
//   STEP 6  Mirror 6 gitnexus FS skills from .claude/skills/gitnexus/* into 3710,
//           original_prompt=file content verbatim, upstream_sha256=sha256(file).
//
// Post-migration row count in 3710 = 10 (3 + 1 + 6).
//
// Idempotent: every INSERT gated by WHERE NOT EXISTS / ON CONFLICT DO NOTHING.
// Re-runs print 0-delta lines.

import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const { Client } = pg;

const HOST = process.env.POSTGRES_HOST || 'localhost';
const PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10);
const DB   = process.env.POSTGRES_DB   || 'godcrm_prod';
const USER = process.env.POSTGRES_USER || 'godcrm';
const PASS = process.env.POSTGRES_PASSWORD;

if (!PASS) {
  console.error('[migration] POSTGRES_PASSWORD not set');
  process.exit(1);
}

const SKILLS_TABLE_ID = 3710;
const TOOLS_TABLE_ID  = 1790;
const SYSTEM_AUDIT_OLD_ROW_ID = 119821;
const KNOWLEDGE_PIPELINE_PROJECT = 244;
const SKILLS_PROMPTS_PROJECT     = 245;

const GITNEXUS_DIR = '/root/production/business-crm/.claude/skills/gitnexus';
const GITNEXUS_SLUGS = [
  'gitnexus-cli',
  'gitnexus-debugging',
  'gitnexus-exploring',
  'gitnexus-guide',
  'gitnexus-impact-analysis',
  'gitnexus-refactoring',
];

// 18 new columns for table 3710 per ADR §3.1.
// Order: ADR §3.1 (so order_index sorts as ADR lists them).
const NEW_3710_COLUMNS = [
  { name: 'source_id', display: 'Source', type: 'relation',
    config: { relation: { enabled: true, tableId: null, valueColumn: 'id', labelColumn: 'slug', multiple: false } } },
  { name: 'source_slug', display: 'Source Slug', type: 'text' },
  { name: 'source_url', display: 'Source URL', type: 'url' },
  { name: 'upstream_sha256', display: 'Upstream SHA-256', type: 'text' },
  { name: 'upstream_version', display: 'Upstream Version', type: 'text' },
  { name: 'original_prompt', display: 'Original Prompt', type: 'text',
    config: { multiline: true, readOnly: true } },
  { name: 'adapted', display: 'Adapted', type: 'checkbox' },
  { name: 'adapted_by', display: 'Adapted By', type: 'text' },
  { name: 'adapted_at', display: 'Adapted At', type: 'datetime' },
  { name: 'license', display: 'License', type: 'select',
    config: { options: [
      { label: 'mit' }, { label: 'apache-2.0' }, { label: 'bsd-3' },
      { label: 'cc-by-4.0' }, { label: 'cc-by-sa-4.0' }, { label: 'cc-by-nc-4.0' },
      { label: 'proprietary' }, { label: 'unknown' }, { label: 'custom' },
    ] } },
  { name: 'license_url', display: 'License URL', type: 'url' },
  { name: 'release_gate', display: 'Release Gate', type: 'select',
    config: { options: [
      { label: 'ok-redistribute' }, { label: 'ok-with-attribution' },
      { label: 'internal-only' }, { label: 'blocked' },
    ] } },
  { name: 'attribution_text', display: 'Attribution', type: 'text' },
  { name: 'tags', display: 'Tags', type: 'multi_select', config: { options: [] } },
  { name: 'requires_connectors', display: 'Requires Connectors', type: 'multi_select',
    config: { options: [
      { label: 'figma' }, { label: 'notion' }, { label: 'google' },
      { label: 'slack' }, { label: 'github' },
    ] } },
  { name: 'last_imported_at', display: 'Last Imported At', type: 'datetime' },
  { name: 'last_drift_check_at', display: 'Last Drift Check At', type: 'datetime' },
  { name: 'drift_detected', display: 'Drift Detected', type: 'checkbox' },
];

const SKILL_SOURCES_COLUMNS = [
  { name: 'slug', display: 'Slug', type: 'text', required: 1 },
  { name: 'display_name', display: 'Display Name', type: 'text' },
  { name: 'catalogue_url', display: 'Catalogue URL', type: 'url' },
  { name: 'manifest_url', display: 'Manifest URL', type: 'url' },
  { name: 'fetch_kind', display: 'Fetch Kind', type: 'select',
    config: { options: [
      { label: 'manifest' }, { label: 'git-clone' }, { label: 'http-list' }, { label: 'manual' },
    ] } },
  { name: 'license_default', display: 'License Default', type: 'select',
    config: { options: [
      { label: 'mit' }, { label: 'apache-2.0' }, { label: 'bsd-3' },
      { label: 'cc-by-4.0' }, { label: 'cc-by-sa-4.0' }, { label: 'cc-by-nc-4.0' },
      { label: 'proprietary' }, { label: 'unknown' }, { label: 'custom' },
    ] } },
  { name: 'ai_review_required', display: 'AI Review Required', type: 'checkbox' },
  { name: 'last_synced_at', display: 'Last Synced At', type: 'datetime' },
  { name: 'status', display: 'Status', type: 'select',
    config: { options: [{ label: 'active' }, { label: 'paused' }, { label: 'deprecated' }] } },
  { name: 'notes', display: 'Notes', type: 'text', config: { multiline: true } },
];

const SKILL_ADOPTIONS_COLUMNS = [
  { name: 'skill_id', display: 'Skill', type: 'relation', required: 1,
    config: { relation: { enabled: true, tableId: String(SKILLS_TABLE_ID), valueColumn: 'id', labelColumn: 'name', multiple: false } } },
  { name: 'target_kind', display: 'Target Kind', type: 'select', required: 1,
    config: { options: [{ label: 'space' }, { label: 'project' }, { label: 'agent' }, { label: 'global' }] } },
  { name: 'target_id', display: 'Target ID', type: 'number' },
  { name: 'target_slug', display: 'Target Slug', type: 'text' },
  { name: 'install_path', display: 'Install Path', type: 'text' },
  { name: 'status', display: 'Status', type: 'select',
    config: { options: [{ label: 'pending' }, { label: 'active' }, { label: 'disabled' }] } },
  { name: 'installed_by', display: 'Installed By', type: 'text' },
  { name: 'installed_at', display: 'Installed At', type: 'datetime' },
  { name: 'release_safe', display: 'Release Safe', type: 'checkbox' },
  { name: 'notes', display: 'Notes', type: 'text', config: { multiline: true } },
];

const SKILL_SOURCES_SEED = [
  { slug: 'autoskills', display_name: 'autoskills (midudev)',
    catalogue_url: 'https://github.com/midudev/autoskills',
    manifest_url: 'https://github.com/midudev/autoskills/blob/main/packages/autoskills/skills-registry/index.json',
    fetch_kind: 'manifest', license_default: 'cc-by-nc-4.0',
    ai_review_required: true, status: 'active',
    notes: 'CC-BY-NC 4.0 — non-commercial. release_gate defaults to internal-only; never shipped in marketplace.' },
  { slug: 'antigravity', display_name: 'Antigravity Awesome Skills',
    catalogue_url: 'https://antigravity.dev/skills',
    manifest_url: null, fetch_kind: 'http-list',
    license_default: 'unknown', ai_review_required: true, status: 'active',
    notes: 'Mixed licenses per-skill. release_gate=blocked by default; lift per-skill after manual license read.' },
  { slug: 'anthropic-official', display_name: 'Anthropic Skill Plugins',
    catalogue_url: 'https://github.com/anthropics/claude-plugins',
    manifest_url: null, fetch_kind: 'git-clone',
    license_default: 'apache-2.0', ai_review_required: false, status: 'active',
    notes: 'Official plugins from anthropics/claude-plugins. Apache-2.0. release_gate=ok-redistribute. ' +
           'Note: frontend-design plugin has custom-license pointer (LICENSE.txt) — import as license=custom/release_gate=blocked.' },
  { slug: 'internal', display_name: 'Internal (GOD CRM)',
    catalogue_url: 'https://crm.hltrn.cc',
    manifest_url: null, fetch_kind: 'manual',
    license_default: 'proprietary', ai_review_required: false, status: 'active',
    notes: 'Our own skills. release_gate=internal-only — never ship.' },
];

async function ensureUniversalTable(client, projectId, name, displayName, icon) {
  const existing = await client.query(
    'SELECT id FROM universal_tables WHERE project_id=$1 AND name=$2',
    [projectId, name]
  );
  if (existing.rowCount > 0) {
    console.log(`  [ok] universal_tables row exists: project=${projectId} name=${name} id=${existing.rows[0].id}`);
    return existing.rows[0].id;
  }
  const result = await client.query(
    `INSERT INTO universal_tables (project_id, name, display_name, icon, is_system)
     VALUES ($1, $2, $3, $4, 0)
     RETURNING id`,
    [projectId, name, displayName, icon]
  );
  console.log(`  [new] universal_tables row created: project=${projectId} name=${name} id=${result.rows[0].id}`);
  return result.rows[0].id;
}

async function ensureColumn(client, tableId, col, orderIndex) {
  const existing = await client.query(
    'SELECT id FROM table_columns WHERE table_id=$1 AND column_name=$2',
    [tableId, col.name]
  );
  if (existing.rowCount > 0) return { id: existing.rows[0].id, created: false };
  const config = col.config ? JSON.stringify(col.config) : '{}';
  const result = await client.query(
    `INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, is_system, required)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 0, $7)
     RETURNING id`,
    [tableId, col.name, col.display, col.type, config, orderIndex, col.required || 0]
  );
  return { id: result.rows[0].id, created: true };
}

async function patchRelationConfig(client, tableId, columnName, targetTableId) {
  const result = await client.query(
    `UPDATE table_columns
     SET config = jsonb_set(
       COALESCE(config::jsonb, '{}'::jsonb),
       '{relation,tableId}',
       to_jsonb($3::text),
       true
     )::text
     WHERE table_id=$1 AND column_name=$2`,
    [tableId, columnName, String(targetTableId)]
  );
  return result.rowCount;
}

async function extendStatusEnum(client, tableId) {
  const row = await client.query(
    'SELECT id, config FROM table_columns WHERE table_id=$1 AND column_name=$2',
    [tableId, 'status']
  );
  if (row.rowCount === 0) {
    console.log(`  [skip] no status column on table ${tableId}`);
    return 0;
  }
  const cfg = row.rows[0].config ? JSON.parse(row.rows[0].config) : {};
  const opts = cfg.options || [];
  const labels = new Set(opts.map(o => (typeof o === 'string' ? o : o.label)));
  const wanted = ['imported', 'adapted', 'active', 'deprecated', 'blocked'];
  let added = 0;
  for (const w of wanted) {
    if (!labels.has(w)) { opts.push({ label: w }); added++; }
  }
  if (added === 0) return 0;
  cfg.options = opts;
  await client.query('UPDATE table_columns SET config=$1 WHERE id=$2', [JSON.stringify(cfg), row.rows[0].id]);
  return added;
}

async function rowExistsByBaseId(client, tableId, baseId) {
  const r = await client.query('SELECT id FROM table_rows WHERE table_id=$1 AND base_id=$2', [tableId, baseId]);
  return r.rowCount > 0 ? r.rows[0].id : null;
}

async function insertRow(client, tableId, baseId, data) {
  const existing = await rowExistsByBaseId(client, tableId, baseId);
  if (existing) return { id: existing, created: false };
  const r = await client.query(
    `INSERT INTO table_rows (table_id, base_id, data, created_by)
     VALUES ($1, $2, $3::jsonb, 1)
     RETURNING id`,
    [tableId, baseId, JSON.stringify(data)]
  );
  return { id: r.rows[0].id, created: true };
}

function sha256OfFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function run() {
  const client = new Client({ host: HOST, port: PORT, database: DB, user: USER, password: PASS });
  await client.connect();
  console.log(`[ADR-0029 P1] connected: ${USER}@${HOST}:${PORT}/${DB}`);

  await client.query('BEGIN');
  try {
    // ─── STEP 1 — Skill Sources table ─────────────────────────────────────
    console.log('\n[STEP 1] Skill Sources table');
    const skillSourcesId = await ensureUniversalTable(
      client, KNOWLEDGE_PIPELINE_PROJECT, 'skill_sources', 'Skill Sources', '📦'
    );
    let cols1created = 0;
    for (let i = 0; i < SKILL_SOURCES_COLUMNS.length; i++) {
      const { created } = await ensureColumn(client, skillSourcesId, SKILL_SOURCES_COLUMNS[i], (i + 1) * 10);
      if (created) cols1created++;
    }
    console.log(`  columns: +${cols1created} created (total ${SKILL_SOURCES_COLUMNS.length})`);

    // Seed 4 rows
    let seedCreated = 0;
    for (const seed of SKILL_SOURCES_SEED) {
      const { created } = await insertRow(client, skillSourcesId, `src_${seed.slug}`, seed);
      if (created) seedCreated++;
    }
    console.log(`  seed rows: +${seedCreated} created (total ${SKILL_SOURCES_SEED.length})`);

    // ─── STEP 2 — Skill Adoptions table ───────────────────────────────────
    console.log('\n[STEP 2] Skill Adoptions table');
    const skillAdoptionsId = await ensureUniversalTable(
      client, SKILLS_PROMPTS_PROJECT, 'skill_adoptions', 'Skill Adoptions', '🔗'
    );
    let cols2created = 0;
    for (let i = 0; i < SKILL_ADOPTIONS_COLUMNS.length; i++) {
      const { created } = await ensureColumn(client, skillAdoptionsId, SKILL_ADOPTIONS_COLUMNS[i], (i + 1) * 10);
      if (created) cols2created++;
    }
    console.log(`  columns: +${cols2created} created (total ${SKILL_ADOPTIONS_COLUMNS.length})`);

    // NOTE: ADR §3.3 calls for UNIQUE(skill_id, target_kind, target_id). A
    // partial unique index on table_rows would require table ownership which
    // the `godcrm` role does not hold on PROD (owner = postgres). P2
    // (/skill-import / /skill-adapt) enforces uniqueness at application
    // level. If a DBA wants to add the index later:
    //   CREATE UNIQUE INDEX skill_adoptions_unique_idx
    //   ON table_rows ((data->>'skill_id'), (data->>'target_kind'), (data->>'target_id'))
    //   WHERE table_id = <id>;
    console.log('  unique index: deferred to P2 (app-level enforcement; DBA can add partial index later)');

    // ─── STEP 3 — Extend table 3710 (Skills) ──────────────────────────────
    console.log('\n[STEP 3] Extend table 3710 (+18 columns + status enum)');
    let cols3710created = 0;
    for (let i = 0; i < NEW_3710_COLUMNS.length; i++) {
      const col = NEW_3710_COLUMNS[i];
      // patch source_id relation to point at the freshly-created skill_sources id
      if (col.name === 'source_id') {
        col.config = JSON.parse(JSON.stringify(col.config));
        col.config.relation.tableId = String(skillSourcesId);
      }
      const { created } = await ensureColumn(client, SKILLS_TABLE_ID, col, 100 + i);
      if (created) cols3710created++;
    }
    console.log(`  columns: +${cols3710created} created (total ${NEW_3710_COLUMNS.length})`);

    // If source_id existed but tableId points at NULL (re-run safety), patch it.
    const patched = await patchRelationConfig(client, SKILLS_TABLE_ID, 'source_id', skillSourcesId);
    if (patched > 0) console.log(`  patched source_id relation.tableId → ${skillSourcesId}`);

    const enumAdded = await extendStatusEnum(client, SKILLS_TABLE_ID);
    console.log(`  status enum: +${enumAdded} labels added`);

    // ─── STEP 4 — Back-fill 3 existing rows ───────────────────────────────
    console.log('\n[STEP 4] Back-fill 3 existing Skills rows');
    const sourceInternalRow = await client.query(
      `SELECT id FROM table_rows WHERE table_id=$1 AND data->>'slug'='internal'`,
      [skillSourcesId]
    );
    const internalSourceId = sourceInternalRow.rows[0]?.id;
    if (!internalSourceId) throw new Error('internal source row missing — seed failed');

    const backfillRes = await client.query(`
      UPDATE table_rows
      SET data = data
        || jsonb_build_object(
          'source_id', $2::text,
          'source_slug', 'internal',
          'original_prompt', COALESCE(data->>'prompt', ''),
          'adapted', false,
          'license', 'proprietary',
          'release_gate', 'internal-only',
          'last_imported_at', to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
        )
      WHERE table_id = $1
        AND id IN (115385, 115386, 115387)
        AND NOT (data ? 'source_id')
    `, [SKILLS_TABLE_ID, internalSourceId]);
    console.log(`  backfilled rows: ${backfillRes.rowCount}`);

    // ─── STEP 5 — Migrate system-audit (119821 from 1790 → 3710) ─────────
    console.log('\n[STEP 5] Migrate system-audit from 1790 → 3710');
    const stray = await client.query('SELECT data FROM table_rows WHERE id=$1 AND table_id=$2',
      [SYSTEM_AUDIT_OLD_ROW_ID, TOOLS_TABLE_ID]);
    if (stray.rowCount === 0) {
      console.log(`  [skip] row ${SYSTEM_AUDIT_OLD_ROW_ID} not in table ${TOOLS_TABLE_ID} (already migrated?)`);
    } else {
      const old = stray.rows[0].data;
      const newRow = {
        name: old.name || 'system-audit',
        slug: 'system-audit',
        category: old.category || 'architecture',
        prompt: old.description || '',
        original_prompt: old.description || '',
        agent: 'any',
        status: 'imported',
        source_id: String(internalSourceId),
        source_slug: 'internal',
        adapted: false,
        license: 'proprietary',
        release_gate: 'internal-only',
        last_imported_at: new Date().toISOString(),
        tags: typeof old.tags === 'string'
          ? old.tags.split(',').map(s => s.trim()).filter(Boolean)
          : (old.tags || []),
        notes: `Migrated from table 1790 row ${SYSTEM_AUDIT_OLD_ROW_ID} on 2026-05-16 (ADR-0029 P1)`,
      };
      const { id: newId, created } = await insertRow(client, SKILLS_TABLE_ID, 'system-audit', newRow);
      console.log(`  ${created ? '[new]' : '[ok]'} 3710 row id=${newId}`);
      const del = await client.query('DELETE FROM table_rows WHERE id=$1 AND table_id=$2',
        [SYSTEM_AUDIT_OLD_ROW_ID, TOOLS_TABLE_ID]);
      console.log(`  deleted from 1790: ${del.rowCount} row(s)`);
    }

    // ─── STEP 6 — Mirror 6 gitnexus FS skills ────────────────────────────
    console.log('\n[STEP 6] Mirror 6 gitnexus FS skills into 3710');
    let mirroredCreated = 0;
    for (const slug of GITNEXUS_SLUGS) {
      const realPath = path.join(GITNEXUS_DIR, slug, 'SKILL.md');
      if (!fs.existsSync(realPath)) {
        console.log(`  [warn] missing file: ${realPath} — skipping`);
        continue;
      }
      const content = fs.readFileSync(realPath, 'utf8');
      const sha = sha256OfFile(realPath);
      const data = {
        name: slug,
        slug,
        category: 'knowledge-graph',
        prompt: content,
        original_prompt: content,
        agent: 'any',
        status: 'imported',
        source_id: String(internalSourceId),
        source_slug: 'internal',
        adapted: false,
        license: 'proprietary',
        release_gate: 'internal-only',
        upstream_sha256: sha,
        last_imported_at: new Date().toISOString(),
        notes: `Mirrored from FS ${realPath} on 2026-05-16 (ADR-0029 P1)`,
      };
      const { created } = await insertRow(client, SKILLS_TABLE_ID, slug, data);
      if (created) mirroredCreated++;
    }
    console.log(`  mirrored: +${mirroredCreated} new rows (target: ${GITNEXUS_SLUGS.length})`);

    // ─── Verify final row count ───────────────────────────────────────────
    const finalCount = await client.query(
      'SELECT COUNT(*)::int AS c FROM table_rows WHERE table_id=$1', [SKILLS_TABLE_ID]
    );
    console.log(`\n[final] table 3710 row count: ${finalCount.rows[0].c} (expected: 10)`);
    if (finalCount.rows[0].c !== 10) {
      console.warn('[WARN] row count != 10 — investigate before applying to PROD');
    }

    await client.query('COMMIT');
    console.log('\n[ADR-0029 P1] COMMIT — migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ADR-0029 P1] ROLLBACK due to:', err);
    process.exit(2);
  } finally {
    await client.end();
  }
}

run();
