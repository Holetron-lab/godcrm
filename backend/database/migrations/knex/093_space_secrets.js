// Existing vault entries belong to Development (the original owner boundary).
// Knex runs this migration in a transaction; no ciphertext is rewritten.
export async function up(knex) {
  await knex.raw(`ALTER TABLE _secrets ADD COLUMN IF NOT EXISTS space_id INTEGER NOT NULL DEFAULT 11`);
  await knex.raw(`ALTER TABLE _secrets DROP CONSTRAINT IF EXISTS _secrets_key_unique`);
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_space_key ON _secrets (space_id, key)`);
}

export async function down(knex) {
  // Never silently flatten another space's secrets into the legacy vault.
  await knex.raw(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM _secrets WHERE space_id <> 11) THEN
      RAISE EXCEPTION 'Cannot roll back space secrets while non-Development secrets exist';
    END IF;
  END $$`);
  await knex.raw(`DROP INDEX IF EXISTS idx_secrets_space_key`);
  await knex.raw(`ALTER TABLE _secrets ADD CONSTRAINT _secrets_key_unique UNIQUE (key)`);
  await knex.raw(`ALTER TABLE _secrets DROP COLUMN space_id`);
}
