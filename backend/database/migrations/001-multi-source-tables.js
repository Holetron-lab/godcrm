// 🟢 GREEN Phase: Migration for Multi-Source Tables
// Migration 001: Add data_sources, user_settings, sync_logs, and extend workspace_tables & table_columns

/**
 * Run migration to create/extend tables for Multi-Source Tables architecture
 * @param {import('better-sqlite3').Database} db - Database instance
 */
export async function runMigration(db) {
  console.log('📦 Running Migration 001: Multi-Source Tables...');

  // ========================================
  // 1. CREATE: user_settings (encrypted storage)
  // ========================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      
      setting_key TEXT NOT NULL,
      setting_value_encrypted TEXT NOT NULL,
      setting_type TEXT NOT NULL,
      
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      
      UNIQUE(user_id, setting_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_settings_user_type 
    ON user_settings(user_id, setting_type)
  `);

  console.log('  ✅ Created table: user_settings');

  // ========================================
  // 2. CREATE: data_sources
  // ========================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      
      ssh_host TEXT,
      ssh_port INTEGER DEFAULT 22,
      ssh_username TEXT,
      ssh_key_name TEXT,
      
      db_host TEXT,
      db_port INTEGER,
      db_name TEXT,
      db_username TEXT,
      db_password_key TEXT,
      
      last_test_at DATETIME,
      last_test_status TEXT,
      last_test_error TEXT,
      
      sync_enabled INTEGER DEFAULT 0,
      sync_interval_minutes INTEGER DEFAULT 15,
      last_sync_at DATETIME,
      
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_data_sources_workspace ON data_sources(workspace_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_data_sources_type ON data_sources(type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_data_sources_sync_enabled ON data_sources(sync_enabled)`);

  console.log('  ✅ Created table: data_sources');

  // ========================================
  // 3. EXTEND: workspace_tables (if exists)
  // ========================================
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='workspace_tables'
  `).get();

  if (tableExists) {
    // Check which columns exist
    const columns = db.prepare('PRAGMA table_info(workspace_tables)').all();
    const columnNames = columns.map(col => col.name);

    // Add columns if they don't exist
    if (!columnNames.includes('data_source_id')) {
      db.exec('ALTER TABLE workspace_tables ADD COLUMN data_source_id TEXT');
    }
    if (!columnNames.includes('source_table_name')) {
      db.exec('ALTER TABLE workspace_tables ADD COLUMN source_table_name TEXT');
    }
    if (!columnNames.includes('source_id_column')) {
      db.exec('ALTER TABLE workspace_tables ADD COLUMN source_id_column TEXT');
    }
    if (!columnNames.includes('id_validation_pattern')) {
      db.exec('ALTER TABLE workspace_tables ADD COLUMN id_validation_pattern TEXT');
    }
    if (!columnNames.includes('table_type')) {
      db.exec("ALTER TABLE workspace_tables ADD COLUMN table_type TEXT DEFAULT 'own'");
    }
    if (!columnNames.includes('is_locked')) {
      db.exec('ALTER TABLE workspace_tables ADD COLUMN is_locked INTEGER DEFAULT 0');
    }
    if (!columnNames.includes('row_count')) {
      db.exec('ALTER TABLE workspace_tables ADD COLUMN row_count INTEGER DEFAULT 0');
    }

    // Add indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_workspace_tables_data_source ON workspace_tables(data_source_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_workspace_tables_type ON workspace_tables(table_type)`);

    console.log('  ✅ Extended table: workspace_tables');
  } else {
    console.log('  ⚠️  Table workspace_tables does not exist, skipping extension');
  }

  // ========================================
  // 4. EXTEND: table_columns (if exists)
  // ========================================
  const columnsTableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='table_columns'
  `).get();

  if (columnsTableExists) {
    const columns = db.prepare('PRAGMA table_info(table_columns)').all();
    const columnNames = columns.map(col => col.name);

    // Add columns if they don't exist
    if (!columnNames.includes('is_from_source')) {
      db.exec('ALTER TABLE table_columns ADD COLUMN is_from_source INTEGER DEFAULT 0');
    }
    if (!columnNames.includes('is_primary_key')) {
      db.exec('ALTER TABLE table_columns ADD COLUMN is_primary_key INTEGER DEFAULT 0');
    }
    if (!columnNames.includes('is_locked')) {
      db.exec('ALTER TABLE table_columns ADD COLUMN is_locked INTEGER DEFAULT 0');
    }
    if (!columnNames.includes('formula')) {
      db.exec('ALTER TABLE table_columns ADD COLUMN formula TEXT');
    }
    if (!columnNames.includes('options')) {
      db.exec('ALTER TABLE table_columns ADD COLUMN options TEXT');
    }
    if (!columnNames.includes('required')) {
      db.exec('ALTER TABLE table_columns ADD COLUMN required INTEGER DEFAULT 0');
    }
    if (!columnNames.includes('unique_constraint')) {
      db.exec('ALTER TABLE table_columns ADD COLUMN unique_constraint INTEGER DEFAULT 0');
    }
    if (!columnNames.includes('default_value')) {
      db.exec('ALTER TABLE table_columns ADD COLUMN default_value TEXT');
    }

    console.log('  ✅ Extended table: table_columns');
  } else {
    console.log('  ⚠️  Table table_columns does not exist, skipping extension');
  }

  // ========================================
  // 5. CREATE: sync_logs
  // ========================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_source_id TEXT,
      table_id TEXT NOT NULL,
      
      status TEXT NOT NULL,
      
      new_records INTEGER DEFAULT 0,
      updated_records INTEGER DEFAULT 0,
      archived_records INTEGER DEFAULT 0,
      total_active_records INTEGER DEFAULT 0,
      
      error_message TEXT,
      error_details TEXT,
      
      duration_ms INTEGER,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (data_source_id) REFERENCES data_sources(id) ON DELETE SET NULL,
      FOREIGN KEY (table_id) REFERENCES workspace_tables(id) ON DELETE CASCADE
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_logs_data_source ON sync_logs(data_source_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_logs_table ON sync_logs(table_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sync_logs_synced_at ON sync_logs(synced_at)`);

  console.log('  ✅ Created table: sync_logs');

  console.log('✅ Migration 001 completed successfully!');
}
