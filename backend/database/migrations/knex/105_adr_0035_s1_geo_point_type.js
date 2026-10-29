/**
 * Migration 105: ADR-0035 Slice 1 — admit `geo_point`.
 *
 * Additive, same shape as 104: the ratchet CHECK on `table_columns.type` is
 * widened by exactly one key. The manifest (`shared/column-types.js`) already
 * lists `geo_point`, but 088 inlines a frozen list and does not read the
 * manifest, so without this migration `POST /tables/:id/columns` with
 * `type: 'geo_point'` fails on the constraint. No PostGIS, no row touched —
 * the value is JSONB inside `table_rows.data` (ADR-0035 §Slice 1, S1.1).
 * `down` restores the 104 constraint, refusing while any `geo_point` column
 * exists.
 */
import { STAGE2_TYPES } from './104_adr_0204_s2_content_contact_types.js';

export const ADR0035_TYPES = ['geo_point'];
export const STAGE3_TYPES = [...STAGE2_TYPES, ...ADR0035_TYPES].sort();

const CONSTRAINT_NAME = 'table_columns_type_ratchet';

function checkSql(types) {
  const list = types.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
  return `ALTER TABLE table_columns ADD CONSTRAINT ${CONSTRAINT_NAME} CHECK (type IN (${list}))`;
}

export async function up(knex) {
  await knex.raw(`ALTER TABLE table_columns DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);
  await knex.raw(checkSql(STAGE3_TYPES));
}

export async function down(knex) {
  const { rows } = await knex.raw(
    'SELECT type, count(*)::int AS n FROM table_columns WHERE type = ANY (?) GROUP BY type',
    [ADR0035_TYPES]
  );
  if (rows.length) {
    throw new Error(
      `[Migration 105] cannot restore the 104 ratchet: ${rows.map((r) => `${r.type} (${r.n})`).join(', ')} ` +
      'column(s) exist. Delete or retype those columns first.'
    );
  }
  await knex.raw(`ALTER TABLE table_columns DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);
  await knex.raw(checkSql(STAGE2_TYPES));
}
