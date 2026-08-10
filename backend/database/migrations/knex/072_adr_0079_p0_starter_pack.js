// Migration 072: ADR-0079 P0 — Personal Space Starter Pack v1.
//
// 1. Inject `visibility` field into AI Agents (table_id=1784) rows:
//      • Tier-A (5 agents)  → visibility = 'default'   — visible in agent picker
//      • Tier-B (4 agents)  → visibility = 'locked'    — hidden until promo/Settings unlock
// 2. Deactivate duplicate journal/planner/researcher rows that survived the smith audit.
// 3. Insert _app_settings.starter_pack_enabled = true (feature flag, owner-flippable for kill-switch).
//
// All writes idempotent (re-run safe).

const TIER_A_ROWS = [
  77630,   // tor          (PES @tor)
  110507,  // agent-smith
  168562,  // journal      (first creation; 168563 is the dup)
  168564,  // planner      (first creation; 168565 is the dup)
  168566   // researcher   (first creation; 168567 is the dup)
];

const TIER_B_ROWS = [
  31113,  // developer-ralph
  31114,  // frontend-developer
  33484,  // sysadmin
  33491   // architect
];

const DUPLICATE_AGENT_ROWS = [168563, 168565, 168567];

export async function up(knex) {
  const isPg = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPg) {
    console.log('[Migration 072] Non-PG environment — skipping.');
    return;
  }

  // 1. Tier-A → visibility=default
  await knex.raw(
    `UPDATE table_rows
        SET data = jsonb_set(data, '{visibility}', '"default"'::jsonb, true),
            updated_at = NOW()
      WHERE table_id = 1784 AND id = ANY(?::int[])`,
    [TIER_A_ROWS]
  );

  // 2. Tier-B → visibility=locked
  await knex.raw(
    `UPDATE table_rows
        SET data = jsonb_set(data, '{visibility}', '"locked"'::jsonb, true),
            updated_at = NOW()
      WHERE table_id = 1784 AND id = ANY(?::int[])`,
    [TIER_B_ROWS]
  );

  // 3. Deactivate duplicate Journal/Planner/Researcher rows (smith audit aftermath).
  await knex.raw(
    `UPDATE table_rows
        SET data = jsonb_set(data, '{status}', '"inactive"'::jsonb, true),
            updated_at = NOW()
      WHERE table_id = 1784 AND id = ANY(?::int[])`,
    [DUPLICATE_AGENT_ROWS]
  );

  // 4. Insert feature flag in _app_settings (owner-flippable kill-switch).
  // Initial value = false per orchestrator's safer-rollout instruction
  // (STARTER_PACK_V1_ENABLED=false initial); owner flips to true after smoke.
  await knex.raw(
    `INSERT INTO _app_settings (key, value, description, created_at, updated_at)
     VALUES ('starter_pack_enabled', 'false'::jsonb,
             'ADR-0079: provisioning of 6-table + welcome-widget starter pack on /auth/register. Owner flips to true to enable.',
             NOW(), NOW())
     ON CONFLICT (key) DO NOTHING`
  );

  console.log('[Migration 072] ADR-0079 P0: agent visibility flags + starter_pack_enabled=false (owner-flippable)');
}

export async function down(knex) {
  const isPg = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPg) return;

  // Strip visibility field from all 9 rows.
  const allRows = [...TIER_A_ROWS, ...TIER_B_ROWS];
  await knex.raw(
    `UPDATE table_rows
        SET data = data - 'visibility',
            updated_at = NOW()
      WHERE table_id = 1784 AND id = ANY(?::int[])`,
    [allRows]
  );

  // Revert duplicate-row status.
  await knex.raw(
    `UPDATE table_rows
        SET data = data - 'status',
            updated_at = NOW()
      WHERE table_id = 1784 AND id = ANY(?::int[])`,
    [DUPLICATE_AGENT_ROWS]
  );

  await knex.raw(`DELETE FROM _app_settings WHERE key = 'starter_pack_enabled'`);

  console.log('[Migration 072] ADR-0079 P0: rolled back');
}
