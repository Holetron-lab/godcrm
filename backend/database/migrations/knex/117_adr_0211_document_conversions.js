export async function up(knex) {
  const client = knex.client.config.client;
  if (client !== 'pg' && client !== 'postgresql') return;

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS document_conversion_jobs (
      id UUID PRIMARY KEY,
      docling_task_id TEXT UNIQUE,
      space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      widget_id INTEGER NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
      requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
      source_file_id TEXT NOT NULL,
      source_name TEXT,
      source_format TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'auto' CHECK (language IN ('auto', 'en', 'ru')),
      import_request JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'converted', 'finalizing', 'completed', 'failed', 'cancelled')),
      result_markdown TEXT,
      result_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      document_id INTEGER,
      error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_document_conversion_requester ON document_conversion_jobs (requested_by, created_at)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_document_conversion_space_status ON document_conversion_jobs (space_id, status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_document_conversion_docling_task ON document_conversion_jobs (docling_task_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_document_conversion_expiry ON document_conversion_jobs (expires_at) WHERE result_markdown IS NOT NULL');
}

export async function down(knex) {
  const client = knex.client.config.client;
  if (client !== 'pg' && client !== 'postgresql') return;
  await knex.raw('DROP TABLE IF EXISTS document_conversion_jobs');
}
