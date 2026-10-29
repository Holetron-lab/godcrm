// Ticket 231940: ADR-064 made POST /data-sources write `db_password_encrypted` and
// `ssh_private_key_encrypted`. Master A and godcrm_test carry the columns (hand DDL), but no
// migration or schema.sql backs them, so a from-scratch boot (CI, selfhost) has no place to
// store the password and getDecryptedPassword() falls back to ''. Additive and idempotent.
export async function up(knex) {
  await knex.raw(`ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS db_password_encrypted TEXT`);
  await knex.raw(`ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS ssh_private_key_encrypted TEXT`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE data_sources DROP COLUMN IF EXISTS ssh_private_key_encrypted`);
  await knex.raw(`ALTER TABLE data_sources DROP COLUMN IF EXISTS db_password_encrypted`);
}
