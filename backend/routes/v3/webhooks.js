/**
 * @swagger
 * components:
 *   schemas:
 *     Webhook:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         project_id:
 *           type: integer
 *         table_id:
 *           type: integer
 *         endpoint_url:
 *           type: string
 *         secret:
 *           type: string
 *         is_active:
 *           type: boolean
 */
import express from 'express';
import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import { authenticate } from '../../middleware/auth.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, notFound, badRequest, error } from '../../utils/response.js';
import { hashToken } from '../../services/tokens/tokenHash.js';

const router = express.Router();

// ADR-0069 P2 observability: counts every time the incoming-webhook resolver
// had to fall back from prefix+hash lookup to the legacy plaintext token
// column. Must read zero across a 7-day window before P3 drops the plaintext
// column. Exported for tests / ops surfaces.
let tokenPlaintextLookupHits = 0;
export function getTokenPlaintextLookupHits() {
  return tokenPlaintextLookupHits;
}
export function _resetTokenPlaintextLookupHits() {
  tokenPlaintextLookupHits = 0;
}

// ============================================================================
// GET /api/v3/projects/:projectId/webhooks - List all webhooks for a project
// ============================================================================
/**
 * @swagger
 * /api/v3/projects/{projectId}/webhooks:
 *   get:
 *     summary: List all webhooks for a project
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of webhooks
 */
router.get('/projects/:projectId/webhooks', authenticate, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    
    // Verify project access
    const project = await dbGet(`
      SELECT p.* FROM projects p
      JOIN spaces s ON p.space_id = s.id
      WHERE p.id = ? AND (s.owner_id = ? OR s.type = 'personal')
    `, [projectId, userId]);
    
    if (!project) {
      return notFound(res, 'Project not found');
    }
    
    const webhooks = await dbAll(`
      SELECT w.*, t.name as table_name, t.name as table_display_name
      FROM webhooks w
      LEFT JOIN universal_tables t ON w.table_id = t.id
      WHERE w.project_id = ?
      ORDER BY w.created_at DESC
    `, [projectId]);
    
    // Get recent logs for each webhook
    const webhooksWithLogs = await Promise.all(webhooks.map(async webhook => {
      const recentLogs = await dbAll(`
        SELECT * FROM webhook_logs
        WHERE webhook_id = ?
        ORDER BY created_at DESC
        LIMIT 5
      `, [webhook.id]);
      
      const totalCalls = await dbGet(`
        SELECT COUNT(*) as count FROM webhook_logs WHERE webhook_id = ?
      `, [webhook.id]);
      
      const lastCall = await dbGet(`
        SELECT created_at FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 1
      `, [webhook.id]);
      
      return {
        ...webhook,
        recentLogs,
        totalCalls: totalCalls?.count || 0,
        lastTriggered: lastCall?.created_at || null
      };
    }));
    
    success(res, webhooksWithLogs);
  } catch (err) {
    apiLogger.error('Error fetching webhooks:', err);
    error(res, 'FETCH_ERROR', err.message, 500);
  }
});

// ============================================================================
// POST /api/v3/projects/:projectId/webhooks - Create a new webhook
// ============================================================================
/**
 * @swagger
 * /api/v3/projects/{projectId}/webhooks:
 *   post:
 *     summary: Create a new webhook
 *     tags: [Webhooks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               tableId:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Webhook created
 */
router.post('/projects/:projectId/webhooks', authenticate, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { name, tableId, createNewTable, newTableName } = req.body;
    const userId = req.user.id;
    
    // Verify project access
    const project = await dbGet(`
      SELECT p.*, s.id as space_id FROM projects p
      JOIN spaces s ON p.space_id = s.id
      WHERE p.id = ? AND (s.owner_id = ? OR s.type = 'personal')
    `, [projectId, userId]);
    
    if (!project) {
      return notFound(res, 'Project');
    }
    
    let targetTableId = tableId;
    
    // Create new table if requested
    if (createNewTable) {
      const tableName = newTableName || `webhook_${Date.now()}`;
      const result = await dbRun(`
        INSERT INTO universal_tables (project_id, name, description)
        VALUES (?, ?, ?)
      `, [projectId, tableName.toLowerCase().replace(/\s+/g, '_'), `Webhook data table for ${name}`]);
      
      targetTableId = result.lastInsertRowid;
      
      // Create default columns for webhook logs
      const defaultColumns = [
        { name: 'received_at', displayName: 'Received At', type: 'datetime' },
        { name: 'source_ip', displayName: 'Source IP', type: 'text' },
        { name: 'raw_payload', displayName: 'Raw Payload', type: 'longtext' }
      ];
      
      for (let i = 0; i < defaultColumns.length; i++) {
        const col = defaultColumns[i];
        await dbRun(`
          INSERT INTO table_columns (table_id, column_name, display_name, type, order_index)
          VALUES (?, ?, ?, ?, ?)
        `, [targetTableId, col.name, col.displayName, col.type, i]);
      }
    }
    
    // Generate unique webhook token
    const token = generateWebhookToken();
    // ADR-0069: store prefix + sha256 alongside plaintext token until P3 drop.
    const { prefix: tokenPrefix, hash: tokenHashValue } = hashToken(token);

    // Create webhook
    const webhook = await dbRun(`
      INSERT INTO webhooks (project_id, table_id, name, token, token_prefix, token_hash, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `, [projectId, targetTableId, name, token, tokenPrefix, tokenHashValue, userId]);
    
    const created = await dbGet('SELECT * FROM webhooks WHERE id = ?', [webhook.lastInsertRowid]);
    
    success(res, {
      ...created,
      url: `${req.protocol}://${req.get('host')}/api/webhooks/incoming/${token}`
    });
  } catch (err) {
    apiLogger.error('Error creating webhook:', err);
    error(res, 'CREATE_ERROR', err.message, 500);
  }
});

// ============================================================================
// PATCH /api/v3/webhooks/:id - Update webhook
// ============================================================================
router.patch('/webhooks/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;
    const userId = req.user.id;
    
    const webhook = await dbGet(`
      SELECT w.* FROM webhooks w
      JOIN projects p ON w.project_id = p.id
      JOIN spaces s ON p.space_id = s.id
      WHERE w.id = ? AND (s.owner_id = ? OR s.type = 'personal')
    `, [id, userId]);
    
    if (!webhook) {
      return notFound(res, 'Webhook');
    }
    
    const updates = [];
    const values = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(isActive ? 1 : 0);
    }
    
    if (updates.length > 0) {
      values.push(id);
      await dbRun(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`, values);
    }
    
    const updated = await dbGet('SELECT * FROM webhooks WHERE id = ?', [id]);
    success(res, updated);
  } catch (err) {
    apiLogger.error('Error updating webhook:', err);
    error(res, 'UPDATE_ERROR', err.message, 500);
  }
});

// ============================================================================
// DELETE /api/v3/webhooks/:id - Delete webhook
// ============================================================================
router.delete('/webhooks/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const webhook = await dbGet(`
      SELECT w.* FROM webhooks w
      JOIN projects p ON w.project_id = p.id
      JOIN spaces s ON p.space_id = s.id
      WHERE w.id = ? AND (s.owner_id = ? OR s.type = 'personal')
    `, [id, userId]);
    
    if (!webhook) {
      return notFound(res, 'Webhook');
    }
    
    // Delete logs first
    await dbRun('DELETE FROM webhook_logs WHERE webhook_id = ?', [id]);
    // Delete webhook
    await dbRun('DELETE FROM webhooks WHERE id = ?', [id]);
    
    success(res, { message: 'Webhook deleted' });
  } catch (err) {
    apiLogger.error('Error deleting webhook:', err);
    error(res, 'DELETE_ERROR', err.message, 500);
  }
});

// ============================================================================
// GET /api/v3/webhooks/:id/logs - Get webhook logs
// ============================================================================
router.get('/webhooks/:id/logs', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const userId = req.user.id;
    
    const webhook = await dbGet(`
      SELECT w.* FROM webhooks w
      JOIN projects p ON w.project_id = p.id
      JOIN spaces s ON p.space_id = s.id
      WHERE w.id = ? AND (s.owner_id = ? OR s.type = 'personal')
    `, [id, userId]);
    
    if (!webhook) {
      return notFound(res, 'Webhook');
    }
    
    const logs = await dbAll(`
      SELECT * FROM webhook_logs
      WHERE webhook_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [id, parseInt(limit), parseInt(offset)]);
    
    const total = await dbGet('SELECT COUNT(*) as count FROM webhook_logs WHERE webhook_id = ?', [id]);
    
    success(res, {
      logs,
      pagination: { total: total.count, limit: parseInt(limit), offset: parseInt(offset) }
    });
  } catch (err) {
    apiLogger.error('Error fetching webhook logs:', err);
    error(res, 'FETCH_ERROR', err.message, 500);
  }
});

// ============================================================================
// POST /api/webhooks/incoming/:token - Public endpoint for receiving webhooks
// ============================================================================
router.post('/incoming/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const payload = req.body;
    const sourceIp = req.ip || req.connection?.remoteAddress || 'unknown';

    // ADR-0069 P2: resolve via prefix+hash first; fall back to legacy
    // plaintext only when the row's hash columns are still NULL (i.e. the
    // P1 backfill missed it — should be zero hits after the 7-day soak).
    const { prefix, hash } = hashToken(token);
    let webhook = await dbGet(`
      SELECT w.*, t.id as table_id FROM webhooks w
      LEFT JOIN universal_tables t ON w.table_id = t.id
      WHERE w.token_prefix = ? AND w.token_hash = ? AND w.is_active = 1
    `, [prefix, hash]);

    if (!webhook) {
      const legacyHit = await dbGet(`
        SELECT w.*, t.id as table_id FROM webhooks w
        LEFT JOIN universal_tables t ON w.table_id = t.id
        WHERE w.token = ? AND w.token_hash IS NULL AND w.is_active = 1
      `, [token]);
      if (legacyHit) {
        tokenPlaintextLookupHits += 1;
        apiLogger.warn(
          `[adr-0069] token_plaintext_lookup_hit webhook_id=${legacyHit.id} ` +
            `(total=${tokenPlaintextLookupHits}) — row missing token_hash, ` +
            `re-run P1 backfill before P3`
        );
        webhook = legacyHit;
      }
    }

    if (!webhook) {
      return notFound(res, 'Webhook not found or inactive');
    }
    
    // Log the incoming request
    const logResult = await dbRun(`
      INSERT INTO webhook_logs (webhook_id, payload, source_ip, status, created_at)
      VALUES (?, ?, ?, 'received', datetime('now'))
    `, [webhook.id, JSON.stringify(payload), sourceIp]);
    
    // If table is linked, insert data
    if (webhook.table_id) {
      try {
        await processWebhookPayload(webhook, payload, sourceIp);
        
        // Update log status
        await dbRun(`UPDATE webhook_logs SET status = 'processed', processed_at = datetime('now') WHERE id = ?`, [logResult.lastInsertRowid]);
      } catch (err) {
        apiLogger.error('Error processing webhook payload:', err);
        await dbRun(`UPDATE webhook_logs SET status = 'error', error_message = ? WHERE id = ?`, [err.message, logResult.lastInsertRowid]);
      }
    }
    
    success(res, { message: 'Webhook received' });
  } catch (err) {
    apiLogger.error('Error processing incoming webhook:', err);
    error(res, 'WEBHOOK_ERROR', err.message, 500);
  }
});

// ============================================================================
// Helper: Process webhook payload and insert into table
// ============================================================================
async function processWebhookPayload(webhook, payload, sourceIp) {
  const tableId = webhook.table_id;
  
  // Get existing columns
  const existingColumns = await dbAll(`
    SELECT * FROM table_columns WHERE table_id = ? ORDER BY order_index
  `, [tableId]);
  
  const columnMap = new Map(existingColumns.map(c => [c.column_name, c]));
  
  // Flatten payload if nested
  const flatPayload = flattenObject(payload);
  
  // Check for new fields and create columns
  let maxPosition = existingColumns.length;
  for (const [key, value] of Object.entries(flatPayload)) {
    const columnName = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (!columnMap.has(columnName) && !['received_at', 'source_ip', 'raw_payload'].includes(columnName)) {
      // Determine column type based on value
      const columnType = inferColumnType(value);
      
      await dbRun(`
        INSERT INTO table_columns (table_id, column_name, display_name, type, order_index)
        VALUES (?, ?, ?, ?, ?)
      `, [tableId, columnName, key, columnType, maxPosition++]);
      
      columnMap.set(columnName, { column_name: columnName, type: columnType });
    }
  }
  
  // Refresh columns after potential additions
  const allColumns = await dbAll(`SELECT * FROM table_columns WHERE table_id = ?`, [tableId]);
  
  // Build row data
  const rowData = {
    received_at: new Date().toISOString(),
    source_ip: sourceIp,
    raw_payload: JSON.stringify(payload)
  };
  
  for (const [key, value] of Object.entries(flatPayload)) {
    const columnName = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    rowData[columnName] = value;
  }
  
  // Generate unique base_id for the row
  const baseId = `wh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Insert row with data as JSON
  await dbRun(`
    INSERT INTO table_rows (table_id, base_id, data)
    VALUES (?, ?, ?)
  `, [tableId, baseId, JSON.stringify(rowData)]);
}

// ============================================================================
// Helper: Flatten nested object
// ============================================================================
function flattenObject(obj, prefix = '') {
  const result = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}_${key}` : key;
    
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }
  
  return result;
}

// ============================================================================
// Helper: Infer column type from value
// ============================================================================
function inferColumnType(value) {
  if (value === null || value === undefined) return 'text';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return Number.isInteger(value) ? 'number' : 'number';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
    if (/^https?:\/\//.test(value)) return 'url';
    if (/@/.test(value)) return 'email';
    if (value.length > 200) return 'longtext';
  }
  if (Array.isArray(value)) return 'multiselect';
  return 'text';
}

// ============================================================================
// Helper: Generate unique webhook token
// ============================================================================
function generateWebhookToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export default router;
