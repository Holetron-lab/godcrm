// Migration 074: ADR-159 §Schema — Connected Account identity block.
//
// Extends `space_connectors` (mig 054) so a connector row models what the
// provider's identity endpoint actually returns ("по-гугловски"). Google OIDC
// UserInfo is the canonical shape; every other provider normalizes onto it.
//
// Lean variant (architect-locked 2026-06-27): only the four claims the account
// switcher binds to (`sub`/`email`/`name`/`picture`) become columns; the full
// UserInfo payload rides verbatim in `profile JSONB`. Extra claims
// (email_verified, locale, hd, given/family_name…) are read from `profile` —
// promoting one to a column later is a zero-risk `ADD COLUMN` + backfill, never
// a data migration. "Самый стандартный + всегда можно добавить колонку."
//
// Uniqueness switches from (space_id, type_slug) — which never actually existed
// as a constraint — to (space_id, type_slug, account_sub). `sub` is stable,
// never reused, and survives an email rename, so it is the correct dedup key.
// NULL `account_sub` (a connector whose provider returned no identity, e.g.
// figma/notion) is allowed: Postgres treats NULLs as distinct in a UNIQUE, so
// those rows never collide and the re-auth upsert simply inserts.
//
// Backfill: existing rows predate identity capture. We give each a synthetic
// `account_sub = 'legacy:<id>'` (collision-free, satisfies the doc's "rows that
// can't resolve a sub get a one-shot synthetic legacy:<id>") and lift `email`
// from the old `account_label` where present. We deliberately do NOT fetch
// UserInfo here — that needs the vault key + network + per-row decrypt, which
// has no place in a schema migration. Real identity fills in on the next OAuth
// callback / refresh.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 074] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  // 1. Identity columns (all nullable — legacy rows + identity-less providers).
  await knex.raw(`
    ALTER TABLE space_connectors
      ADD COLUMN IF NOT EXISTS account_sub  TEXT,
      ADD COLUMN IF NOT EXISTS email        TEXT,
      ADD COLUMN IF NOT EXISTS account_name TEXT,
      ADD COLUMN IF NOT EXISTS avatar_url   TEXT,
      ADD COLUMN IF NOT EXISTS profile      JSONB
  `);

  // 2. Backfill existing rows BEFORE the new UNIQUE lands. Pure SQL, no vault.
  await knex.raw(`
    UPDATE space_connectors
       SET email = account_label
     WHERE email IS NULL AND account_label IS NOT NULL
  `);
  await knex.raw(`
    UPDATE space_connectors
       SET account_sub = 'legacy:' || id
     WHERE account_sub IS NULL
  `);

  // 3. Swap the uniqueness key to (space_id, type_slug, account_sub).
  //    The old name is dropped IF EXISTS (it was only ever an index, mig 054).
  await knex.raw(`ALTER TABLE space_connectors DROP CONSTRAINT IF EXISTS space_connectors_space_type_uq`);
  await knex.raw(`ALTER TABLE space_connectors DROP CONSTRAINT IF EXISTS space_connectors_account_uq`);
  await knex.raw(`
    ALTER TABLE space_connectors
      ADD CONSTRAINT space_connectors_account_uq
      UNIQUE (space_id, type_slug, account_sub)
  `);

  // 4. Switcher label lookup.
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_space_connectors_email ON space_connectors(space_id, email)`);

  console.log('[Migration 074] space_connectors identity block + account_sub UNIQUE added');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_space_connectors_email`);
  await knex.raw(`ALTER TABLE space_connectors DROP CONSTRAINT IF EXISTS space_connectors_account_uq`);
  await knex.raw(`
    ALTER TABLE space_connectors
      DROP COLUMN IF EXISTS account_sub,
      DROP COLUMN IF EXISTS email,
      DROP COLUMN IF EXISTS account_name,
      DROP COLUMN IF EXISTS avatar_url,
      DROP COLUMN IF EXISTS profile
  `);
}
