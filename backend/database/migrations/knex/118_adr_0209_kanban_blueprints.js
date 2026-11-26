import { getDefaultModuleBlueprints } from '../../../services/module-blueprint/defaultBlueprints.js';
import { validateBlueprint, blueprintSha256 } from '../../../services/ModuleInstaller.js';

const KANBAN_BLUEPRINT_KEYS = new Set(['kanban_pack', 'preset_kanban_board']);

export async function up(knex) {
  const client = knex.client.config.client;
  if (client !== 'pg' && client !== 'postgresql') return;

  const blueprints = getDefaultModuleBlueprints()
    .filter((blueprint) => KANBAN_BLUEPRINT_KEYS.has(blueprint.key))
    .map(validateBlueprint);
  for (const blueprint of blueprints) {
    await knex.raw(`
      INSERT INTO module_registry
        (key, origin, version, blueprint, publisher_space_id, status, checksum, category)
      VALUES (?, 'default', ?, ?::jsonb, NULL, 'published', ?, 'general')
      ON CONFLICT (key, origin, version) DO UPDATE SET
        blueprint = EXCLUDED.blueprint,
        publisher_space_id = NULL,
        status = 'published',
        checksum = EXCLUDED.checksum,
        category = 'general',
        updated_at = NOW()
    `, [blueprint.key, blueprint.version, JSON.stringify(blueprint), blueprintSha256(blueprint)]);
  }
}

export async function down() {
  // The previous registry payloads are not recoverable after this data refresh.
}
