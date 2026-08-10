// Migration 070: ADR-0069 P1 — backfill webhooks.token_prefix / token_hash
// from existing webhooks.token plaintext, then make the two columns NOT NULL.
//
// Reads each webhooks row, computes {prefix, hash} via the canonical helper
// (backend/services/tokens/tokenHash.js), and writes them. Rows with NULL
// `token` (legacy junk if any) are skipped with a logged warning — in that
// case NOT NULL is not applied so the migration stays idempotent / reversible.
// The owner is expected to clean such rows manually and re-run a follow-up
// ALTER ... SET NOT NULL outside this migration.
//
// PG-only.

import { hashToken } from '../../../services/tokens/tokenHash.js';

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 070] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  const rows = await knex.raw(`SELECT id, token FROM webhooks`).then(r => r.rows);

  let backfilled = 0;
  let nullTokenSkipped = 0;

  for (const row of rows) {
    if (row.token == null || row.token === '') {
      nullTokenSkipped += 1;
      console.warn(`[Migration 070] webhooks.id=${row.id} has NULL/empty token — skipping (no prefix/hash backfill)`);
      continue;
    }
    const { prefix, hash } = hashToken(row.token);
    await knex.raw(
      `UPDATE webhooks SET token_prefix = ?, token_hash = ? WHERE id = ?`,
      [prefix, hash, row.id]
    );
    backfilled += 1;
  }

  console.log(`[Migration 070] backfilled prefix+hash on ${backfilled} webhook(s); skipped ${nullTokenSkipped} with NULL/empty token`);

  if (nullTokenSkipped === 0) {
    await knex.raw(`ALTER TABLE webhooks ALTER COLUMN token_prefix SET NOT NULL`);
    await knex.raw(`ALTER TABLE webhooks ALTER COLUMN token_hash   SET NOT NULL`);
    console.log('[Migration 070] webhooks.token_prefix + token_hash set NOT NULL');
  } else {
    console.warn(
      `[Migration 070] NOT NULL not applied: ${nullTokenSkipped} row(s) still have NULL token. ` +
        `Clean these rows manually, then run: ` +
        `ALTER TABLE webhooks ALTER COLUMN token_prefix SET NOT NULL; ` +
        `ALTER TABLE webhooks ALTER COLUMN token_hash SET NOT NULL;`
    );
  }
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`ALTER TABLE webhooks ALTER COLUMN token_hash   DROP NOT NULL`);
  await knex.raw(`ALTER TABLE webhooks ALTER COLUMN token_prefix DROP NOT NULL`);
  await knex.raw(`UPDATE webhooks SET token_prefix = NULL, token_hash = NULL`);
}
