// Migration 078: ADR-179 §D2/D3/D4/D5 — Fleet Identity Provider registry columns.
//
// Extends the ADR-063 `oidc_clients` table (mig 018) so one row models a full
// fleet service, not just an OAuth client. This is the transitional backing
// store: the OIDC provider now reads/writes clients through
// `services/oidc/clientRegistry.js`, so a later slice can move the store to an
// Admin-Space universal table (D2) behind the same interface with zero change
// to the provider.
//
// Every column is nullable / defaulted, so existing WorkAdventure + Penpot rows
// are untouched and keep authenticating exactly as before (back-compat is the
// point — the issuer/registry cutover is coordinated, never silent).
//
//   secret_ref                 D3 — vault key for client_secret; the row NEVER
//                                   stores a usable plaintext secret. Legacy
//                                   `client_secret` column stays as fallback.
//   token_endpoint_auth_method     'none' marks a PKCE public client (the
//                                   Chrome extension, ADR-180); default keeps
//                                   existing confidential clients confidential.
//   allowed_origins            D2 — CORP / CSP frame-ancestors / token CORS.
//   login_tier                 D4 — 'cookie' (first-party *.godcrm.ai) | 'oidc'.
//   space_id/assistant_id/
//     default_conversation     D5 — server-side per-service binding by client_id.
//   logo                       D2 — branding on consent / overlay.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 078] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE oidc_clients
      ADD COLUMN IF NOT EXISTS secret_ref                 TEXT,
      ADD COLUMN IF NOT EXISTS token_endpoint_auth_method TEXT DEFAULT 'client_secret_post',
      ADD COLUMN IF NOT EXISTS allowed_origins            JSONB,
      ADD COLUMN IF NOT EXISTS login_tier                 TEXT DEFAULT 'oidc',
      ADD COLUMN IF NOT EXISTS space_id                   INTEGER,
      ADD COLUMN IF NOT EXISTS assistant_id               INTEGER,
      ADD COLUMN IF NOT EXISTS default_conversation       INTEGER,
      ADD COLUMN IF NOT EXISTS logo                       TEXT
  `);

  // Public clients (token_endpoint_auth_method='none', e.g. the Chrome
  // extension) carry no secret at all — client_secret must be nullable. The
  // original mig-018 DDL declared it NOT NULL. Idempotent to re-run.
  await knex.raw(`ALTER TABLE oidc_clients ALTER COLUMN client_secret DROP NOT NULL`);

  // client_id lookup is the hot path for every /authorize and /token call.
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_oidc_clients_client_id ON oidc_clients(client_id)`);

  console.log('[Migration 078] oidc_clients fleet registry columns added (ADR-179)');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_oidc_clients_client_id`);
  await knex.raw(`
    ALTER TABLE oidc_clients
      DROP COLUMN IF EXISTS secret_ref,
      DROP COLUMN IF EXISTS token_endpoint_auth_method,
      DROP COLUMN IF EXISTS allowed_origins,
      DROP COLUMN IF EXISTS login_tier,
      DROP COLUMN IF EXISTS space_id,
      DROP COLUMN IF EXISTS assistant_id,
      DROP COLUMN IF EXISTS default_conversation,
      DROP COLUMN IF EXISTS logo
  `);
}
