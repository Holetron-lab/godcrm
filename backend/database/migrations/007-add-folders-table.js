/**
 * Migration: 007 - Add folders table
 * Based on ADR-004: Space Manager XL Modal
 * 
 * Adds:
 * - folders table for organizing items within projects
 * - folder_id to universal_tables
 * - folder_id to widgets
 * - order_index for sorting
 */

import { dbRun, dbGet, dbAll } from '../connection.js';

export async function up() {
  console.log('[Migration 007] Creating folders table...');
  
  // 1. Create folders table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      parent_folder_id INTEGER NULL,
      name VARCHAR(255) NOT NULL,
      icon VARCHAR(10) DEFAULT '📁',
      color VARCHAR(20) NULL,
      order_index INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE CASCADE
    )
  `);
  
  // 2. Create indexes
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_folders_project_id ON folders(project_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_folder_id)`);
  
  // 3. Add folder_id to universal_tables if not exists
  const tableInfo = await dbAll(`PRAGMA table_info(universal_tables)`);
  const hasFolderId = tableInfo.some(col => col.name === 'folder_id');
  
  if (!hasFolderId) {
    console.log('[Migration 007] Adding folder_id to universal_tables...');
    await dbRun(`ALTER TABLE universal_tables ADD COLUMN folder_id INTEGER NULL`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_tables_folder_id ON universal_tables(folder_id)`);
  }
  
  // 4. Add order_index to universal_tables if not exists
  const hasOrderIndex = tableInfo.some(col => col.name === 'order_index');
  if (!hasOrderIndex) {
    console.log('[Migration 007] Adding order_index to universal_tables...');
    await dbRun(`ALTER TABLE universal_tables ADD COLUMN order_index INTEGER DEFAULT 0`);
  }
  
  // 5. Add folder_id to widgets if not exists
  const widgetInfo = await dbAll(`PRAGMA table_info(widgets)`);
  const widgetHasFolderId = widgetInfo.some(col => col.name === 'folder_id');
  
  if (!widgetHasFolderId) {
    console.log('[Migration 007] Adding folder_id to widgets...');
    await dbRun(`ALTER TABLE widgets ADD COLUMN folder_id INTEGER NULL`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_widgets_folder_id ON widgets(folder_id)`);
  }
  
  // 6. Add order_index to projects if not exists
  const projectInfo = await dbAll(`PRAGMA table_info(projects)`);
  const projectHasOrderIndex = projectInfo.some(col => col.name === 'order_index');
  if (!projectHasOrderIndex) {
    console.log('[Migration 007] Adding order_index to projects...');
    await dbRun(`ALTER TABLE projects ADD COLUMN order_index INTEGER DEFAULT 0`);
  }
  
  console.log('[Migration 007] Done!');
}

export async function down() {
  console.log('[Migration 007] Rolling back...');
  
  // SQLite doesn't support DROP COLUMN easily, so we skip rollback
  // In production, would need to recreate tables without new columns
  
  await dbRun(`DROP TABLE IF EXISTS folders`);
  
  console.log('[Migration 007] Rollback complete');
}

// Run migration if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  up().then(() => {
    console.log('Migration completed');
    process.exit(0);
  }).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
