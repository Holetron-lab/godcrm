/**
 * monitoring/init.js
 * Database table initialization for MonitoringService
 */

import { dbRun } from '../../database/connection.js';
import { aiLogger } from '../../utils/logger.js';
import { SQL } from './db-helpers.js';

/**
 * Initialize monitoring tables in the database
 */
export async function initMonitoringTables() {
  try {
    // Runs table - stores all AI operations
    await dbRun(`
      CREATE TABLE IF NOT EXISTS monitoring_runs (
        id TEXT PRIMARY KEY,
        parent_run_id TEXT,
        type TEXT NOT NULL,
        name TEXT,
        status TEXT DEFAULT 'running',
        input TEXT,
        output TEXT,
        error TEXT,
        tokens_prompt INTEGER DEFAULT 0,
        tokens_completion INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        model TEXT,
        provider TEXT,
        user_id TEXT,
        user_props TEXT,
        tags TEXT,
        metadata TEXT,
        params TEXT,
        template_id TEXT,
        runtime TEXT,
        created_at ${SQL.datetime} DEFAULT CURRENT_TIMESTAMP,
        ended_at ${SQL.datetime},
        FOREIGN KEY (parent_run_id) REFERENCES monitoring_runs(id)
      )
    `);

    // Events table - raw events from SDK (no foreign key for flexibility)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS monitoring_events (
        id ${SQL.autoIncrement},
        run_id TEXT,
        event_type TEXT NOT NULL,
        event_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT,
        created_at ${SQL.datetime} DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Feedback table (no foreign key for flexibility)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS monitoring_feedback (
        id ${SQL.autoIncrement},
        run_id TEXT NOT NULL,
        score REAL,
        thumbs TEXT,
        comment TEXT,
        data TEXT,
        created_at ${SQL.datetime} DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Threads table - conversation grouping
    await dbRun(`
      CREATE TABLE IF NOT EXISTS monitoring_threads (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        tags TEXT,
        metadata TEXT,
        created_at ${SQL.datetime} DEFAULT CURRENT_TIMESTAMP,
        updated_at ${SQL.datetime} DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for performance
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_runs_type ON monitoring_runs(type)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_runs_user ON monitoring_runs(user_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_runs_created ON monitoring_runs(created_at)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_runs_parent ON monitoring_runs(parent_run_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_events_run ON monitoring_events(run_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_feedback_run ON monitoring_feedback(run_id)`);

    aiLogger.info('Monitoring tables initialized');
    return true;
  } catch (error) {
    aiLogger.error({ err: error }, 'Failed to initialize monitoring tables');
    return false;
  }
}
