// Space Connectors: MCP kind + owner on/off switch + last real check.
//
// A connector of kind 'mcp' has no credential payload; it represents a
// server-side MCP launcher (first one: Blender MCP, scripts/blender-mcp) whose
// availability the space owner toggles from Settings → Connectors. The switch
// is a new status 'disabled' so the existing lifecycle (active/expired/
// revoked) stays untouched and every `status = 'active'` reader keeps working.
// `last_checked_at` records when the last real connection check ran; its
// outcome lands in the existing `last_error` (NULL = passed).
//
// Idempotent on purpose: godcrm_test is a copy of master A and the connector
// suite applies this file itself before running.

export async function up(knex) {
  await knex.raw(`ALTER TABLE space_connectors DROP CONSTRAINT IF EXISTS space_connectors_kind_chk`);
  await knex.raw(`
    ALTER TABLE space_connectors
    ADD CONSTRAINT space_connectors_kind_chk
    CHECK (kind IN ('oauth2','api_key','mcp'))
  `);

  await knex.raw(`ALTER TABLE space_connectors DROP CONSTRAINT IF EXISTS space_connectors_status_chk`);
  await knex.raw(`
    ALTER TABLE space_connectors
    ADD CONSTRAINT space_connectors_status_chk
    CHECK (status IN ('pending','active','expired','revoked','error','disabled'))
  `);

  await knex.raw(`ALTER TABLE space_connectors ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ`);
}

export async function down(knex) {
  // The narrower constraints cannot hold rows this migration made possible.
  await knex.raw(`DELETE FROM space_connectors WHERE kind = 'mcp'`);
  await knex.raw(`UPDATE space_connectors SET status = 'pending' WHERE status = 'disabled'`);

  await knex.raw(`ALTER TABLE space_connectors DROP CONSTRAINT IF EXISTS space_connectors_kind_chk`);
  await knex.raw(`
    ALTER TABLE space_connectors
    ADD CONSTRAINT space_connectors_kind_chk
    CHECK (kind IN ('oauth2','api_key'))
  `);
  await knex.raw(`ALTER TABLE space_connectors DROP CONSTRAINT IF EXISTS space_connectors_status_chk`);
  await knex.raw(`
    ALTER TABLE space_connectors
    ADD CONSTRAINT space_connectors_status_chk
    CHECK (status IN ('pending','active','expired','revoked','error'))
  `);
  await knex.raw(`ALTER TABLE space_connectors DROP COLUMN IF EXISTS last_checked_at`);
}
