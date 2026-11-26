import { getDefaultModuleBlueprints } from '../../../services/module-blueprint/defaultBlueprints.js';
import { validateBlueprint, blueprintSha256 } from '../../../services/ModuleInstaller.js';

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 109] Non-PG dialect — skipping.'); return; }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS module_registry (
      id                 SERIAL PRIMARY KEY,
      key                TEXT NOT NULL,
      origin             TEXT NOT NULL CHECK (origin IN ('default', 'internal', 'external')),
      version            TEXT NOT NULL,
      blueprint          JSONB NOT NULL,
      publisher_space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL,
      status             TEXT NOT NULL
                         CHECK (status IN ('draft', 'published', 'submitted', 'audited', 'rejected')),
      checksum           TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      category           TEXT NOT NULL DEFAULT 'general',
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS module_registry_key_origin_version_unique
      ON module_registry (key, origin, version)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS module_registry_catalog
      ON module_registry (origin, status, category)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS module_registry_publisher_space
      ON module_registry (publisher_space_id)
  `);

  for (const raw of getDefaultModuleBlueprints()) {
    const blueprint = validateBlueprint(raw);
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

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'godcrm') THEN
        EXECUTE 'ALTER TABLE module_registry OWNER TO godcrm';
        EXECUTE 'ALTER SEQUENCE module_registry_id_seq OWNER TO godcrm';
      END IF;
    END $$;
  `);
  console.log('[Migration 109] module_registry ensured and defaults seeded — ADR-207 W4.1');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;
  await knex.raw('DROP TABLE IF EXISTS module_registry');
  console.log('[Migration 109] module_registry dropped');
}
