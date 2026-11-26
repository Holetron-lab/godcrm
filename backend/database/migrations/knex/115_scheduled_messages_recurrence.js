export async function up(knex) {
  const client = knex.client.config.client;
  if (client !== 'pg' && client !== 'postgresql') return;

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT DEFAULT 'text',
      mentions TEXT DEFAULT '[]',
      attachments TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      scheduled_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'pending',
      sent_message_id INTEGER,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const columns = [
    `recurrence_cron TEXT`,
    `timezone TEXT NOT NULL DEFAULT 'Europe/Moscow'`,
    `max_runs INTEGER`,
    `runs_done INTEGER NOT NULL DEFAULT 0`,
    `last_fired_at TIMESTAMPTZ`,
    `attempts INTEGER NOT NULL DEFAULT 0`,
    `next_attempt_at TIMESTAMPTZ`,
    `sender_type TEXT NOT NULL DEFAULT 'human'`,
    `agent_id INTEGER`,
    `role TEXT NOT NULL DEFAULT 'user'`,
    `expect_reply_from INTEGER`,
    `reply_check_at TIMESTAMPTZ`,
    `reply_retries INTEGER NOT NULL DEFAULT 0`,
  ];
  for (const definition of columns) {
    await knex.raw(`ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS ${definition}`);
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending
      ON scheduled_messages (scheduled_at)
      WHERE status = 'pending'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_reply_check
      ON scheduled_messages (reply_check_at)
      WHERE reply_check_at IS NOT NULL
  `);
}

export async function down(knex) {
  const client = knex.client.config.client;
  if (client !== 'pg' && client !== 'postgresql') return;

  await knex.raw(`DROP INDEX IF EXISTS idx_scheduled_messages_reply_check`);
  await knex.raw(`
    ALTER TABLE scheduled_messages
      DROP COLUMN IF EXISTS recurrence_cron,
      DROP COLUMN IF EXISTS timezone,
      DROP COLUMN IF EXISTS max_runs,
      DROP COLUMN IF EXISTS runs_done,
      DROP COLUMN IF EXISTS last_fired_at,
      DROP COLUMN IF EXISTS attempts,
      DROP COLUMN IF EXISTS next_attempt_at,
      DROP COLUMN IF EXISTS sender_type,
      DROP COLUMN IF EXISTS agent_id,
      DROP COLUMN IF EXISTS role,
      DROP COLUMN IF EXISTS expect_reply_from,
      DROP COLUMN IF EXISTS reply_check_at,
      DROP COLUMN IF EXISTS reply_retries
  `);
}
