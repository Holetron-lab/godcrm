-- Migration: 006 - Universal Tables System
-- Version: 0.002.003
-- Date: 2025-11-11
-- Description: Create meta-tables for universal table-driven architecture
--
-- ⚠️ LEGACY — SQLite lineage, SUPERSEDED. DO NOT use to reason about prod (ADR-0156).
-- This is the original SQLite schema (note AUTOINCREMENT, DATETIME DEFAULT
-- CURRENT_TIMESTAMP, BOOLEAN DEFAULT 1) and it creates `crm_table_rows` — a
-- table name that no longer exists. Production runs PostgreSQL with a
-- `table_rows` table whose actual shape differs from both this file and the
-- later knex/007 migration. Retained for historical reference only.
-- Authoritative current-schema description: ADR-0156.

-- Метаинформация о таблицах
CREATE TABLE IF NOT EXISTS crm_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'custom', -- 'system', 'custom'
  icon TEXT,
  color TEXT,
  is_visible BOOLEAN DEFAULT 1,
  config TEXT, -- JSON configuration
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Колонки таблиц
CREATE TABLE IF NOT EXISTS crm_table_columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'text', 'number', 'date', 'email', 'select', 'formula', etc.
  config TEXT, -- JSON: {options: [], format: '', validation: {}}
  formula TEXT, -- Formula expression
  mapping TEXT, -- JSON: {db_table: 'users', db_field: 'email'}
  is_required BOOLEAN DEFAULT 0,
  is_readonly BOOLEAN DEFAULT 0,
  default_value TEXT,
  order_index INTEGER DEFAULT 0,
  width INTEGER DEFAULT 150,
  is_visible BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (table_id) REFERENCES crm_tables(id) ON DELETE CASCADE
);

-- Данные таблиц (универсальное хранилище)
CREATE TABLE IF NOT EXISTS crm_table_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL,
  data TEXT NOT NULL, -- JSON object с данными
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  FOREIGN KEY (table_id) REFERENCES crm_tables(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Подключенные базы данных
CREATE TABLE IF NOT EXISTS crm_table_databases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'mysql', 'postgres', 'sqlite', etc.
  connection_string TEXT NOT NULL, -- encrypted
  is_active BOOLEAN DEFAULT 1,
  last_sync DATETIME,
  config TEXT, -- JSON configuration
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (table_id) REFERENCES crm_tables(id) ON DELETE CASCADE
);

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_tables_user ON crm_tables(user_id);
CREATE INDEX IF NOT EXISTS idx_columns_table ON crm_table_columns(table_id);
CREATE INDEX IF NOT EXISTS idx_rows_table ON crm_table_rows(table_id);
CREATE INDEX IF NOT EXISTS idx_databases_table ON crm_table_databases(table_id);
