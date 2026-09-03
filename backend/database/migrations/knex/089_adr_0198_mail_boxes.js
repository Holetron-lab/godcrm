// Migration 089: ADR-198 D3+D4 — `mail_boxes` (dovecot's view of a principal's mailbox)
// + the provisioning kill-switch.
//
// D3: one row per mailbox. `password_hash` is a DOVECOT-scheme hash ({BLF-CRYPT} for
//     provisioned boxes, {CRYPT}$6$… for the three legacy Unix boxes carried over in T1)
//     — never a plaintext secret. The plaintext lives only inside the vault-encrypted
//     `space_connectors.encrypted_payload` of that mailbox's OWN connector row (D2), so a
//     leak of this table costs hashes, not accounts. postfix/dovecot read it through a
//     dedicated read-only role that sees nothing else (AC-8) — hence a table of its own
//     rather than reusing `space_connectors`, whose payload the MTA cannot decrypt anyway.
//
// D4: the local-part is `users.handle`, so `handle` must be globally unique. Migration 076
//     (ADR-164) already adds the column + `users_handle_lower_unique` and is idempotent, so
//     a from-scratch `migrate:latest` is covered by it and this migration would be a no-op.
//     It is re-asserted here anyway because that assumption is FALSE on at least one live
//     environment: `godcrm_test` on .72 has 86 ledger rows WITHOUT 076 and no `users.handle`
//     column at all (knex CLI there is dead — corrupt migration dir + no knexfile — so 076
//     will never run on it). `IF NOT EXISTS` throughout makes this free on healthy DBs
//     (master A already carries the index) and self-sufficient on drifted ones.
//
// D6: the kill-switch row is seeded FALSE here, not left absent, because the flag reader
//     this ADR reuses (`StarterPackService.isFeatureEnabled`) is FAIL-OPEN — no row means
//     ENABLED. "Default: выключен до завершения D1" only holds if the row exists. Same
//     shape as `starter_pack_enabled` (migration 072).
//
// NOT here (deliberate): `users.email` of the 27 `.local` / 28 `@hltrn.cc` agent passports
// is not rewritten — ADR-198 D4 defers that to T0b behind an audit of what keys on email.
// Minting handles for the agents that have none is data, not schema, and lives in
// `backend/scripts/mint-agent-handles.js` (dry-run by default) — so applying this migration
// to a combat master writes no rows.
//
// Idempotent throughout; knex wraps each migration in a transaction.

const HANDLE_INDEX = 'users_handle_lower_unique';
const PROVISIONING_FLAG = 'mailbox_provisioning_enabled';

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 089] Non-PG dialect — skipping (PG-only feature).'); return; }

  // --- Pre-flight: a duplicate handle would make the UNIQUE index fail halfway AND would
  // mean two principals claiming one address. Refuse loudly with the offending rows rather
  // than picking a winner (same policy as migration 076).
  const hasHandle = await knex.schema.hasColumn('users', 'handle');
  if (hasHandle) {
    const dupes = await knex.raw(`
      SELECT lower(handle) AS handle, array_agg(id ORDER BY id) AS user_ids
        FROM users
       WHERE handle IS NOT NULL
       GROUP BY 1
      HAVING count(*) > 1
    `);
    if (dupes.rows.length > 0) {
      const detail = dupes.rows.map((r) => `  '${r.handle}' ← users ${r.user_ids.join(', ')}`).join('\n');
      throw new Error(
        `[Migration 089] ${dupes.rows.length} duplicate handle(s) — resolve manually before re-running ` +
        `(ADR-198 D4: handle is the mail local-part and must be unique):\n${detail}`
      );
    }
  } else {
    await knex.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT`);
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${HANDLE_INDEX}
      ON users (lower(handle)) WHERE handle IS NOT NULL
  `);

  // --- D3. `address` is stored lowercased by the provisioner; UNIQUE on it is the
  // collision backstop for local-part minting. The CHECK is what makes that UNIQUE mean
  // anything: SMTP/IMAP treat the address case-insensitively and dovecot looks it up
  // lowercased, so a stray `Bob@…` row would be both a duplicate of `bob@…` and
  // unauthenticable. ON DELETE CASCADE: a mailbox without its principal is an orphaned
  // credential — Maildir reaping stays an ops concern.
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS mail_boxes (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      address       TEXT    NOT NULL UNIQUE CHECK (address = lower(address)),
      local_part    TEXT    NOT NULL,
      domain        TEXT    NOT NULL,
      password_hash TEXT    NOT NULL,
      maildir       TEXT    NOT NULL,
      quota_bytes   BIGINT,
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_mail_boxes_user_id ON mail_boxes (user_id)`);

  // --- Owner guard, same reason as migration 083 (`mail_outbox`): when this file is applied
  // out-of-band by a superuser — the standing path on .72, where the knex CLI cannot run —
  // the table lands owned by `postgres`, the app role gets nothing, and provisioning dies
  // with 42501. No-op when already correct; skipped when the role is absent (CI).
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'godcrm') THEN
        EXECUTE 'ALTER TABLE mail_boxes OWNER TO godcrm';
        EXECUTE 'ALTER SEQUENCE mail_boxes_id_seq OWNER TO godcrm';
      END IF;
    END $$;
  `);

  // --- D6 kill-switch. Default FALSE: provisioning stays dark until the virtual substrate
  // (T1) passes AC-2. Same `_app_settings` jsonb pattern as `starter_pack_enabled` (mig 072).
  await knex.raw(
    `INSERT INTO _app_settings (key, value, description, created_at, updated_at)
     VALUES ('${PROVISIONING_FLAG}', 'false'::jsonb,
             'ADR-198 D6: auto-provisioning of a mailbox per principal (registration + passport issue). Owner flips to true after AC-2 (virtual mail substrate) is green.',
             NOW(), NOW())
     ON CONFLICT (key) DO NOTHING`
  );

  console.log(`[Migration 089] mail_boxes + ${HANDLE_INDEX} ensured; ${PROVISIONING_FLAG}=false — ADR-198 D3/D4/D6`);
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DELETE FROM _app_settings WHERE key = '${PROVISIONING_FLAG}'`);
  await knex.raw(`DROP INDEX IF EXISTS idx_mail_boxes_user_id`);
  await knex.raw(`DROP TABLE IF EXISTS mail_boxes`);
  // users.handle and ${HANDLE_INDEX} belong to migration 076 (ADR-164) — not dropped here.
  console.log('[Migration 089] mail_boxes dropped; users.handle left to migration 076');
}
