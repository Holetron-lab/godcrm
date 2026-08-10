import express from 'express';
import { dbRun, dbGet, dbAll } from '../../database/connection.js';
import { isPostgres } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, badRequest, serverError } from '../../utils/response.js';
import { authenticate } from '../../middleware/auth.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * POST /api/v3/device-logs
 * Receive BLE debug logs from mobile app.
 * Inserts individual log entries into device_logs table.
 *
 * Body: { device, stats, entries: [{timestamp, level, category, message, data}], uploaded_at }
 */
router.post('/', async (req, res) => {
  try {
    const { device, stats, entries, uploaded_at, session_id: reqSessionId } = req.body;
    const userId = req.user?.id;

    if (!device) {
      return badRequest(res, 'device is required');
    }

    await _ensureTable();

    const sessionId = reqSessionId || crypto.randomUUID();
    const appVersion = stats?.app_version || 'unknown';
    const bleState = stats?.connection_state || 'unknown';
    const logEntries = (entries || []).slice(-200); // Keep last 200 entries max

    let insertedCount = 0;

    // Insert individual log entries
    for (const entry of logEntries) {
      try {
        const metadata = {
          ...(entry.data || {}),
          rssi: stats?.rssi,
          battery: stats?.battery,
          mtu: stats?.mtu,
          device_name: stats?.device_name,
          device_id: stats?.device_id,
          user_id: userId,
        };

        const now = isPostgres() ? 'NOW()' : "datetime('now')";
        const eventTs = entry.timestamp || new Date().toISOString();

        await dbRun(
          `INSERT INTO device_logs (device, session_id, app_version, ble_state, level, category, message, event_ts, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${isPostgres() ? '?::jsonb' : '?'}, ${now})`,
          [
            device,
            sessionId,
            appVersion,
            bleState,
            entry.level || 'info',
            entry.category || 'BLE',
            entry.message || '',
            eventTs,
            JSON.stringify(metadata),
          ]
        );
        insertedCount++;
      } catch (entryErr) {
        apiLogger.warn({ err: entryErr, entry }, 'Failed to insert single log entry');
      }
    }

    // Also insert a summary entry with full stats
    if (stats) {
      try {
        const now = isPostgres() ? 'NOW()' : "datetime('now')";
        await dbRun(
          `INSERT INTO device_logs (device, session_id, app_version, ble_state, level, category, message, event_ts, metadata, created_at)
           VALUES (?, ?, ?, ?, 'INF', 'UPLOAD', ?, ${now}, ${isPostgres() ? '?::jsonb' : '?'}, ${now})`,
          [
            device,
            sessionId,
            appVersion,
            bleState,
            `Upload: ${insertedCount} entries from ${appVersion}`,
            JSON.stringify({
              ...stats,
              user_id: userId,
              uploaded_at: uploaded_at || new Date().toISOString(),
              entry_count: insertedCount,
            }),
          ]
        );
      } catch (summaryErr) {
        apiLogger.warn({ err: summaryErr }, 'Failed to insert upload summary');
      }
    }

    apiLogger.info({ userId, device, entryCount: insertedCount, sessionId },
      'Device logs received');

    return success(res, {
      session_id: sessionId,
      device,
      entry_count: insertedCount,
      message: 'Logs stored successfully',
    }, 'Logs received', 201);
  } catch (err) {
    apiLogger.error({ err }, 'POST /device-logs error');
    return serverError(res, err.message);
  }
});

/**
 * GET /api/v3/device-logs
 * Retrieve stored device logs.
 * Query params: device, session_id, level, category, limit (default 100), offset (default 0)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { device, session_id, level, category, limit = 100, offset = 0 } = req.query;

    await _ensureTable();

    let query = `SELECT id, device, session_id, app_version, ble_state, level, category, message, event_ts, metadata, created_at
                 FROM device_logs WHERE 1=1`;
    const params = [];

    if (device) {
      query += ` AND device = ?`;
      params.push(device);
    }

    if (session_id) {
      query += ` AND session_id = ?`;
      params.push(session_id);
    }

    if (level) {
      query += ` AND level = ?`;
      params.push(level.toUpperCase());
    }

    if (category) {
      query += ` AND category = ?`;
      params.push(category.toUpperCase());
    }

    query += ` ORDER BY event_ts DESC, id DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const rows = await dbAll(query, params);

    // Parse metadata JSON if needed
    const logs = rows.map(row => ({
      id: row.id,
      device: row.device,
      session_id: row.session_id,
      app_version: row.app_version,
      ble_state: row.ble_state,
      level: row.level,
      category: row.category,
      message: row.message,
      event_ts: row.event_ts,
      metadata: _safeJsonParse(row.metadata),
      created_at: row.created_at,
    }));

    // Count total entries
    let countQuery = `SELECT COUNT(*) as total FROM device_logs WHERE 1=1`;
    const countParams = [];
    if (device) {
      countQuery += ` AND device = ?`;
      countParams.push(device);
    }
    if (session_id) {
      countQuery += ` AND session_id = ?`;
      countParams.push(session_id);
    }
    const countRow = await dbGet(countQuery, countParams);

    return success(res, { logs, total: countRow?.total || logs.length });
  } catch (err) {
    apiLogger.error({ err }, 'GET /device-logs error');
    return serverError(res, err.message);
  }
});

/**
 * GET /api/v3/device-logs/latest
 * Get the latest log session for a device.
 */
router.get('/latest', authenticate, async (req, res) => {
  try {
    const { device = 'frame' } = req.query;

    await _ensureTable();

    // Get latest session
    const latestSession = await dbGet(
      `SELECT DISTINCT session_id, app_version, ble_state, MAX(created_at) as last_upload
       FROM device_logs
       WHERE device = ? AND session_id IS NOT NULL
       GROUP BY session_id, app_version, ble_state
       ORDER BY last_upload DESC LIMIT 1`,
      [device]
    );

    if (!latestSession) {
      return success(res, { log: null, entries: [], message: 'No logs found' });
    }

    // Get all entries from latest session
    const entries = await dbAll(
      `SELECT id, level, category, message, event_ts, metadata
       FROM device_logs
       WHERE device = ? AND session_id = ?
       ORDER BY event_ts ASC`,
      [device, latestSession.session_id]
    );

    const parsedEntries = entries.map(e => ({
      ...e,
      metadata: _safeJsonParse(e.metadata),
    }));

    // Extract stats from the UPLOAD summary entry
    const uploadEntry = parsedEntries.find(e => e.category === 'UPLOAD');
    const stats = uploadEntry?.metadata || {};

    return success(res, {
      session_id: latestSession.session_id,
      app_version: latestSession.app_version,
      ble_state: latestSession.ble_state,
      last_upload: latestSession.last_upload,
      stats,
      entries: parsedEntries.filter(e => e.category !== 'UPLOAD'),
      entry_count: parsedEntries.length,
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /device-logs/latest error');
    return serverError(res, err.message);
  }
});

/**
 * GET /api/v3/device-logs/sessions
 * List all debug sessions for a device.
 */
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const { device = 'frame', limit = 20 } = req.query;

    await _ensureTable();

    const sessions = await dbAll(
      `SELECT session_id, app_version, ble_state,
              COUNT(*) as entry_count,
              MIN(event_ts) as first_event,
              MAX(event_ts) as last_event,
              MAX(created_at) as uploaded_at,
              COUNT(CASE WHEN level = 'ERR' THEN 1 END) as error_count,
              COUNT(CASE WHEN level = 'WRN' THEN 1 END) as warning_count
       FROM device_logs
       WHERE device = ? AND session_id IS NOT NULL
       GROUP BY session_id, app_version, ble_state
       ORDER BY uploaded_at DESC
       LIMIT ?`,
      [device, parseInt(limit)]
    );

    return success(res, { sessions });
  } catch (err) {
    apiLogger.error({ err }, 'GET /device-logs/sessions error');
    return serverError(res, err.message);
  }
});

/**
 * DELETE /api/v3/device-logs/:id
 * Delete a specific log entry.
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    await dbRun(`DELETE FROM device_logs WHERE id = ?`, [id]);

    return success(res, { deleted: true });
  } catch (err) {
    apiLogger.error({ err }, 'DELETE /device-logs error');
    return serverError(res, err.message);
  }
});

/**
 * DELETE /api/v3/device-logs/session/:sessionId
 * Delete all entries for a session.
 */
router.delete('/session/:sessionId', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await dbRun(
      `DELETE FROM device_logs WHERE session_id = ?`,
      [sessionId]
    );

    return success(res, { deleted: true, count: result?.changes || 0 });
  } catch (err) {
    apiLogger.error({ err }, 'DELETE /device-logs/session error');
    return serverError(res, err.message);
  }
});

// ─── Helpers ────────────────────────────────────────────────

let _tableCreated = false;

async function _ensureTable() {
  if (_tableCreated) return;
  try {
    if (isPostgres()) {
      await dbRun(`
        CREATE TABLE IF NOT EXISTS device_logs (
          id SERIAL PRIMARY KEY,
          device VARCHAR(64) NOT NULL DEFAULT 'frame',
          session_id VARCHAR(128),
          app_version VARCHAR(32),
          ble_state VARCHAR(32),
          level VARCHAR(8),
          category VARCHAR(32),
          message TEXT,
          event_ts TIMESTAMPTZ,
          metadata JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_device_logs_device ON device_logs (device)`);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_device_logs_session ON device_logs (session_id)`);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_device_logs_created_at ON device_logs (created_at DESC)`);
    } else {
      await dbRun(`
        CREATE TABLE IF NOT EXISTS device_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device TEXT NOT NULL DEFAULT 'frame',
          session_id TEXT,
          app_version TEXT,
          ble_state TEXT,
          level TEXT,
          category TEXT,
          message TEXT,
          event_ts TEXT,
          metadata TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_device_logs_device ON device_logs (device)`);
      await dbRun(`CREATE INDEX IF NOT EXISTS idx_device_logs_session ON device_logs (session_id)`);
    }
    _tableCreated = true;
  } catch (e) {
    // Table might already exist, that's fine
    _tableCreated = true;
  }
}

function _safeJsonParse(str) {
  if (!str) return {};
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}

export default router;
