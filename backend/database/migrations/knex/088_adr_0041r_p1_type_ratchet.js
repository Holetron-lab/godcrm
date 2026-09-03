/**
 * Migration 088: ADR-0041R Phase 1 — the type ratchet.
 *
 * `table_columns` has never carried a CHECK on `type` (verified on master A:
 * `SELECT conname FROM pg_constraint WHERE conrelid='table_columns'::regclass`
 * returns zero rows). ~31 write sites insert `type` unvalidated, one of them
 * (`agent-tools/column-tools.js`) straight from an LLM. Result: 35 distinct
 * spellings across 35 971 definitions, still growing today.
 *
 * This constraint does NOT clean anything up — Phase 4 does that. It freezes
 * the alphabet so the set cannot grow while Phases 2–3 are in flight. Phase 5
 * replaces it with the narrow CHECK generated from the owner module.
 *
 * ── The list ────────────────────────────────────────────────────────────────
 * PRESENT_ON_MASTER_A is machine-generated, not hand-typed. Regenerate with:
 *
 *   psql -h localhost -d godcrm_prod -At \
 *     -c "SELECT type FROM table_columns GROUP BY type ORDER BY type;"
 *
 * Snapshot taken 2026-08-24 on master A (.128): 35 strings, 35 971 rows,
 * 0 NULL/empty. Every existing row satisfies the CHECK by construction.
 *
 * ── Why the list is 41 and not 35 ───────────────────────────────────────────
 * ADR-0041R Phase 1 says "the exact 35 strings present on 2026-08-24". Applied
 * literally that constraint breaks column creation the first time anyone uses a
 * canonical type that simply has no rows yet:
 *
 *   - `order`, `actor`  — ADR-151 types, already in VALID_COLUMN_TYPES and
 *                         creatable through POST /tables/:id/columns today.
 *                         Zero rows only because nobody has made one yet.
 *   - `time`, `audio`   — in the frontend `ColumnType` union; ADR-0041R Phase 2
 *                         adds them to VALID_COLUMN_TYPES. A 35-string ratchet
 *                         would 500 the API the moment Phase 2 lands.
 *   - `person`          — the (unused) canon of the `user`/`person` pair.
 *   - `markdown`        — declared alias in VALID_COLUMN_TYPES; unvalidated
 *                         writers can still emit it until Phase 3 is green.
 *
 * So the ratchet is (types present on master A) ∪ (types the application
 * already declares legal). It still admits not one string the codebase does not
 * already know about, which is the entire point of Phase 1.
 *
 * ── Cross-ring safety ───────────────────────────────────────────────────────
 * Ring 0 (master A) and Ring 1 (master B, NL) are independent forks with
 * independent drift (Constitution §2), so a spelling may exist on B that has
 * never existed on A. `up()` therefore pre-flights the target database and
 * aborts naming the offending values, instead of letting `ALTER TABLE` fail
 * with a bare check-violation that says nothing about which value broke it.
 * It deliberately does NOT auto-widen the set: silently absorbing a host's
 * local drift would leave every ring with a different constraint and defeat
 * the ratchet.
 */

// 35 strings present on master A, 2026-08-24 (generated — see header).
const PRESENT_ON_MASTER_A = [
  'apiKey', 'array', 'boolean', 'button', 'checkbox', 'color', 'date',
  'datetime', 'email', 'file', 'formula', 'id', 'image', 'json', 'link',
  'long_text', 'longtext', 'multi-select', 'multi_select', 'multiselect',
  'number', 'password', 'phone', 'relation', 'richText', 'rich_text',
  'rollup', 'select', 'table', 'text', 'textarea', 'url', 'user',
  'vector', 'verification',
];

// Declared legal by the application but with zero rows on master A. Inlined
// rather than imported from ColumnService so the migration stays self-contained
// and stable if the owner module is later reordered (precedent: migration 087).
const DECLARED_BUT_UNUSED = [
  'actor', 'audio', 'markdown', 'order', 'person', 'time',
];

export const RATCHET_TYPES = [...PRESENT_ON_MASTER_A, ...DECLARED_BUT_UNUSED].sort();

const CONSTRAINT_NAME = 'table_columns_type_ratchet';

export async function up(knex) {
  const { rows: strays } = await knex.raw(
    `SELECT type, count(*)::int AS n
       FROM table_columns
      WHERE type IS NOT NULL AND type <> ALL (?)
      GROUP BY type ORDER BY n DESC`,
    [RATCHET_TYPES]
  );
  if (strays.length) {
    const detail = strays.map((r) => `${r.type} (${r.n})`).join(', ');
    throw new Error(
      `[Migration 088] ${strays.length} type value(s) on this host are outside the ` +
      `ADR-0041R ratchet set: ${detail}. This database has drifted independently of ` +
      `master A. Do not widen the list silently — decide per ADR-0041R Phase 4 whether ` +
      `each value is canon, alias, or orphan, then re-run.`
    );
  }

  // A CHECK expression is DDL; Postgres rejects bind parameters inside it, so
  // the list is inlined. Values come from the frozen constants above.
  const list = RATCHET_TYPES.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');

  // DROP-then-ADD keeps a retried partial apply from failing on "constraint
  // already exists" — and the constraint is already live on `godcrm_test`.
  await knex.raw(
    `ALTER TABLE table_columns DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`
  );
  await knex.raw(
    `ALTER TABLE table_columns
       ADD CONSTRAINT ${CONSTRAINT_NAME}
       CHECK (type IN (${list}))`
  );
}

export async function down(knex) {
  await knex.raw(
    `ALTER TABLE table_columns DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`
  );
}
