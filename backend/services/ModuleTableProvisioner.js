/**
 * ModuleTableProvisioner — Plan B (GERATRON 2026-07-20)
 *
 * The reusable primitive behind "at module creation, provision the module's tables
 * in the target project, English-keyed by default (like the documents module), and
 * return a table mapping."
 *
 * Before this, each module either (a) duplicated the createProject/createTable/
 * createColumns trio (KanbanPackService, BusinessPackService, SystemTablesCreator, …)
 * or (b) — like SC-SIM — hand-created tables with Cyrillic column keys and then paid
 * for it with an 8-table rename migration (078 / ADR-177). A module that declares a
 * blueprint here gets English keys from creation, so no rename migration ever exists.
 *
 * Blueprint shape (declarative, documents-style column templates):
 *   {
 *     key: 'sc_sim',
 *     tables: [{
 *       key: 'schemes',                 // logical key used in the returned mapping
 *       name: 'sim_schemes',            // universal_tables.name — MUST be ASCII snake_case
 *       display_name: 'Схемы симуляций',// human label — any language, free-form
 *       icon: '🗺️',
 *       table_type: 'sim_schemes',      // optional marker (ADR-164 style)
 *       columns: [
 *         { column_name: 'graph_json', display_name: 'Граф', type: 'json', config: {...} },
 *       ],
 *     }],
 *   }
 *
 * Returns a mapping keyed by each table's blueprint `key`:
 *   { schemes: { table_id, name, created, columns: [{ column_name, display_name, type }] } }
 *
 * A module may also declare a `seed` section (consumed by seedModuleRows below) to
 * ship demo/default rows alongside its tables — the "module carries its own data"
 * primitive that lets a fresh install open on a working project instead of an empty one:
 *   {
 *     key: 'sc_sim',
 *     tables: [...],
 *     seed: [{
 *       table: 'schemes',        // logical table key — resolved through the mapping
 *       key: ['name'],           // natural-key column(s) → idempotent re-seed
 *       rows: [
 *         { name: 'Demo scheme', graph_json: {...} },
 *       ],
 *     }],
 *   }
 */

import { dbRun, dbGet, dbAll, withTransactionAsync, sqlNow } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { generateBaseId } from '../utils/baseId.js';

// Machine keys must be ASCII snake_case. This is the rail that makes "English by
// default" enforced, not merely conventional — it is the SC-SIM Cyrillic-key bug
// class caught at the boundary. Display labels are deliberately NOT constrained.
const ASCII_KEY = /^[a-z][a-z0-9_]*$/;

function assertAsciiKey(kind, value) {
  if (!ASCII_KEY.test(String(value || ''))) {
    throw new Error(
      `Invalid ${kind} "${value}": module table ${kind}s must be ASCII snake_case ` +
      `(a-z, 0-9, _). Use display_name for human-readable labels.`
    );
  }
}

/**
 * Provision (idempotently) all tables declared by a module blueprint into a project.
 * @param {number} projectId - target project the module is being created in
 * @param {object} blueprint - { key, tables: [...] }
 * @param {object} [opts]
 * @param {number} [opts.userId] - creator (created_by)
 * @param {object} [opts.trx] - an OPEN transaction handle (exposing `get`/`run`) to provision
 *   within — the same contract seedModuleRows takes below. Pass it to make an install
 *   all-or-nothing: `withTransactionAsync(trx => { provisionModuleTables(pid, bp, { trx });
 *   seedModuleRows(map, bp, { trx }); })`. Omit it and every statement autocommits, exactly as
 *   before. provisionModuleTables NEVER opens a transaction of its own — no nested BEGIN.
 * @param {boolean} [opts.reconcile] - ADR-200 W2. Default false: an already-existing table is
 *   reused as-is (its columns are never inspected), which is what every pre-W2 caller expects.
 *   With `reconcile: true` an existing table also gets the blueprint's MISSING columns appended
 *   — add-only, always: a column present in the table but absent from the blueprint is left
 *   alone, and a column whose type disagrees is NOT retyped (that would be a data-loss tool,
 *   see ADR-200 §W2). What was added comes back per table as `columns_added`.
 * @returns {Promise<Record<string, {table_id:number,name:string,created:boolean,columns:Array,columns_added:string[]}>>}
 */
export async function provisionModuleTables(projectId, blueprint, { userId = null, trx = null, reconcile = false } = {}) {
  if (!projectId) throw new Error('provisionModuleTables: projectId is required');
  if (!blueprint || !Array.isArray(blueprint.tables) || blueprint.tables.length === 0) {
    throw new Error('provisionModuleTables: blueprint.tables must be a non-empty array');
  }

  // Validate the whole blueprint up front so a bad key never half-provisions a module.
  for (const t of blueprint.tables) {
    assertAsciiKey('name', t.name);
    for (const col of (t.columns || [])) assertAsciiKey('column_name', col.column_name);
  }

  // Every read/write goes through the caller's transaction when one was given, and through
  // the autocommit helpers otherwise. Same statements, same order — only the handle differs.
  const get = trx ? (sql, params) => trx.get(sql, params) : dbGet;
  const run = trx ? (sql, params) => trx.run(sql, params) : dbRun;
  const all = trx ? (sql, params) => trx.all(sql, params) : dbAll;

  const mapping = {};

  for (const table of blueprint.tables) {
    const existing = await get(
      `SELECT id FROM universal_tables WHERE project_id = ? AND name = ?`,
      [projectId, table.name]
    );

    if (existing) {
      const columnsAdded = reconcile
        ? await addMissingColumns(existing.id, table.columns || [], { all, run })
        : [];

      mapping[table.key] = {
        table_id: existing.id,
        name: table.name,
        created: false,
        columns: (table.columns || []).map(pickColMeta),
        columns_added: columnsAdded,
      };
      apiLogger.debug(
        { projectId, table: table.name, tableId: existing.id, columnsAdded, module: blueprint.key },
        '[ModuleTableProvisioner] table already exists — reused'
      );
      continue;
    }

    const res = await run(
      `INSERT INTO universal_tables (project_id, name, display_name, table_type, icon, base_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        table.name,
        table.display_name || table.name,
        table.table_type || null,
        table.icon || null,
        generateBaseId(),
        userId,
      ]
    );
    const tableId = res.lastInsertRowid ?? res.lastID;

    await createColumns(tableId, table.columns || [], run);

    mapping[table.key] = {
      table_id: tableId,
      name: table.name,
      created: true,
      columns: (table.columns || []).map(pickColMeta),
      columns_added: [], // reconcile-only field: a table created here has no "added later" columns
    };
    apiLogger.info(
      { projectId, table: table.name, tableId, columns: (table.columns || []).length, module: blueprint.key },
      '[ModuleTableProvisioner] table provisioned'
    );
  }

  return mapping;
}

function pickColMeta(col) {
  return { column_name: col.column_name, display_name: col.display_name, type: col.type };
}

// `run` is the write handle chosen by the caller — the caller's trx or plain dbRun.
async function createColumns(tableId, columns, run = dbRun) {
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    await run(
      `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [
        tableId,
        col.column_name,
        col.display_name || col.column_name,
        col.type || 'text',
        col.order_index ?? (i + 1),
        col.config ? JSON.stringify(col.config) : null,
      ]
    );
  }
}

/**
 * ADR-200 W2 — add-only reconciliation of an EXISTING table against the blueprint.
 *
 * A module that adds a field in v2 could never roll it out onto installations that already
 * had the table: provisionModuleTables saw the name, reused it and never looked at columns.
 * This closes that, and it closes it in one direction only. Missing columns are appended;
 * extra columns (the user's own, or a previous version's) are untouched; a column whose type
 * disagrees with the blueprint is left as it is — retyping or dropping a column that already
 * holds user data turns "upgrade the module" into "lose the data".
 *
 * `order_index` continues after the table's current maximum, so appended columns land at the
 * end instead of colliding with the existing layout.
 *
 * @returns {Promise<string[]>} names of the columns actually appended
 */
async function addMissingColumns(tableId, columns, { all, run }) {
  if (columns.length === 0) return [];

  const existing = await all(
    `SELECT column_name, order_index FROM table_columns WHERE table_id = ?`,
    [tableId]
  );
  const present = new Set(existing.map((c) => c.column_name));
  const missing = columns.filter((c) => !present.has(c.column_name));
  if (missing.length === 0) return [];

  let nextOrder = existing.reduce((max, c) => Math.max(max, Number(c.order_index) || 0), 0);
  for (const col of missing) {
    nextOrder += 1;
    await run(
      `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [
        tableId,
        col.column_name,
        col.display_name || col.column_name,
        col.type || 'text',
        nextOrder,
        col.config ? JSON.stringify(col.config) : null,
      ]
    );
  }
  return missing.map((c) => c.column_name);
}

/**
 * Seed (idempotently) a module's declarative demo/default rows into the tables that
 * provisionModuleTables just created — the companion that makes a module carry its own
 * data. Rows land in the universal table_rows layer (table_id, base_id, JSON data), the
 * same shape every pack service and the sim/ai-agents modules use — no bespoke storage.
 *
 * Idempotency is by NATURAL KEY, not row id: each seed group declares `key` (one or more
 * column names) and a row is inserted only if no existing row in that table already
 * carries the same key values. Re-running the seed — or installing over a project that
 * already has the demo data — inserts nothing new. All reads + writes run inside a single
 * transaction so a concurrent install cannot double-insert.
 *
 * @param {Record<string,{table_id:number}>} mapping - a {key -> {table_id}} mapping (from
 *   provisionModuleTables, or an equivalent adapter — see SIM install)
 * @param {object} blueprint - the same blueprint; its optional `seed` array is consumed here
 * @param {object} [opts]
 * @param {number} [opts.userId] - creator (created_by) for seeded rows
 * @param {object} [opts.trx] - an OPEN transaction handle (exposing `all`/`run`) to seed
 *   within. Pass this to compose provision+seed atomically in ONE transaction (e.g. a
 *   module install trigger: `withTransactionAsync(trx => { provision(trx); seedModuleRows(map, bp, { trx }); })`)
 *   so a fresh install is all-or-nothing. Omit it and seedModuleRows opens its own
 *   transaction — never nest a `withTransactionAsync` inside another (no nested BEGIN).
 * @returns {Promise<Record<string,{seeded:number,reused:number}>>} per-table counts
 */
export async function seedModuleRows(mapping, blueprint, { userId = null, trx = null } = {}) {
  if (!mapping || typeof mapping !== 'object') {
    throw new Error('seedModuleRows: mapping (from provisionModuleTables) is required');
  }
  const seedGroups = blueprint?.seed;
  if (seedGroups == null) return {}; // seed is optional — a module without demo data is fine
  if (!Array.isArray(seedGroups)) {
    throw new Error('seedModuleRows: blueprint.seed must be an array of { table, key, rows }');
  }

  // Validate the whole seed up front so a bad group never half-seeds a module.
  for (const group of seedGroups) {
    if (!group || !group.table) {
      throw new Error('seedModuleRows: every seed group needs a `table` (blueprint table key)');
    }
    if (!mapping[group.table] || !mapping[group.table].table_id) {
      throw new Error(
        `seedModuleRows: seed group targets table "${group.table}" which is not in the ` +
        `provisioned mapping — provisionModuleTables must run for it first`
      );
    }
    if (!Array.isArray(group.key) || group.key.length === 0) {
      throw new Error(
        `seedModuleRows: seed group for "${group.table}" needs a non-empty \`key\` array ` +
        `(natural-key column name(s)) so re-seeding stays idempotent`
      );
    }
    for (const row of (group.rows || [])) {
      for (const k of group.key) {
        if (!(k in row)) {
          throw new Error(
            `seedModuleRows: a seed row for "${group.table}" is missing natural-key column ` +
            `"${k}" — every seeded row must carry all of its key columns`
          );
        }
      }
    }
  }

  const counts = {};

  // The seed body, parameterized on a transaction handle so it can run EITHER inside a
  // caller-supplied transaction (atomic provision+seed) or in its own — same code path.
  const seedWithin = async (t) => {
    for (const group of seedGroups) {
      const tableId = mapping[group.table].table_id;
      const rows = group.rows || [];

      // Load existing rows once and index them by natural-key signature (JS-side compare
      // → dialect-agnostic, no json_extract). Demo seed sets are small, so a full scan is fine.
      const existing = await t.all(
        `SELECT data FROM table_rows WHERE table_id = ?`,
        [tableId]
      );
      const seen = new Set(existing.map((r) => keySignature(parseData(r.data), group.key)));

      let seeded = 0;
      let reused = 0;
      for (const row of rows) {
        const sig = keySignature(row, group.key);
        if (seen.has(sig)) {
          reused++;
          continue;
        }
        await t.run(
          `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
          [tableId, generateBaseId(), JSON.stringify(row), userId]
        );
        seen.add(sig); // dedup duplicates within the same seed batch too
        seeded++;
      }

      counts[group.table] = { seeded, reused };
      apiLogger.info(
        { table: group.table, tableId, seeded, reused, module: blueprint.key },
        '[ModuleTableProvisioner] rows seeded'
      );
    }
  };

  // Compose inside the caller's transaction when given one (provision+seed atomic); else
  // run in our own. Both paths execute the identical seedWithin body.
  if (trx) {
    await seedWithin(trx);
  } else {
    await withTransactionAsync(seedWithin);
  }

  return counts;
}

export function parseData(data) {
  if (data == null) return {};
  return typeof data === 'string' ? JSON.parse(data || '{}') : data;
}

// A stable, order-independent signature of a row's natural-key values. JSON.stringify of
// an array preserves the declared key order and cleanly distinguishes null/number/string.
export function keySignature(row, keyCols) {
  return JSON.stringify(keyCols.map((k) => row?.[k] ?? null));
}
