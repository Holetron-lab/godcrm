// Migration 085: ADR-183 §Block B — Community Contour referral graph on `users`.
//
// Two-column self-referencing adjacency list (architect-locked, no `referrals`
// table). referral_code = code THIS user hands out (minted at signup by Block C),
// partial-UNIQUE so it is globally unambiguous once set while the many NULLs
// (legacy rows + chain roots) never collide. referred_by = who vouched for this
// user; write-once is an APP-layer invariant (Block C), not a DB constraint.
// users.id is serial INTEGER (mig 001) so the self-FK is INTEGER (cf. mig 066
// `acting_as INTEGER REFERENCES users(id)`). ON DELETE SET NULL severs the vouch
// edge without cascade-deleting referred users. idx_users_referred_by backs the
// reverse query "whom did X refer".
//
// SCOPE NOTE: `telegram_user_id` is deliberately NOT (re)created here. Migration
// 071_adr_0078_telegram_user_id.js is git-tracked and already does ADD COLUMN IF
// NOT EXISTS + partial UNIQUE in this same knex dir that migrate:latest replays
// on a fresh/CI build — so from-scratch already gets the column. The "drift"
// report grepped backend/migrations/ (nonexistent) instead of
// backend/database/migrations/knex/ — false alarm. Re-adding = redundant.
//
// Idempotent (IF NOT EXISTS throughout). Knex wraps each migration in a txn, so
// a column-without-FK partial state cannot occur — inline FK is sufficient.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 085] Non-PG dialect — skipping (PG-only feature).'); return; }

  await knex.raw(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS referral_code TEXT,
      ADD COLUMN IF NOT EXISTS referred_by   INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
      ON users (referral_code) WHERE referral_code IS NOT NULL
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by)`);

  console.log('[Migration 085] users +referral_code (partial UNIQUE) +referred_by (self-FK) — ADR-183 Block B');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;
  await knex.raw(`DROP INDEX IF EXISTS idx_users_referred_by`);
  await knex.raw(`DROP INDEX IF EXISTS idx_users_referral_code`);
  await knex.raw(`
    ALTER TABLE users
      DROP COLUMN IF EXISTS referred_by,
      DROP COLUMN IF EXISTS referral_code
  `);
}
