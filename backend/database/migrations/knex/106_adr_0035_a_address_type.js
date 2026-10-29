/**
 * Migration 106: ADR-0035-A — admit `address`.
 *
 * Additive, same shape as 105: the ratchet CHECK on `table_columns.type` is
 * widened by exactly one key. The manifest (`shared/column-types.js`) lists
 * `address`, but 088 inlines a frozen list and does not read the manifest, so
 * without this migration `POST /tables/:id/columns` with `type: 'address'`
 * fails on the constraint. No row touched — the value is JSONB inside
 * `table_rows.data` (ADR-0035-A §Value Schema), the link to a `geo_point`
 * column lives in `config.address.geo_column_id`. `down` restores the 105
 * constraint, refusing while any `address` column exists.
 */
import { STAGE3_TYPES } from './105_adr_0035_s1_geo_point_type.js';

export const ADR0035A_TYPES = ['address'];
export const STAGE4_TYPES = [...STAGE3_TYPES, ...ADR0035A_TYPES].sort();

const CONSTRAINT_NAME = 'table_columns_type_ratchet';

function checkSql(types) {
  const list = types.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
  return `ALTER TABLE table_columns ADD CONSTRAINT ${CONSTRAINT_NAME} CHECK (type IN (${list}))`;
}

export async function up(knex) {
  await knex.raw(`ALTER TABLE table_columns DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);
  await knex.raw(checkSql(STAGE4_TYPES));
}

export async function down(knex) {
  const { rows } = await knex.raw(
    'SELECT type, count(*)::int AS n FROM table_columns WHERE type = ANY (?) GROUP BY type',
    [ADR0035A_TYPES]
  );
  if (rows.length) {
    throw new Error(
      `[Migration 106] cannot restore the 105 ratchet: ${rows.map((r) => `${r.type} (${r.n})`).join(', ')} ` +
      'column(s) exist. Delete or retype those columns first.'
    );
  }
  await knex.raw(`ALTER TABLE table_columns DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);
  await knex.raw(checkSql(STAGE3_TYPES));
}
