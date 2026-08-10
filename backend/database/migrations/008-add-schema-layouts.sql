-- Migration: Add schema_layouts table for storing node positions
-- Date: 2024-12-19

CREATE TABLE IF NOT EXISTS schema_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL UNIQUE,
  layout TEXT NOT NULL,  -- JSON array of { tableId, x, y }
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schema_layouts_space ON schema_layouts(space_id);
