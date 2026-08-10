/**
 * Migration 034: Create agent_jobs table
 *
 * Asynchronous job queue for AI agent execution.
 * When an orchestrator or user triggers an agent, a job row is created
 * with status 'pending'. A worker picks it up, sets 'processing', and
 * writes results back on completion or failure.
 *
 * Key columns:
 * - job_id (UUID)      – external-facing idempotency key
 * - conversation_id    – the chat where the job was spawned
 * - agent_row_id       – row_id from the AI Agents table (1784)
 * - status             – pending | processing | completed | failed | cancelled
 * - context / result   – JSONB payloads for input & output
 * - attempts / worker  – execution tracking & retry budget
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // ========================================
  // AGENT_JOBS TABLE
  // ========================================
  await knex.schema.createTable('agent_jobs', (table) => {
    table.increments('id').primary();

    // External-facing UUID
    if (isPostgres) {
      // gen_random_uuid() is available in PG 13+
      table.uuid('job_id').notNullable().unique().defaultTo(knex.raw('gen_random_uuid()'));
    } else {
      // SQLite: generate UUID at application level; store as text
      table.string('job_id', 36).notNullable().unique();
    }

    // Conversation context
    table.integer('conversation_id').notNullable()
      .references('id').inTable('conversations');

    // Agent identification
    table.integer('agent_row_id').notNullable();  // row_id from AI Agents table (1784)
    table.integer('agent_user_id')
      .references('id').inTable('users');          // the agent's user account
    table.text('agent_name');

    // Job state
    table.text('status').notNullable().defaultTo('pending');

    // Input
    table.integer('trigger_message_id');           // the message that triggered this job
    table.integer('trigger_user_id')
      .references('id').inTable('users');           // who triggered (e.g. orchestrator)
    if (isPostgres) {
      table.jsonb('context').defaultTo('{}');       // additional context for the agent
    } else {
      table.text('context').defaultTo('{}');
    }

    // Output
    table.text('result_message');
    if (isPostgres) {
      table.jsonb('result_metadata').defaultTo('{}');
    } else {
      table.text('result_metadata').defaultTo('{}');
    }
    table.text('error_message');

    // Execution tracking
    table.integer('attempts').notNullable().defaultTo(0);
    table.integer('max_attempts').notNullable().defaultTo(3);
    table.integer('worker_pid');                    // PID of the child process

    // Timing
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('started_at');
    table.timestamp('completed_at');
    table.timestamp('timeout_at');                  // when to consider job stalled
  });

  // CHECK constraint on status (Postgres only; SQLite ignores CHECK)
  if (isPostgres) {
    await knex.raw(`
      ALTER TABLE agent_jobs
        ADD CONSTRAINT chk_agent_jobs_status
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))
    `);
  }

  // ========================================
  // INDEXES
  // ========================================
  await knex.schema.alterTable('agent_jobs', (table) => {
    table.index('status', 'idx_agent_jobs_status');
    table.index('conversation_id', 'idx_agent_jobs_conversation');
    table.index('agent_row_id', 'idx_agent_jobs_agent');
    table.index('job_id', 'idx_agent_jobs_job_id');
  });

  console.log('[Migration 034] Created agent_jobs table');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // Drop CHECK constraint first (Postgres only)
  if (isPostgres) {
    await knex.raw('ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS chk_agent_jobs_status');
  }

  await knex.schema.dropTableIfExists('agent_jobs');

  console.log('[Migration 034 DOWN] Dropped agent_jobs table');
}
