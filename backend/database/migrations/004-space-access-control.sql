-- Migration: Add access_control to spaces
-- Date: 2024-12-07
-- Description: Add access_control column for role-based permissions at space level

-- Add access_control column to spaces table
ALTER TABLE spaces ADD COLUMN access_control TEXT DEFAULT NULL;

-- access_control structure (JSON):
-- {
--   "enabled": true,
--   "mode": "roles",
--   "usersTableId": 123,
--   "userIdColumn": "id",
--   "userNameColumn": "name",
--   "roleColumn": "role",
--   "roleMapping": {
--     "owner": ["owner", "creator"],
--     "admin": ["admin", "administrator"],
--     "editor": ["editor", "manager"],
--     "viewer": ["viewer", "user"],
--     "denied": ["blocked", "banned"]
--   }
-- }
