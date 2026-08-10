// Migration 054: ADR-0028 Phase 1 — Space Connectors registry.
//
// Per-space encrypted OAuth/API-key registry consumable by MCP tools, agents,
// and automations. See ADR-0028 §3.2 (storage), §3.3 (encryption), §3.4 (API).
//
// Schema notes:
//  - System table (NOT universal_table). Same precedent as `api_keys`.
//  - `encrypted_payload` is AES-256-GCM ciphertext via CredentialVault
//    (`{ v, iv, tag, ct }`). Never expose via API.
//  - `custom_definition` carries non-secret config for `custom_*` types
//    (e.g. authorize_url, token_url, client_id for custom_oauth2). Secrets
//    live in encrypted_payload only.
//  - CHECK enforces `(type_slug LIKE 'custom_%') = (custom_definition IS NOT NULL)`
//    so branded rows never carry custom_definition and custom_* rows always do.
//  - Soft-delete on revoke: status='revoked' + payload zeroed; row stays for audit.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    // Phase 1 is PG-only — see CLAUDE.md (SQLite removed per ADR-149).
    console.log('[Migration 054] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS space_connectors (
      id                SERIAL PRIMARY KEY,
      space_id          INT  NOT NULL,
      type_slug         TEXT NOT NULL,
      kind              TEXT NOT NULL,
      display_name      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      scopes_requested  TEXT[] NOT NULL DEFAULT '{}',
      scopes_granted    TEXT[] NOT NULL DEFAULT '{}',
      account_label     TEXT,
      encrypted_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      custom_definition JSONB,
      expires_at        TIMESTAMPTZ,
      last_refresh_at   TIMESTAMPTZ,
      last_error        TEXT,
      created_by        INT NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await knex.raw(`
    ALTER TABLE space_connectors
    DROP CONSTRAINT IF EXISTS space_connectors_status_chk
  `);
  await knex.raw(`
    ALTER TABLE space_connectors
    ADD CONSTRAINT space_connectors_status_chk
    CHECK (status IN ('pending','active','expired','revoked','error'))
  `);

  await knex.raw(`
    ALTER TABLE space_connectors
    DROP CONSTRAINT IF EXISTS space_connectors_kind_chk
  `);
  await knex.raw(`
    ALTER TABLE space_connectors
    ADD CONSTRAINT space_connectors_kind_chk
    CHECK (kind IN ('oauth2','api_key'))
  `);

  await knex.raw(`
    ALTER TABLE space_connectors
    DROP CONSTRAINT IF EXISTS space_connectors_custom_def_chk
  `);
  await knex.raw(`
    ALTER TABLE space_connectors
    ADD CONSTRAINT space_connectors_custom_def_chk
    CHECK ((type_slug LIKE 'custom_%') = (custom_definition IS NOT NULL))
  `);

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_space_connectors_space ON space_connectors(space_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_space_connectors_space_type ON space_connectors(space_id, type_slug)`);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_space_connectors_refresh
    ON space_connectors(expires_at) WHERE status = 'active'
  `);

  console.log('[Migration 054] space_connectors table + indexes + check constraints created');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_space_connectors_refresh`);
  await knex.raw(`DROP INDEX IF EXISTS idx_space_connectors_space_type`);
  await knex.raw(`DROP INDEX IF EXISTS idx_space_connectors_space`);
  await knex.raw(`DROP TABLE IF EXISTS space_connectors`);
}
