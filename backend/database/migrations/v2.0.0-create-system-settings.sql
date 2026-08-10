-- Migration: Create system_settings table
-- Version: v2.0.0
-- Date: 2025-11-11
-- Description: Store system-wide configuration (SMTP, settings, etc.)

CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  encrypted BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster key lookups
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);

-- Insert default settings
INSERT OR IGNORE INTO system_settings (key, value, encrypted) VALUES 
('smtp_configured', 'false', 0),
('onboarding_completed', 'false', 0),
('app_name', 'GOD CRM', 0),
('app_version', '0.002.001', 0);
