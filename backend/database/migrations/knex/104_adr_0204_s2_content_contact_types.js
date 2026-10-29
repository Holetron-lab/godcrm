/**
 * Migration 104: ADR-204 Stage 2a — admit `content` and `contact`.
 *
 * Additive. The Phase 1 ratchet (088) froze the alphabet of
 * `table_columns.type`; this widens it by exactly the two keys ADR-204
 * introduces, keeping every legacy spelling admissible for the reversibility
 * window (image/audio/email/phone/user/person stay valid — a switched column
 * must be able to switch back). No row is touched; the value adapters live in
 * backend/services/column-adapters/ and run separately, column by column.
 *
 * 088 is not rewritten: its RATCHET_TYPES export is the frozen Phase 1 set
 * and is imported here so the two migrations cannot disagree. `down` restores
 * the 088 constraint, refusing while any column already holds a new key.
 */
import { RATCHET_TYPES } from './088_adr_0041r_p1_type_ratchet.js';

export const ADR204_TYPES = ['content', 'contact'];
export const STAGE2_TYPES = [...RATCHET_TYPES, ...ADR204_TYPES].sort();

const CONSTRAINT_NAME = 'table_columns_type_ratchet';

function checkSql(types) {
  const list = types.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
  return `ALTER TABLE table_columns ADD CONSTRAINT ${CONSTRAINT_NAME} CHECK (type IN (${list}))`;
}

export async function up(knex) {
  await knex.raw(`ALTER TABLE table_columns DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);
  await knex.raw(checkSql(STAGE2_TYPES));
}

export async function down(knex) {
  const { rows } = await knex.raw(
    'SELECT type, count(*)::int AS n FROM table_columns WHERE type = ANY (?) GROUP BY type',
    [ADR204_TYPES]
  );
  if (rows.length) {
    throw new Error(
      `[Migration 104] cannot restore the 088 ratchet: ${rows.map((r) => `${r.type} (${r.n})`).join(', ')} ` +
      'column(s) exist. Undo those columns through their adapter artifacts first.'
    );
  }
  await knex.raw(`ALTER TABLE table_columns DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);
  await knex.raw(checkSql(RATCHET_TYPES));
}
