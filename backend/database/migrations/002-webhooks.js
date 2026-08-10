// 🟢 Migration 002: Webhooks System
// Creates tables for incoming webhooks and logs

/**
 * Run migration to create webhooks tables
 * @param {import('better-sqlite3').Database} db - Database instance
 */
export async function runMigration(db) {
  console.log('📦 Running Migration 002: Webhooks System...');

  // ========================================
  // 1. CREATE: webhooks
  // ========================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      table_id INTEGER,
      
      name TEXT NOT NULL,
      description TEXT,
      token TEXT UNIQUE NOT NULL,
      
      is_active INTEGER DEFAULT 1,
      
      -- Settings
      auto_create_columns INTEGER DEFAULT 1,
      flatten_payload INTEGER DEFAULT 1,
      
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (table_id) REFERENCES universal_tables(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_project ON webhooks(project_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_token ON webhooks(token)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_table ON webhooks(table_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active)`);

  console.log('  ✅ Created table: webhooks');

  // ========================================
  // 2. CREATE: webhook_logs
  // ========================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_id INTEGER NOT NULL,
      
      payload TEXT,
      source_ip TEXT,
      headers TEXT,
      
      status TEXT DEFAULT 'received',
      error_message TEXT,
      
      row_id INTEGER,
      
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME,
      
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE,
      FOREIGN KEY (row_id) REFERENCES table_rows(id) ON DELETE SET NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at)`);

  console.log('  ✅ Created table: webhook_logs');

  console.log('✅ Migration 002 completed successfully!');
}
