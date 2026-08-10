// 🟢 GREEN Phase: Migration for Labs Tables
// Migration 014: Add labs_projects, labs_nodes, labs_edges, labs_ai_templates tables
// ADR-043: Laboratories Feature

import { isPostgres } from '../connection.js';

/**
 * Run migration to create Labs tables
 * @param {import('better-sqlite3').Database|import('pg').Pool} db - Database instance
 */
export async function runMigration(db) {
  console.log('📦 Running Migration 014: Labs Tables...');

  if (isPostgres()) {
    // PostgreSQL version
    await runPostgresMigration(db);
  } else {
    // SQLite version
    await runSQLiteMigration(db);
  }

  console.log('✅ Migration 014 completed successfully!');
}

/**
 * PostgreSQL migration
 */
async function runPostgresMigration(db) {
  // ========================================
  // 1. CREATE: labs_projects
  // ========================================
  await db.query(`
    CREATE TABLE IF NOT EXISTS labs_projects (
      id SERIAL PRIMARY KEY,
      space_id INTEGER REFERENCES spaces(id),
      project_id VARCHAR(255) UNIQUE NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      settings JSONB DEFAULT '{}',
      ai_default_provider_id INTEGER,
      ai_default_agent_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_labs_projects_space ON labs_projects(space_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_labs_projects_project_id ON labs_projects(project_id)`);

  console.log('  ✅ Created table: labs_projects');

  // ========================================
  // 2. CREATE: labs_nodes
  // ========================================
  await db.query(`
    CREATE TABLE IF NOT EXISTS labs_nodes (
      id SERIAL PRIMARY KEY,
      project_id VARCHAR(255) NOT NULL,
      node_id VARCHAR(255) NOT NULL,
      type VARCHAR(100) NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT,
      meta JSONB DEFAULT '{}',
      ai_config JSONB DEFAULT '{}',
      ai_agent_id INTEGER,
      ai_provider_id INTEGER,
      ai_routing_config JSONB DEFAULT '{}',
      ui_config JSONB DEFAULT '{}',
      ai_visible BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project_id, node_id)
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_labs_nodes_project ON labs_nodes(project_id)`);

  console.log('  ✅ Created table: labs_nodes');

  // ========================================
  // 3. CREATE: labs_edges
  // ========================================
  await db.query(`
    CREATE TABLE IF NOT EXISTS labs_edges (
      id SERIAL PRIMARY KEY,
      project_id VARCHAR(255) NOT NULL,
      edge_id VARCHAR(255) NOT NULL,
      source_node_id VARCHAR(255) NOT NULL,
      target_node_id VARCHAR(255) NOT NULL,
      source_handle VARCHAR(100),
      target_handle VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project_id, edge_id)
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_labs_edges_project ON labs_edges(project_id)`);

  console.log('  ✅ Created table: labs_edges');

  // ========================================
  // 4. CREATE: labs_ai_templates
  // ========================================
  await db.query(`
    CREATE TABLE IF NOT EXISTS labs_ai_templates (
      id SERIAL PRIMARY KEY,
      mindworkflow_id VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100) NOT NULL,
      description TEXT,
      system_prompt TEXT,
      user_prompt_example TEXT,
      inputs JSONB DEFAULT '[]',
      settings JSONB DEFAULT '{}',
      routing_config JSONB DEFAULT '{}',
      ai_agent_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('  ✅ Created table: labs_ai_templates');
}

/**
 * SQLite migration
 */
async function runSQLiteMigration(db) {
  // ========================================
  // 1. CREATE: labs_projects
  // ========================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS labs_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id INTEGER,
      project_id TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      settings TEXT DEFAULT '{}',
      ai_default_provider_id INTEGER,
      ai_default_agent_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (space_id) REFERENCES spaces(id)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_labs_projects_space ON labs_projects(space_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_labs_projects_project_id ON labs_projects(project_id)`);

  console.log('  ✅ Created table: labs_projects');

  // ========================================
  // 2. CREATE: labs_nodes
  // ========================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS labs_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      meta TEXT DEFAULT '{}',
      ai_config TEXT DEFAULT '{}',
      ai_agent_id INTEGER,
      ai_provider_id INTEGER,
      ai_routing_config TEXT DEFAULT '{}',
      ui_config TEXT DEFAULT '{}',
      ai_visible INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, node_id)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_labs_nodes_project ON labs_nodes(project_id)`);

  console.log('  ✅ Created table: labs_nodes');

  // ========================================
  // 3. CREATE: labs_edges
  // ========================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS labs_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      source_handle TEXT,
      target_handle TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, edge_id)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_labs_edges_project ON labs_edges(project_id)`);

  console.log('  ✅ Created table: labs_edges');

  // ========================================
  // 4. CREATE: labs_ai_templates
  // ========================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS labs_ai_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mindworkflow_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT,
      user_prompt_example TEXT,
      inputs TEXT DEFAULT '[]',
      settings TEXT DEFAULT '{}',
      routing_config TEXT DEFAULT '{}',
      ai_agent_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('  ✅ Created table: labs_ai_templates');
}

// Run migration if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import('../connection.js');
  const db = getDb();
  await runMigration(db);
}