/**
 * Migration 016: Rename labs_projects to labs
 * ADR-043: MindWorkflow Integration - terminology fix
 */
import { config } from '../../config.js';
import { dbRun, dbGet, isPostgres } from '../connection.js';

export async function runMigration(db) {
  console.log('📦 Running Migration 016: Rename labs_projects to labs...');
  
  try {
    if (isPostgres()) {
      // PostgreSQL - check if already migrated
      const labsExists = await dbGet("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'labs'");
      if (labsExists) {
        console.log('  ⚠️  Table labs already exists, skipping migration');
        return;
      }
      
      // PostgreSQL - rename table and columns
      console.log('  🔄 Renaming labs_projects to labs...');
      await dbRun('ALTER TABLE IF EXISTS labs_projects RENAME TO labs');
      
      console.log('  🔄 Renaming project_id to lab_id in labs table...');
      await dbRun('ALTER TABLE IF EXISTS labs RENAME COLUMN project_id TO lab_id');
      
      console.log('  🔄 Updating foreign key references in labs_nodes...');
      await dbRun('ALTER TABLE IF EXISTS labs_nodes RENAME COLUMN project_id TO lab_id');
      
      console.log('  🔄 Updating foreign key references in labs_edges...');
      await dbRun('ALTER TABLE IF EXISTS labs_edges RENAME COLUMN project_id TO lab_id');
    } else {
      // SQLite - need to recreate tables
      // Check if already migrated
      const labsExists = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='labs'");
      if (labsExists) {
        console.log('  ⚠️  Table labs already exists, skipping migration');
        return;
      }
      
      // Create new labs table
      await dbRun(`
        CREATE TABLE IF NOT EXISTS labs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          space_id INTEGER,
          lab_id VARCHAR(255) UNIQUE NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          settings TEXT DEFAULT '{}',
          ai_default_provider_id INTEGER,
          ai_default_agent_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Copy data from labs_projects if exists
      const oldTableExists = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='labs_projects'");
      if (oldTableExists) {
        await dbRun(`
          INSERT INTO labs (id, space_id, lab_id, title, description, settings, created_at, updated_at)
          SELECT id, space_id, project_id, title, description, settings, created_at, updated_at
          FROM labs_projects
        `);
        await dbRun('DROP TABLE labs_projects');
      }
      
      // Update labs_nodes - add lab_id column
      const nodesHasLabId = await dbGet("SELECT * FROM pragma_table_info('labs_nodes') WHERE name='lab_id'");
      if (!nodesHasLabId) {
        await dbRun('ALTER TABLE labs_nodes ADD COLUMN lab_id VARCHAR(255)');
        await dbRun('UPDATE labs_nodes SET lab_id = project_id WHERE lab_id IS NULL');
      }
      
      // Update labs_edges - add lab_id column  
      const edgesHasLabId = await dbGet("SELECT * FROM pragma_table_info('labs_edges') WHERE name='lab_id'");
      if (!edgesHasLabId) {
        await dbRun('ALTER TABLE labs_edges ADD COLUMN lab_id VARCHAR(255)');
        await dbRun('UPDATE labs_edges SET lab_id = project_id WHERE lab_id IS NULL');
      }
      
      // Create indexes
      await dbRun('CREATE INDEX IF NOT EXISTS idx_labs_space ON labs(space_id)');
      await dbRun('CREATE INDEX IF NOT EXISTS idx_labs_lab_id ON labs(lab_id)');
    }
    
    console.log('✅ Migration 016 completed successfully!');
  } catch (error) {
    console.error('❌ Migration 016 failed:', error);
    throw error;
  }
}