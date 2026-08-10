-- Migration 026: Terminal Sessions + Command Approval (ADR-076)
-- Direct shell execution with command risk classification
-- Created: 2026-02-06

-- ============================================================
-- Terminal Sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS terminal_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(200) DEFAULT 'Terminal',
  cwd VARCHAR(500) DEFAULT '/root/production/business-crm',
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_terminal_sessions_user
ON terminal_sessions(user_id, status);

-- ============================================================
-- Terminal Commands (with approval flow)
-- ============================================================

CREATE TABLE IF NOT EXISTS terminal_commands (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  output TEXT,
  exit_code INTEGER,
  risk_level VARCHAR(20) DEFAULT 'safe',
  approval_status VARCHAR(20) DEFAULT 'auto',
  approved_by INTEGER REFERENCES users(id),
  source VARCHAR(20) DEFAULT 'user',
  agent_name VARCHAR(100),
  execution_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_terminal_commands_session
ON terminal_commands(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_terminal_commands_approval
ON terminal_commands(approval_status) WHERE approval_status = 'pending';
