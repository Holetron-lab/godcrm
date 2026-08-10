// Migration 057: ADR-0040 Phase 0 — Owner Secrets Vault.
//
// Single-row-per-key registry for at-rest-encrypted secrets (API keys, SMTP
// creds, webhook secrets, …) consumed by services, agents, and automations.
// See ADR-0040 §3 — supersedes ad-hoc `process.env` reads (.env fallback
// retained transitionally for non-prod until D14 cutover).
//
// Schema notes:
//   - System table (leading underscore, like `_doc_statuses`). Not a
//     universal_table — never exposed via /api/v3/tables.
//   - `encrypted_payload` is AES-256-GCM ciphertext via SecretsVault
//     (`{ v, iv, tag, ct }`). NEVER returned over the wire — only the
//     vault service may decrypt.
//   - `key` is the lookup name used by callers (e.g. 'OPENAI_API_KEY').
//     UNIQUE so getSecret() can hit a single row.
//   - `last_revealed_*` columns are audit trail for the P1 reveal endpoint
//     (owner clicks "👁 show" in the Secrets settings tab).
//   - NOTIFY/LISTEN cache coherence: pg_notify('secrets_changed', key) on
//     every INSERT/UPDATE/DELETE; SecretsVault.init() opens a LISTEN
//     channel and evicts the corresponding cache entry.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 057] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS _secrets (
      id                SERIAL PRIMARY KEY,
      key               TEXT NOT NULL,
      encrypted_payload JSONB NOT NULL,
      description       TEXT,
      created_by        INT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_revealed_at  TIMESTAMPTZ,
      last_revealed_by  INT,
      CONSTRAINT _secrets_key_unique UNIQUE (key)
    )
  `);

  // Optional explicit index covers searches by key even when the unique
  // constraint name is opaque to readers. CREATE INDEX IF NOT EXISTS
  // because PG already auto-created an index for the UNIQUE constraint —
  // this only adds one if the implicit name differs.
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_secrets_key ON _secrets (key)`);

  // NOTIFY trigger — fires on every write so SecretsVault.LISTEN can
  // evict caches across processes (multiple PM2 workers, multi-tenant
  // shared infra). The channel name is fixed; the payload is the key.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION _secrets_notify() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        PERFORM pg_notify('secrets_changed', OLD.key);
        RETURN OLD;
      ELSE
        PERFORM pg_notify('secrets_changed', NEW.key);
        RETURN NEW;
      END IF;
    END;
    $$ LANGUAGE plpgsql
  `);

  await knex.raw(`DROP TRIGGER IF EXISTS _secrets_notify_trg ON _secrets`);
  await knex.raw(`
    CREATE TRIGGER _secrets_notify_trg
    AFTER INSERT OR UPDATE OR DELETE ON _secrets
    FOR EACH ROW EXECUTE FUNCTION _secrets_notify()
  `);

  console.log('[Migration 057] _secrets table + unique key index + NOTIFY trigger created');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP TRIGGER IF EXISTS _secrets_notify_trg ON _secrets`);
  await knex.raw(`DROP FUNCTION IF EXISTS _secrets_notify()`);
  await knex.raw(`DROP INDEX IF EXISTS idx_secrets_key`);
  await knex.raw(`DROP TABLE IF EXISTS _secrets`);
}
