// Migration 064: ADR-0064 — Chat Notifications Hierarchy (WP-A).
//
// Adds the storage layer for the 4-tier notification preference walk
// (per-chat → personal → space → global). See ADR-0064 §Decision.
//
// Layers:
//   1. conversation_participants.notification_overrides   (JSONB, NEW HERE)
//   2. user_settings  setting_key='chat_notifications'    (existing table)
//   3. spaces.notification_defaults                       (JSONB, NEW HERE)
//   4. _app_settings  key='chat_notifications_global'     (NEW TABLE, app-owner editable)
//
// `_app_settings` is the canonical store for owner-managed app-wide JSON
// settings — parallel to `_secrets` (ADR-0040). Leading underscore marks
// it as a system table (never exposed via /api/v3/tables). Distinct from
// the legacy `system_settings` table (which is keyed by string + free-text
// value and is used for SMTP/rate-limit/onboarding flags).
//
// pg_notify: cache-invalidation NOTIFY is fired by the application layer
// (resolveChatPrefs.js + each PUT endpoint), NOT a DB trigger. The payload
// includes a layer-specific scope key (`{user_id?, space_id?, conversation_id?}`)
// so listeners can evict precisely the affected cache entries.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 064] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  // 1. conversation_participants.notification_overrides JSONB
  await knex.raw(`
    ALTER TABLE conversation_participants
      ADD COLUMN IF NOT EXISTS notification_overrides JSONB DEFAULT NULL
  `);

  // 2. spaces.notification_defaults JSONB
  await knex.raw(`
    ALTER TABLE spaces
      ADD COLUMN IF NOT EXISTS notification_defaults JSONB DEFAULT NULL
  `);

  // 3. _app_settings: owner-managed app-wide JSON settings registry.
  //    Single row per logical key, unique on `key`. `value` is the raw JSON
  //    payload (not encrypted — these are non-secret defaults).
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS _app_settings (
      id          SERIAL PRIMARY KEY,
      key         TEXT NOT NULL,
      value       JSONB NOT NULL,
      description TEXT,
      updated_by  INT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT _app_settings_key_unique UNIQUE (key)
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_app_settings_key ON _app_settings (key)`);

  // 4. Seed default global chat notification prefs row.
  const defaultGlobal = {
    enabled: true,
    sound_enabled: true,
    sound_volume: 0.6,
    humans: { sound: true, popup: true, badge: true },
    agents: { sound: true, popup: true, badge: true },
  };

  await knex.raw(
    `INSERT INTO _app_settings (key, value, description)
     VALUES (?, ?::jsonb, ?)
     ON CONFLICT (key) DO NOTHING`,
    [
      'chat_notifications_global',
      JSON.stringify(defaultGlobal),
      'ADR-0064 global default chat notification preferences (app-owner editable)',
    ]
  );

  console.log('[Migration 064] notification_overrides + notification_defaults columns added; _app_settings created; chat_notifications_global seeded');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`ALTER TABLE conversation_participants DROP COLUMN IF EXISTS notification_overrides`);
  await knex.raw(`ALTER TABLE spaces DROP COLUMN IF EXISTS notification_defaults`);
  // _app_settings may be reused by future ADRs; drop only the row we seeded.
  await knex.raw(`DELETE FROM _app_settings WHERE key = 'chat_notifications_global'`);
  // Leave the table behind — safer than dropping if other keys land here.
}
