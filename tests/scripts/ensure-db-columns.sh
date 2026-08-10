#!/bin/bash
# Ensure all required database columns exist
# Run this before running master.scenario.js if tests fail with "no such column" errors

DB_PATH="${1:-/var/lib/business-crm-data/crm.db}"

echo "🔧 Ensuring database columns in: $DB_PATH"

# universal_tables columns
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN data_source_id INTEGER DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN source_table_name TEXT DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN sync_enabled INTEGER DEFAULT 0;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN source_id_column TEXT DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN parent_table_id INTEGER DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN show_in_nav INTEGER DEFAULT 1;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN display_name TEXT DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN folder_path TEXT DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN table_type TEXT DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN base_id TEXT DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN created_by INTEGER DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN sync_interval_minutes INTEGER DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN last_sync_at DATETIME DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE universal_tables ADD COLUMN folder_id INTEGER DEFAULT NULL;" 2>/dev/null || true

# table_columns columns
sqlite3 "$DB_PATH" "ALTER TABLE table_columns ADD COLUMN is_readonly INTEGER DEFAULT 0;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE table_columns ADD COLUMN width INTEGER DEFAULT NULL;" 2>/dev/null || true
sqlite3 "$DB_PATH" "ALTER TABLE table_columns ADD COLUMN mapping TEXT DEFAULT NULL;" 2>/dev/null || true

# widgets columns
sqlite3 "$DB_PATH" "ALTER TABLE widgets ADD COLUMN folder_id INTEGER DEFAULT NULL;" 2>/dev/null || true

echo "✅ Database columns ensured"

# Show column counts
echo ""
echo "📊 Column counts:"
echo "  universal_tables: $(sqlite3 "$DB_PATH" "PRAGMA table_info(universal_tables)" | wc -l) columns"
echo "  table_columns: $(sqlite3 "$DB_PATH" "PRAGMA table_info(table_columns)" | wc -l) columns"
echo "  widgets: $(sqlite3 "$DB_PATH" "PRAGMA table_info(widgets)" | wc -l) columns"
