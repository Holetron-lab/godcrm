// backend/database/migrations/knex/007a_adr_0187_schema_parity.js
// ADR-187 Finding #2 — from-scratch schema reconciliation for the core
// dynamic-schema tables (universal_tables / table_columns / table_rows).
//
// master A accumulated manual DDL drift that the CREATE migrations (005/006/007)
// never captured. A DB built purely from migrations (a fresh community box like
// pro.hltrn.cc, or CI-from-empty) therefore diverges from production and later
// migrations fail. Two classes are reconciled here, both on tables that already
// exist by the time this migration runs (created in 005/006/007):
//
//   1. bool -> integer:  universal_tables.is_system and
//      table_columns.{is_system,is_required,is_visible} are INTEGER (0/1) on
//      master A; the dynamic-schema code and later migrations write 0/1 into
//      them (e.g. 063 inserts is_system = 1). The CREATE migrations declared
//      them boolean, so later inserts fail with "column is of type boolean but
//      expression is of type integer".
//
//   2. text -> jsonb:  table_rows.data holds every dynamic-table row's payload
//      and is JSONB on master A; 007 created it as text. Migrations and app code
//      run JSONB operators on it (e.g. 072 does jsonb_set(data, ...)), which
//      fail with "function jsonb_set(text, ...) does not exist".
//
// Idempotent + master-A-safe: each column is converted ONLY if it is still the
// wrong type, so on master A (already integer / jsonb) every target is skipped.
// Fresh tables are empty, so the in-place USING casts are trivial.
//
// NOTE (runtime parity): master A stores ~20 other columns as JSONB that their
// CREATE migrations declared text/json (agent_jobs.context, messages.metadata,
// conversations.sub_agents, spaces.*_config, labs_*, etc.). Those tables are
// created AFTER this migration, so they can't be reconciled here, and none of
// them block from-empty migration completion (no migration runs a JSONB
// operator on them). They are left as-is; a fresh box that must be byte-parity
// with master A should be provisioned from a schema-only clone. Tracked as
// ADR-187 runtime-parity debt.

const BOOL_TO_INT = [
  { table: 'universal_tables', column: 'is_system', default: 0 },
  { table: 'table_columns', column: 'is_system', default: 0 },
  { table: 'table_columns', column: 'is_required', default: 0 },
  { table: 'table_columns', column: 'is_visible', default: 1 },
];

async function currentType(knex, table, column) {
  const row = await knex('information_schema.columns')
    .where({ table_name: table, column_name: column })
    .select('data_type')
    .first();
  return row ? row.data_type : null;
}

export async function up(knex) {
  // 1. bool -> integer parity
  for (const t of BOOL_TO_INT) {
    if ((await currentType(knex, t.table, t.column)) !== 'boolean') continue;
    await knex.raw(`ALTER TABLE ${t.table} ALTER COLUMN ${t.column} DROP DEFAULT`);
    await knex.raw(
      `ALTER TABLE ${t.table} ALTER COLUMN ${t.column} TYPE integer ` +
        `USING (CASE WHEN ${t.column} THEN 1 ELSE 0 END)`,
    );
    await knex.raw(
      `ALTER TABLE ${t.table} ALTER COLUMN ${t.column} SET DEFAULT ${t.default}`,
    );
    // eslint-disable-next-line no-console
    console.log(`[007a] ${t.table}.${t.column} boolean -> integer (master-A parity)`);
  }

  // 2. text -> jsonb parity for table_rows.data (NOT NULL, no default in 007)
  const dataType = await currentType(knex, 'table_rows', 'data');
  if (dataType && dataType !== 'jsonb') {
    await knex.raw(
      `ALTER TABLE table_rows ALTER COLUMN data TYPE jsonb USING (data::jsonb)`,
    );
    // eslint-disable-next-line no-console
    console.log('[007a] table_rows.data text -> jsonb (master-A parity)');
  }
}

export async function down(knex) {
  // Parity fix toward master A's canonical shape; intentionally not reverted
  // (reverting would re-introduce the from-scratch divergence). No-op.
}
