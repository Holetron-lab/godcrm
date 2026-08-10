-- Seed: 003 - Default System Tables
-- Version: 0.002.003
-- Date: 2025-11-11
-- Description: Create default system tables (Users, Projects, Accounts)

-- Таблица Users (маппинг на существующую таблицу users)
INSERT INTO crm_tables (user_id, name, display_name, type, icon, color) 
VALUES (1, 'users', 'Users', 'system', '👥', '#2196F3');

INSERT INTO crm_table_columns (table_id, name, display_name, type, mapping, order_index) VALUES
(1, 'id', 'ID', 'number', '{"db_table":"users","db_field":"id"}', 0),
(1, 'name', 'Name', 'text', '{"db_table":"users","db_field":"name"}', 1),
(1, 'email', 'Email', 'email', '{"db_table":"users","db_field":"email"}', 2),
(1, 'role', 'Role', 'select', '{"db_table":"users","db_field":"role","options":["admin","user","viewer"]}', 3),
(1, 'created_at', 'Created', 'date', '{"db_table":"users","db_field":"created_at"}', 4);

-- Таблица Projects (маппинг на существующую таблицу projects)
INSERT INTO crm_tables (user_id, name, display_name, type, icon, color) 
VALUES (1, 'projects', 'Projects', 'system', '📁', '#4CAF50');

INSERT INTO crm_table_columns (table_id, name, display_name, type, mapping, order_index) VALUES
(2, 'id', 'ID', 'number', '{"db_table":"projects","db_field":"id"}', 0),
(2, 'name', 'Project Name', 'text', '{"db_table":"projects","db_field":"name"}', 1),
(2, 'description', 'Description', 'text', '{"db_table":"projects","db_field":"description"}', 2),
(2, 'status', 'Status', 'select', '{"db_table":"projects","db_field":"status","options":["active","completed","archived","on_hold"]}', 3),
(2, 'owner', 'Owner', 'text', '{"db_table":"projects","db_field":"owner_id"}', 4),
(2, 'created_at', 'Created', 'date', '{"db_table":"projects","db_field":"created_at"}', 5),
(2, 'updated_at', 'Updated', 'date', '{"db_table":"projects","db_field":"updated_at"}', 6);

-- Таблица Accounts (для owner view всех аккаунтов)
INSERT INTO crm_tables (user_id, name, display_name, type, icon, color) 
VALUES (1, 'accounts', 'Accounts', 'system', '🔐', '#FF9800');

INSERT INTO crm_table_columns (table_id, name, display_name, type, mapping, order_index) VALUES
(3, 'id', 'ID', 'number', '{"db_table":"users","db_field":"id"}', 0),
(3, 'email', 'Email', 'email', '{"db_table":"users","db_field":"email"}', 1),
(3, 'name', 'Name', 'text', '{"db_table":"users","db_field":"name"}', 2),
(3, 'role', 'Role', 'select', '{"db_table":"users","db_field":"role"}', 3),
(3, 'is_active', 'Active', 'checkbox', '{"db_table":"users","db_field":"is_active"}', 4),
(3, 'last_login', 'Last Login', 'date', '{"db_table":"users","db_field":"last_login"}', 5);
