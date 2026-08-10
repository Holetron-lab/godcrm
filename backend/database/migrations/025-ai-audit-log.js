/**
 * Migration 025: AI Audit Log Table
 * ADR-071: Security Hardening — Task 7
 *
 * Creates ai_audit_log table for tracking AI agent interactions
 * Used for security auditing, threat detection, and compliance
 */

import { dbRun, isPostgres } from '../connection.js';
import { logger } from '../../utils/logger.js';

export async function runMigration() {
  logger.info('Running Migration 025: AI Audit Log Table...');

  if (isPostgres()) {
    // PostgreSQL version
    await dbRun(`
      CREATE TABLE IF NOT EXISTS ai_audit_log (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        user_id INTEGER REFERENCES users(id),
        agent_id INTEGER,
        agent_name VARCHAR(255),
        conversation_id INTEGER,
        message_type VARCHAR(50),
        content_hash VARCHAR(64),
        token_count INTEGER,
        threat_detected INTEGER DEFAULT 0,
        threat_type VARCHAR(100),
        ip_address VARCHAR(45),
        user_agent TEXT,
        metadata JSONB
      )
    `);
  } else {
    // SQLite version
    await dbRun(`
      CREATE TABLE IF NOT EXISTS ai_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER REFERENCES users(id),
        agent_id INTEGER,
        agent_name TEXT,
        conversation_id INTEGER,
        message_type TEXT,
        content_hash TEXT,
        token_count INTEGER,
        threat_detected INTEGER DEFAULT 0,
        threat_type TEXT,
        ip_address TEXT,
        user_agent TEXT,
        metadata TEXT
      )
    `);
  }
  logger.info('  Created table: ai_audit_log');

  // Create indexes for performance
  await dbRun('CREATE INDEX IF NOT EXISTS idx_ai_audit_user ON ai_audit_log(user_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_ai_audit_agent ON ai_audit_log(agent_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_ai_audit_timestamp ON ai_audit_log(timestamp)');

  if (isPostgres()) {
    // Partial index for threats (PostgreSQL)
    await dbRun('CREATE INDEX IF NOT EXISTS idx_ai_audit_threat ON ai_audit_log(threat_detected) WHERE threat_detected = 1');
  } else {
    // Regular index for SQLite
    await dbRun('CREATE INDEX IF NOT EXISTS idx_ai_audit_threat ON ai_audit_log(threat_detected)');
  }
  logger.info('  Created indexes');

  logger.info('Migration 025 completed successfully!');
}

export default { runMigration };
