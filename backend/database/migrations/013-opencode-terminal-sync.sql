-- Migration 013: OpenCode Terminal Sync (ADR-024)
-- Add fields for syncing OpenCode sessions to conversations/messages
-- Created: 2026-01-23

-- ============================================================
-- Extend conversations table for external sync
-- ============================================================

-- External source identifier (opencode, copilot, cursor, etc.)
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS external_source VARCHAR(50);

-- External session/conversation ID
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);

-- External project identifier (opencode project hash)
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS external_project_id VARCHAR(100);

-- Last sync timestamp
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP;

-- Index for sync queries
CREATE INDEX IF NOT EXISTS idx_conversations_external 
ON conversations(external_source, external_id);

-- ============================================================
-- Extend messages table for external sync
-- ============================================================

-- External message ID
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS external_id VARCHAR(100);

-- Model used for generation
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS model_used VARCHAR(100);

-- Token counts for cost tracking
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS tokens_input INTEGER DEFAULT 0;

ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS tokens_output INTEGER DEFAULT 0;

-- Estimated cost in USD
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS cost_usd DECIMAL(10, 6) DEFAULT 0;

-- When synced from external source
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP;

-- Index for external ID lookups
CREATE INDEX IF NOT EXISTS idx_messages_external 
ON messages(external_id) WHERE external_id IS NOT NULL;

-- ============================================================
-- Terminal audit log table (optional - for detailed tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS terminal_audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  session_id VARCHAR(100),
  command_preview TEXT,
  model VARCHAR(100),
  agent VARCHAR(50),
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_terminal_audit_user 
ON terminal_audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_terminal_audit_session 
ON terminal_audit_log(session_id);
