/**
 * Migration 036: Space Types & Granular User Access Management
 * ADR-105
 *
 * Adds visibility controls to spaces, allowing them to be:
 * - 'internal'  (default) – visible only to explicit members
 * - 'open'      – visible to all authenticated users in the workspace
 * - 'external'  – accessible via a public_slug link, optionally password-protected
 *
 * New columns on `spaces`:
 * - visibility          VARCHAR(20)  – space access type (CHECK constraint)
 * - public_slug         VARCHAR(100) – unique URL slug for external spaces
 * - public_password_hash VARCHAR(255) – bcrypt hash for password-protected external spaces
 *
 * Indexes:
 * - idx_spaces_visibility   – regular index on visibility for filtered queries
 * - idx_spaces_public_slug  – partial unique index WHERE public_slug IS NOT NULL
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // ========================================
  // ADD COLUMNS TO SPACES
  // ========================================
  try {
    const hasVisibility = await knex.schema.hasColumn('spaces', 'visibility');
    if (!hasVisibility) {
      await knex.schema.alterTable('spaces', (table) => {
        table.string('visibility', 20).notNullable().defaultTo('internal');
      });
      console.log('[Migration 036] Added visibility column to spaces');
    } else {
      console.log('[Migration 036] visibility column already exists on spaces, skipping');
    }

    const hasPublicSlug = await knex.schema.hasColumn('spaces', 'public_slug');
    if (!hasPublicSlug) {
      await knex.schema.alterTable('spaces', (table) => {
        table.string('public_slug', 100).nullable().unique();
      });
      console.log('[Migration 036] Added public_slug column to spaces');
    } else {
      console.log('[Migration 036] public_slug column already exists on spaces, skipping');
    }

    const hasPasswordHash = await knex.schema.hasColumn('spaces', 'public_password_hash');
    if (!hasPasswordHash) {
      await knex.schema.alterTable('spaces', (table) => {
        table.string('public_password_hash', 255).nullable();
      });
      console.log('[Migration 036] Added public_password_hash column to spaces');
    } else {
      console.log('[Migration 036] public_password_hash column already exists on spaces, skipping');
    }

    // ========================================
    // CHECK CONSTRAINT (Postgres only)
    // ========================================
    if (isPostgres) {
      await knex.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_spaces_visibility'
          ) THEN
            ALTER TABLE spaces
              ADD CONSTRAINT chk_spaces_visibility
              CHECK (visibility IN ('internal', 'open', 'external'));
          END IF;
        END
        $$;
      `);
      console.log('[Migration 036] Added CHECK constraint chk_spaces_visibility');
    }

    // ========================================
    // INDEXES
    // ========================================
    if (isPostgres) {
      // Regular index on visibility
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_spaces_visibility
          ON spaces (visibility)
      `);
      console.log('[Migration 036] Created index idx_spaces_visibility');

      // Partial unique index on public_slug where not null
      await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_public_slug
          ON spaces (public_slug)
          WHERE public_slug IS NOT NULL
      `);
      console.log('[Migration 036] Created partial index idx_spaces_public_slug');
    } else {
      // SQLite: create regular indexes (no partial index support)
      await knex.schema.alterTable('spaces', (table) => {
        table.index('visibility', 'idx_spaces_visibility');
      });
      console.log('[Migration 036] Created index idx_spaces_visibility (SQLite)');
    }

    console.log('[Migration 036] Space visibility migration complete');
  } catch (err) {
    console.error('[Migration 036] Error during up migration:', err.message);
    throw err;
  }
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  try {
    // ========================================
    // DROP INDEXES
    // ========================================
    if (isPostgres) {
      await knex.raw('DROP INDEX IF EXISTS idx_spaces_public_slug');
      await knex.raw('DROP INDEX IF EXISTS idx_spaces_visibility');
      console.log('[Migration 036 DOWN] Dropped indexes');
    } else {
      const hasVisibility = await knex.schema.hasColumn('spaces', 'visibility');
      if (hasVisibility) {
        await knex.schema.alterTable('spaces', (table) => {
          table.dropIndex('visibility', 'idx_spaces_visibility');
        });
      }
    }

    // ========================================
    // DROP CHECK CONSTRAINT (Postgres only)
    // ========================================
    if (isPostgres) {
      await knex.raw('ALTER TABLE spaces DROP CONSTRAINT IF EXISTS chk_spaces_visibility');
      console.log('[Migration 036 DOWN] Dropped CHECK constraint chk_spaces_visibility');
    }

    // ========================================
    // DROP COLUMNS
    // ========================================
    const hasPasswordHash = await knex.schema.hasColumn('spaces', 'public_password_hash');
    if (hasPasswordHash) {
      await knex.schema.alterTable('spaces', (table) => {
        table.dropColumn('public_password_hash');
      });
      console.log('[Migration 036 DOWN] Dropped public_password_hash column');
    }

    const hasPublicSlug = await knex.schema.hasColumn('spaces', 'public_slug');
    if (hasPublicSlug) {
      await knex.schema.alterTable('spaces', (table) => {
        table.dropColumn('public_slug');
      });
      console.log('[Migration 036 DOWN] Dropped public_slug column');
    }

    const hasVisibility = await knex.schema.hasColumn('spaces', 'visibility');
    if (hasVisibility) {
      await knex.schema.alterTable('spaces', (table) => {
        table.dropColumn('visibility');
      });
      console.log('[Migration 036 DOWN] Dropped visibility column');
    }

    console.log('[Migration 036 DOWN] Space visibility rollback complete');
  } catch (err) {
    console.error('[Migration 036 DOWN] Error during down migration:', err.message);
    throw err;
  }
}
