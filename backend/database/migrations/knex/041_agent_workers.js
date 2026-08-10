/**
 * Migration 041: Agent Workers — Multi-Node Agent Infrastructure (ADR-115)
 *
 * Adds distributed worker support to agent_jobs:
 * - worker_id: which worker claimed the job
 * - heartbeat_at: last heartbeat from worker (for dead worker detection)
 *
 * Creates agent_workers registry table for tracking worker nodes.
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // ========================================
  // 1. Add worker columns to agent_jobs
  // ========================================
  const hasWorkerIdCol = await knex.schema.hasColumn('agent_jobs', 'worker_id');
  if (!hasWorkerIdCol) {
    await knex.schema.alterTable('agent_jobs', (table) => {
      table.text('worker_id');           // e.g. 'worker-vds-1', 'worker-mac-mini-1'
      table.timestamp('heartbeat_at');   // last heartbeat from worker
    });

    // Indexes for worker queries
    if (isPostgres) {
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_agent_jobs_worker ON agent_jobs(worker_id)');
      await knex.raw('CREATE INDEX IF NOT EXISTS idx_agent_jobs_heartbeat ON agent_jobs(heartbeat_at)');
      // Partial index for pending jobs (most common query)
      await knex.raw(`CREATE INDEX IF NOT EXISTS idx_agent_jobs_pending
        ON agent_jobs(created_at ASC) WHERE status = 'pending'`);
    }
  }

  // ========================================
  // 2. Create agent_workers registry table
  // ========================================
  const hasWorkersTable = await knex.schema.hasTable('agent_workers');
  if (!hasWorkersTable) {
    await knex.schema.createTable('agent_workers', (table) => {
      table.increments('id').primary();
      table.text('worker_id').unique().notNullable();   // 'worker-vds-1', 'worker-mac-mini-1'
      table.text('hostname');
      table.text('ip_address');
      table.text('os_type').defaultTo('linux');          // linux | macos
      table.text('arch').defaultTo('x86_64');            // x86_64 | arm64
      table.integer('max_concurrent').defaultTo(3);
      table.integer('current_jobs').defaultTo(0);
      table.text('status').defaultTo('online');          // online | offline | draining
      table.timestamp('last_heartbeat').defaultTo(knex.fn.now());
      if (isPostgres) {
        table.jsonb('capabilities').defaultTo('{}');     // { "claude_code": true }
        table.jsonb('metadata').defaultTo('{}');         // { "ram_gb": 16, "cores": 8 }
      } else {
        table.text('capabilities').defaultTo('{}');
        table.text('metadata').defaultTo('{}');
      }
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    if (isPostgres) {
      await knex.raw(`
        ALTER TABLE agent_workers
          ADD CONSTRAINT chk_agent_workers_status
          CHECK (status IN ('online', 'offline', 'draining'))
      `);
      await knex.raw(`
        ALTER TABLE agent_workers
          ADD CONSTRAINT chk_agent_workers_os
          CHECK (os_type IN ('linux', 'macos', 'windows'))
      `);
    }
  }

  console.log('[Migration 041] Added worker support to agent_jobs + created agent_workers table');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // Drop agent_workers table
  if (isPostgres) {
    await knex.raw('ALTER TABLE agent_workers DROP CONSTRAINT IF EXISTS chk_agent_workers_status');
    await knex.raw('ALTER TABLE agent_workers DROP CONSTRAINT IF EXISTS chk_agent_workers_os');
  }
  await knex.schema.dropTableIfExists('agent_workers');

  // Remove worker columns from agent_jobs
  const hasWorkerIdCol = await knex.schema.hasColumn('agent_jobs', 'worker_id');
  if (hasWorkerIdCol) {
    if (isPostgres) {
      await knex.raw('DROP INDEX IF EXISTS idx_agent_jobs_worker');
      await knex.raw('DROP INDEX IF EXISTS idx_agent_jobs_heartbeat');
      await knex.raw('DROP INDEX IF EXISTS idx_agent_jobs_pending');
    }
    await knex.schema.alterTable('agent_jobs', (table) => {
      table.dropColumn('worker_id');
      table.dropColumn('heartbeat_at');
    });
  }

  console.log('[Migration 041 DOWN] Removed worker support');
}
