// system/backupDbController.js — Backup management and DB monitoring

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, badRequest, serverError } from '../../../utils/response.js';
import { adminOrOwner } from './helpers.js';

const execFileAsync = promisify(execFile);

const router = express.Router();

const BACKUP_DIR = '/home/dev2/backups';

// ============================================================
// ADR-039: Backup Management (Owner Only)
// ============================================================

/**
 * GET /api/v3/system/backups
 * List all backups with status
 */
router.get('/backups', adminOrOwner, async (req, res) => {
  try {
    const dailyDir = path.join(BACKUP_DIR, 'daily');
    const weeklyDir = path.join(BACKUP_DIR, 'weekly');

    const backups = [];

    // Read daily backups
    if (fs.existsSync(dailyDir)) {
      const dailyFiles = fs.readdirSync(dailyDir).filter(f => f.endsWith('.sql'));
      for (const file of dailyFiles) {
        const filePath = path.join(dailyDir, file);
        const stats = fs.statSync(filePath);
        backups.push({
          filename: file,
          type: 'daily',
          size_mb: Math.round(stats.size / 1024 / 1024 * 10) / 10,
          created_at: stats.mtime.toISOString(),
          path: filePath
        });
      }
    }

    // Read weekly backups
    if (fs.existsSync(weeklyDir)) {
      const weeklyFiles = fs.readdirSync(weeklyDir).filter(f => f.endsWith('.sql'));
      for (const file of weeklyFiles) {
        const filePath = path.join(weeklyDir, file);
        const stats = fs.statSync(filePath);
        backups.push({
          filename: file,
          type: 'weekly',
          size_mb: Math.round(stats.size / 1024 / 1024 * 10) / 10,
          created_at: stats.mtime.toISOString(),
          path: filePath
        });
      }
    }

    // Sort by date descending
    backups.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Get DB size
    let dbSizeMb = 0;
    try {
      const sizeResult = await dbGet(`
        SELECT pg_database_size(current_database()) / 1024 / 1024 as size_mb
      `);
      dbSizeMb = Math.round(sizeResult?.size_mb || 0);
    } catch {
      dbSizeMb = 0;
    }

    const lastBackup = backups[0] || null;

    return success(res, {
      last_backup: lastBackup,
      db_size_mb: dbSizeMb,
      backups: backups.slice(0, 20), // Last 20 backups
      schedule: {
        daily: '03:00 UTC',
        weekly: 'Sunday 04:00 UTC'
      }
    });
  } catch (error) {
    apiLogger.error({ error }, 'Error fetching backups');
    return serverError(res, error.message);
  }
});

/**
 * POST /api/v3/system/backups/create
 * Create manual backup
 */
router.post('/backups/create', adminOrOwner, async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `godcrm_manual-${timestamp}.sql`;
    const filePath = path.join(BACKUP_DIR, 'daily', filename);

    // Ensure directory exists
    fs.mkdirSync(path.join(BACKUP_DIR, 'daily'), { recursive: true });

    // Run pg_dump — ADR-064: use execFile (no shell interpolation) to prevent injection
    const dbName = process.env.PGDATABASE || 'godcrm';
    const dbUser = process.env.PGUSER || 'godcrm';
    const dbHost = process.env.PGHOST || 'localhost';

    await execFileAsync('pg_dump', [
      '-h', dbHost,
      '-U', dbUser,
      '-d', dbName,
      '--compress=6',
      '-f', filePath
    ], {
      env: { ...process.env, PGPASSWORD: process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD }
    });

    const stats = fs.statSync(filePath);

    apiLogger.info({ userId: req.user.id, filename, sizeMb: Math.round(stats.size / 1024 / 1024 * 10) / 10 }, 'Manual backup created');

    return success(res, {
      filename,
      size_mb: Math.round(stats.size / 1024 / 1024 * 10) / 10,
      created_at: stats.mtime.toISOString(),
      path: filePath
    });
  } catch (error) {
    apiLogger.error({ error }, 'Error creating backup');
    return serverError(res, error.message);
  }
});

/**
 * GET /api/v3/system/backups/:filename/download
 * Download backup file
 */
router.get('/backups/:filename/download', adminOrOwner, async (req, res) => {
  try {
    const { filename } = req.params;

    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return badRequest(res, 'Invalid filename', 'INVALID_FILENAME');
    }

    // Find file in daily or weekly
    let filePath = path.join(BACKUP_DIR, 'daily', filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(BACKUP_DIR, 'weekly', filename);
    }

    if (!fs.existsSync(filePath)) {
      return badRequest(res, 'Backup file not found', 'FILE_NOT_FOUND');
    }

    apiLogger.info({ userId: req.user.id, filename }, 'Backup download requested');

    res.download(filePath, filename);
  } catch (error) {
    apiLogger.error({ error }, 'Error downloading backup');
    return serverError(res, error.message);
  }
});

// ============================================================
// ADR-039: Database Monitoring (Owner Only)
// ============================================================

/**
 * GET /api/v3/system/db/stats
 * Get database statistics and slow queries
 */
router.get('/db/stats', adminOrOwner, async (req, res) => {
  try {
    // Get active connections
    const connections = await dbGet(`
      SELECT count(*) as active_connections
      FROM pg_stat_activity
      WHERE state = 'active'
    `);

    // Get DB size
    const dbSize = await dbGet(`
      SELECT pg_database_size(current_database()) / 1024 / 1024 as size_mb
    `);

    // Get table stats
    const tableStats = await dbAll(`
      SELECT
        schemaname,
        relname as table_name,
        n_live_tup as row_count,
        n_dead_tup as dead_rows,
        last_vacuum,
        last_autovacuum
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC
      LIMIT 10
    `);

    // Try to get slow queries from pg_stat_statements (if enabled)
    let slowQueries = [];
    try {
      slowQueries = await dbAll(`
        SELECT
          query,
          calls,
          mean_exec_time as mean_time_ms,
          total_exec_time as total_time_ms
        FROM pg_stat_statements
        WHERE mean_exec_time > 100
        ORDER BY mean_exec_time DESC
        LIMIT 10
      `);
    } catch {
      // pg_stat_statements not enabled
      slowQueries = [];
    }

    // Get last vacuum time
    const lastVacuum = await dbGet(`
      SELECT max(last_vacuum) as last_vacuum
      FROM pg_stat_user_tables
    `);

    return success(res, {
      database_type: 'postgresql',
      active_connections: connections?.active_connections || 0,
      db_size_mb: Math.round(dbSize?.size_mb || 0),
      table_stats: tableStats,
      slow_queries: slowQueries,
      slow_queries_enabled: slowQueries.length > 0,
      last_vacuum: lastVacuum?.last_vacuum,
      max_connections: 100 // Default PostgreSQL
    });
  } catch (error) {
    apiLogger.error({ error }, 'Error fetching DB stats');
    return serverError(res, error.message);
  }
});

/**
 * POST /api/v3/system/db/vacuum
 * Run VACUUM ANALYZE
 */
router.post('/db/vacuum', adminOrOwner, async (req, res) => {
  try {
    // Run VACUUM ANALYZE
    await dbRun('VACUUM ANALYZE');

    apiLogger.info({ userId: req.user.id }, 'VACUUM ANALYZE executed');

    return success(res, {
      message: 'VACUUM ANALYZE completed successfully',
      executed_at: new Date().toISOString()
    });
  } catch (error) {
    apiLogger.error({ error }, 'Error running VACUUM');
    return serverError(res, error.message);
  }
});

export default router;
