-- Seed data for GOD CRM v0.003.000

-- 1. Create dev user (password: DevPass2024!)
INSERT INTO users (id, email, password_hash, name, role, encryption_key_encrypted, created_at, updated_at)
VALUES (
  1,
  'dev@crm.local',
  '$2b$10$8K1p/a0dL.6NkAXZb9TjAehs.S0bUQBYN9H.rXvnFXGOXhOvuJ8I6',
  'Dev User',
  'admin',
  'encrypted_key_placeholder',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- 2. Create Personal Space
INSERT INTO spaces (id, owner_id, name, description, icon, type, theme_primary, theme_secondary, theme_tertiary, created_at, updated_at)
VALUES (
  1,
  1,
  'Personal Space',
  'My personal workspace',
  '👤',
  'personal',
  '#0ea5e9',
  '#8b5cf6',
  '#10b981',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- 3. Create Admin Space
INSERT INTO spaces (id, owner_id, name, description, icon, type, theme_primary, theme_secondary, theme_tertiary, created_at, updated_at)
VALUES (
  2,
  1,
  'Admin Space',
  'Administrator workspace',
  '⚙️',
  'admin',
  '#dc2626',
  '#7c2d12',
  '#15803d',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- 4. Create Projects
INSERT INTO projects (id, space_id, name, description, icon, settings, created_at, updated_at)
VALUES 
  (1, 1, 'My Tasks', 'Personal task management', '✅', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (2, 1, 'Notes', 'Personal notes and ideas', '📝', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (3, 2, 'System Config', 'System configuration', '⚙️', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 5. Create Tables
INSERT INTO tables (id, project_id, name, description, icon, is_primary, created_at, updated_at)
VALUES 
  (8, 1, 'My Tasks Data', 'Task list table', '📋', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9, 2, 'Notes Data', 'Notes table', '📝', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 6. Create Columns for table 8 (My Tasks Data)
INSERT INTO columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, created_at, updated_at)
VALUES 
  (8, 'task_name', 'Task', 'text', '{}', 0, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (8, 'status', 'Status', 'select', '{"options":["Todo","In Progress","Done"]}', 1, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (8, 'priority', 'Priority', 'select', '{"options":["Low","Medium","High"]}', 2, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (8, 'due_date', 'Due Date', 'date', '{}', 3, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (8, 'assignee', 'Assignee', 'text', '{}', 4, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 7. Create Columns for table 9 (Notes Data)
INSERT INTO columns (table_id, column_name, display_name, type, config, order_index, is_visible, is_required, created_at, updated_at)
VALUES 
  (9, 'title', 'Title', 'text', '{}', 0, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9, 'content', 'Content', 'text', '{}', 1, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9, 'tags', 'Tags', 'multiselect', '{"options":["work","personal","ideas"]}', 2, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 8. Create Dashboards
INSERT INTO dashboards (id, space_id, name, icon, is_default, order_index, created_at, updated_at)
VALUES 
  (1, 1, 'Home', '🏠', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (2, 2, 'Admin Dashboard', '⚙️', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 9. Create Sample Rows for table 8
INSERT INTO rows (table_id, base_id, data, created_by, created_at, updated_at)
VALUES 
  (8, 'row-1', '{"task_name":"Test the new table UI","status":"In Progress","priority":"High","due_date":"2025-11-20","assignee":"Dev User"}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (8, 'row-2', '{"task_name":"Add emoji headers","status":"Done","priority":"High","due_date":"2025-11-15","assignee":"Dev User"}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (8, 'row-3', '{"task_name":"Implement column settings modal","status":"Todo","priority":"Medium","due_date":"2025-11-18","assignee":"Dev User"}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
