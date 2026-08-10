/**
 * Migration 037: Space Invitations & view_id extension
 * ADR-105
 *
 * 1. Adds `view_id` column to `user_access_permissions` table
 *    - INTEGER, nullable – references a view for granular per-view access control
 *    - No FK constraint because a `views` table does not yet exist;
 *      will be added in a future migration when the views feature lands.
 *
 * 2. Creates `space_invitations` table for email-based invite flow:
 *    - Token-based invitation links with expiry
 *    - Status lifecycle: pending -> accepted | expired | revoked
 *    - Partial index on token WHERE status = 'pending' for fast lookups
 *    - Index on invited_email for per-user queries
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  try {
    // ========================================
    // 1. ADD view_id TO user_access_permissions
    // ========================================
    const hasViewId = await knex.schema.hasColumn('user_access_permissions', 'view_id');
    if (!hasViewId) {
      await knex.schema.alterTable('user_access_permissions', (table) => {
        table.integer('view_id').unsigned().nullable();
      });
      console.log('[Migration 037] Added view_id column to user_access_permissions');
    } else {
      console.log('[Migration 037] view_id column already exists on user_access_permissions, skipping');
    }

    // ========================================
    // 2. CREATE space_invitations TABLE
    // ========================================
    const hasTable = await knex.schema.hasTable('space_invitations');
    if (!hasTable) {
      await knex.schema.createTable('space_invitations', (table) => {
        table.increments('id').primary();
        table.integer('space_id').unsigned().notNullable()
          .references('id').inTable('spaces').onDelete('CASCADE');
        table.integer('invited_by').unsigned().notNullable()
          .references('id').inTable('users');
        table.string('invited_email', 255).notNullable();
        table.string('role', 20).notNullable().defaultTo('viewer');
        table.string('token', 255).notNullable().unique();
        table.string('status', 20).defaultTo('pending');
        table.timestamp('expires_at').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('accepted_at').nullable();
      });
      console.log('[Migration 037] Created space_invitations table');

      // ========================================
      // CHECK CONSTRAINT on status (Postgres only)
      // ========================================
      if (isPostgres) {
        await knex.raw(`
          ALTER TABLE space_invitations
            ADD CONSTRAINT chk_space_invitations_status
            CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
        `);
        console.log('[Migration 037] Added CHECK constraint chk_space_invitations_status');
      }

      // ========================================
      // INDEXES
      // ========================================
      if (isPostgres) {
        // Partial index on token for fast pending-invitation lookups
        await knex.raw(`
          CREATE INDEX IF NOT EXISTS idx_space_invitations_token_pending
            ON space_invitations (token)
            WHERE status = 'pending'
        `);
        console.log('[Migration 037] Created partial index idx_space_invitations_token_pending');

        // Regular index on invited_email
        await knex.raw(`
          CREATE INDEX IF NOT EXISTS idx_space_invitations_email
            ON space_invitations (invited_email)
        `);
        console.log('[Migration 037] Created index idx_space_invitations_email');
      } else {
        // SQLite: regular indexes (no partial index support)
        await knex.schema.alterTable('space_invitations', (table) => {
          table.index('token', 'idx_space_invitations_token_pending');
          table.index('invited_email', 'idx_space_invitations_email');
        });
        console.log('[Migration 037] Created indexes (SQLite)');
      }
    } else {
      console.log('[Migration 037] space_invitations table already exists, skipping');
    }

    console.log('[Migration 037] Space invitations migration complete');
  } catch (err) {
    console.error('[Migration 037] Error during up migration:', err.message);
    throw err;
  }
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  try {
    // ========================================
    // DROP space_invitations TABLE
    // ========================================
    if (isPostgres) {
      // Drop CHECK constraint before table (Postgres only)
      await knex.raw('ALTER TABLE space_invitations DROP CONSTRAINT IF EXISTS chk_space_invitations_status');
      console.log('[Migration 037 DOWN] Dropped CHECK constraint chk_space_invitations_status');
    }

    await knex.schema.dropTableIfExists('space_invitations');
    console.log('[Migration 037 DOWN] Dropped space_invitations table');

    // ========================================
    // DROP view_id FROM user_access_permissions
    // ========================================
    const hasViewId = await knex.schema.hasColumn('user_access_permissions', 'view_id');
    if (hasViewId) {
      await knex.schema.alterTable('user_access_permissions', (table) => {
        table.dropColumn('view_id');
      });
      console.log('[Migration 037 DOWN] Dropped view_id column from user_access_permissions');
    }

    console.log('[Migration 037 DOWN] Space invitations rollback complete');
  } catch (err) {
    console.error('[Migration 037 DOWN] Error during down migration:', err.message);
    throw err;
  }
}
