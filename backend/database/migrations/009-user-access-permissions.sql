-- Migration: User Access Permissions System
-- Date: 2024-12-21
-- Description: Add user_access_permissions table for hierarchical access control
-- Levels: owner_owner (creator) > owner > admin > editor > viewer > denied

-- User Access Permissions Table
-- Stores granular access permissions for users at different levels (space, project, table, column)
CREATE TABLE IF NOT EXISTS user_access_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- User being granted access
  user_id INTEGER NOT NULL,
  
  -- Target entity (what the permission applies to)
  -- Only one of these should be set per row (NULL for others)
  space_id INTEGER DEFAULT NULL,
  project_id INTEGER DEFAULT NULL,
  table_id INTEGER DEFAULT NULL,
  column_id INTEGER DEFAULT NULL,
  
  -- Access level: owner_owner, owner, admin, editor, viewer, denied
  access_level TEXT NOT NULL DEFAULT 'viewer',
  
  -- Who granted this permission
  granted_by INTEGER,
  
  -- When was this permission created/modified
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (space_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (table_id) REFERENCES table_columns(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
  
  -- Ensure only one access level per user per entity
  UNIQUE(user_id, space_id, project_id, table_id, column_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_access_user_id ON user_access_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_access_space_id ON user_access_permissions(space_id);
CREATE INDEX IF NOT EXISTS idx_user_access_project_id ON user_access_permissions(project_id);
CREATE INDEX IF NOT EXISTS idx_user_access_table_id ON user_access_permissions(table_id);
CREATE INDEX IF NOT EXISTS idx_user_access_column_id ON user_access_permissions(column_id);
CREATE INDEX IF NOT EXISTS idx_user_access_level ON user_access_permissions(access_level);

-- Add is_owner_owner column to spaces/projects to track the original creator
-- who cannot be demoted by owners
ALTER TABLE projects ADD COLUMN owner_owner_id INTEGER REFERENCES users(id);

-- Access Level Hierarchy (for reference):
-- 1. owner_owner - Creator of space, cannot be demoted, has all permissions
-- 2. owner - Can assign/remove anyone except owner_owner, full management
-- 3. admin - Can edit, can open column settings in UniversalTable
-- 4. editor - Can modify data in UniversalTable
-- 5. viewer - Read-only access
-- 6. denied - User cannot see this entity at all

-- Permission Inheritance:
-- If no specific permission is set, inherit from parent:
-- column inherits from table
-- table inherits from project  
-- project inherits from space
-- space uses owner_id as owner_owner by default
