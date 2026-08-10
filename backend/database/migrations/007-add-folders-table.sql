-- Migration: Add folders table for organizing items within projects
-- Date: 2024-12-18
-- Purpose: Support folder hierarchy for organizing tables, widgets, dashboards
-- Based on ADR-004: Space Manager XL Modal

-- Create folders table (папки только внутри проектов)
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  parent_folder_id INTEGER NULL,  -- NULL = root folder
  name VARCHAR(255) NOT NULL,
  icon VARCHAR(10) DEFAULT '📁',
  color VARCHAR(20) NULL,
  order_index INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

-- Ensure unique folder names within same parent
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_unique_name 
  ON folders(project_id, COALESCE(parent_folder_id, 0), name);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_folders_project_id ON folders(project_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_folder_id);

-- Add order_index to universal_tables if not exists (for reordering)
-- ALTER TABLE universal_tables ADD COLUMN folder_id INTEGER NULL REFERENCES folders(id) ON DELETE SET NULL;
-- ALTER TABLE universal_tables ADD COLUMN order_index INTEGER DEFAULT 0;

-- Add order_index to widgets if not exists (for reordering)
-- ALTER TABLE widgets ADD COLUMN folder_id INTEGER NULL REFERENCES folders(id) ON DELETE SET NULL;

-- Note: SQLite doesn't support ADD COLUMN with REFERENCES constraint in ALTER TABLE
-- These will be handled by the migration script
