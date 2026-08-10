// calendar/syncController.js — Sync operations and sync rules

import { Router } from 'express';
import fs from 'fs';
import {
  getConnectionStatus,
  syncFromGoogle,
  fullSync,
  generateBaseId,
} from '../../../services/GoogleCalendarService.js';
import { dbRun, dbAll, safeJsonParse, sqlNow, isPostgres } from '../../../database/connection.js';
import {
  calLogger,
  DEFAULT_EVENTS_TABLE_ID,
  TICKETS_TABLE_ID,
  DEFAULT_STATE_BACKLOG,
  DEFAULT_TYPE_TASK,
  DEFAULT_PRIORITY_MEDIUM,
  respondSuccess,
  respondError,
} from './helpers.js';

const router = Router();

// Sync rules file path
const SYNC_RULES_PATH = new URL('../../calendar-sync-rules.json', import.meta.url).pathname;

// =============================================================================
// SYNC
// =============================================================================

/**
 * POST /api/v3/calendar/sync
 * Sync Google Calendar → CRM (pull events)
 * Body: { tableId? }
 */
router.post('/sync', async (req, res) => {
  try {
    const status = await getConnectionStatus(req.user.id);
    if (!status.connected) {
      return respondError(res, 401, 'NOT_CONNECTED', 'Google Calendar is not connected. Please authorize first.');
    }

    const tableId = req.body.tableId || DEFAULT_EVENTS_TABLE_ID;
    calLogger.info({ userId: req.user.id, tableId }, 'Manual sync triggered');
    const result = await syncFromGoogle(req.user.id, tableId);
    return respondSuccess(res, { ...result, syncedAt: new Date().toISOString() });
  } catch (err) {
    calLogger.error({ err }, 'Sync failed');
    return respondError(res, 500, 'SYNC_FAILED', 'Calendar sync failed', err.message);
  }
});

/**
 * POST /api/v3/calendar/sync/full
 * Full bidirectional sync (Google ↔ CRM)
 * Body: { tableId? }
 */
router.post('/sync/full', async (req, res) => {
  try {
    const status = await getConnectionStatus(req.user.id);
    if (!status.connected) {
      return respondError(res, 401, 'NOT_CONNECTED', 'Google Calendar is not connected. Please authorize first.');
    }

    const tableId = req.body.tableId || DEFAULT_EVENTS_TABLE_ID;
    calLogger.info({ userId: req.user.id, tableId }, 'Full sync triggered');
    const result = await fullSync(req.user.id, tableId);
    return respondSuccess(res, { ...result, syncedAt: new Date().toISOString() });
  } catch (err) {
    calLogger.error({ err }, 'Full sync failed');
    return respondError(res, 500, 'SYNC_FAILED', 'Full calendar sync failed', err.message);
  }
});

// =============================================================================
// SYNC RULES (Auto-create tickets from calendar events)
// =============================================================================

function loadSyncRules() {
  try {
    if (fs.existsSync(SYNC_RULES_PATH)) {
      return JSON.parse(fs.readFileSync(SYNC_RULES_PATH, 'utf8'));
    }
  } catch (err) {
    calLogger.warn({ err }, 'Failed to load sync rules');
  }
  return { rules: [], enabled: false };
}

function saveSyncRules(config) {
  fs.writeFileSync(SYNC_RULES_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * GET /api/v3/calendar/sync-rules
 * Get all auto-sync rules
 */
router.get('/sync-rules', async (req, res) => {
  try {
    const config = loadSyncRules();
    return respondSuccess(res, config);
  } catch (err) {
    calLogger.error({ err }, 'Failed to get sync rules');
    return respondError(res, 500, 'FETCH_FAILED', 'Failed to get sync rules', err.message);
  }
});

/**
 * PUT /api/v3/calendar/sync-rules
 * Update auto-sync rules
 * Body: { enabled: boolean, rules: [{ id, name, calendar_id, calendar_name, keyword_filter, priority, type, assigned_to, enabled }] }
 */
router.put('/sync-rules', async (req, res) => {
  try {
    const { enabled, rules } = req.body;
    const config = {
      enabled: enabled !== undefined ? enabled : true,
      rules: (rules || []).map((rule, i) => ({
        id: rule.id || `rule_${Date.now()}_${i}`,
        name: rule.name || `Rule ${i + 1}`,
        calendar_id: rule.calendar_id || null,       // null = all calendars
        calendar_name: rule.calendar_name || null,
        keyword_filter: rule.keyword_filter || null,   // regex or substring to match in title
        exclude_filter: rule.exclude_filter || null,   // exclude events matching this
        priority: rule.priority || DEFAULT_PRIORITY_MEDIUM,
        type: rule.type || DEFAULT_TYPE_TASK,
        state: rule.state || DEFAULT_STATE_BACKLOG,
        assigned_to: rule.assigned_to || null,
        tickets_table_id: rule.tickets_table_id || TICKETS_TABLE_ID,
        enabled: rule.enabled !== false,
      })),
      updated_at: new Date().toISOString(),
      updated_by: req.user.id,
    };
    saveSyncRules(config);
    calLogger.info({ userId: req.user.id, rulesCount: config.rules.length }, 'Sync rules updated');
    return respondSuccess(res, config);
  } catch (err) {
    calLogger.error({ err }, 'Failed to save sync rules');
    return respondError(res, 500, 'SAVE_FAILED', 'Failed to save sync rules', err.message);
  }
});

// =============================================================================
// AUTO-SYNC: Apply rules after sync
// =============================================================================

/**
 * POST /api/v3/calendar/apply-rules
 * Apply sync rules to existing calendar events (create tickets where rules match)
 */
router.post('/apply-rules', async (req, res) => {
  try {
    const config = loadSyncRules();
    if (!config.enabled || !config.rules || config.rules.length === 0) {
      return respondSuccess(res, { message: 'No rules enabled', created: 0 });
    }

    const result = await applyAutoSyncRules(req.user.id, config);
    return respondSuccess(res, result);
  } catch (err) {
    calLogger.error({ err }, 'Failed to apply sync rules');
    return respondError(res, 500, 'RULES_FAILED', 'Failed to apply sync rules', err.message);
  }
});

/**
 * Apply auto-sync rules to calendar events and create tickets
 */
async function applyAutoSyncRules(userId, config) {
  if (!config || !config.enabled || !config.rules) return { created: 0, skipped: 0, errors: 0 };

  const enabledRules = config.rules.filter(r => r.enabled);
  if (enabledRules.length === 0) return { created: 0, skipped: 0, errors: 0 };

  const counts = { created: 0, skipped: 0, errors: 0, matched: 0 };

  // Get all calendar events that don't have a ticket yet
  const events = await dbAll(
    isPostgres()
      ? `SELECT id, data FROM table_rows WHERE table_id = ? AND (data->>'ticket_id' IS NULL OR data->>'ticket_id' = '')`
      : `SELECT id, data FROM table_rows WHERE table_id = ? AND (data NOT LIKE '%"ticket_id":%' OR data LIKE '%"ticket_id":null%' OR data LIKE '%"ticket_id":""%')`,
    [DEFAULT_EVENTS_TABLE_ID]
  );

  for (const eventRow of events) {
    const eventData = safeJsonParse(eventRow.data) || {};

    // Skip events that already have a ticket
    if (eventData.ticket_id) {
      counts.skipped++;
      continue;
    }

    // Check each rule
    for (const rule of enabledRules) {
      if (matchesRule(eventData, rule)) {
        counts.matched++;

        try {
          // Create ticket from event
          const ticketData = {
            what: eventData.title || 'Calendar Event',
            why: [
              eventData.description || '',
              `\n\n📅 Auto-created from Google Calendar: ${eventData.calendar_name || eventData.calendar_id || ''}`,
              `\n🤖 Rule: ${rule.name}`,
              eventData.link ? `\n🔗 ${eventData.link}` : '',
            ].join(''),
            state: rule.state || DEFAULT_STATE_BACKLOG,
            type: rule.type || DEFAULT_TYPE_TASK,
            priority: rule.priority || DEFAULT_PRIORITY_MEDIUM,
            assigned_to: rule.assigned_to || null,
            scheduled_date: eventData.start_datetime || null,
            due_date: eventData.end_datetime || null,
            calendar_event: eventRow.id,
          };

          const ticketsTableId = rule.tickets_table_id || TICKETS_TABLE_ID;
          const baseId = generateBaseId();
          const result = await dbRun(
            `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
            [ticketsTableId, baseId, JSON.stringify(ticketData), userId]
          );
          const ticketRowId = result.lastID || result.lastInsertRowid;

          // Link event to ticket
          eventData.ticket_id = ticketRowId;
          eventData.auto_ticket = true;
          await dbRun(
            `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
            [JSON.stringify(eventData), eventRow.id]
          );

          calLogger.info({ eventRowId: eventRow.id, ticketRowId, rule: rule.name }, 'Auto-created ticket from calendar event');
          counts.created++;
          break; // One ticket per event, first matching rule wins
        } catch (err) {
          calLogger.error({ err, eventRowId: eventRow.id, rule: rule.name }, 'Failed to auto-create ticket');
          counts.errors++;
        }
      }
    }
  }

  calLogger.info(counts, 'Auto-sync rules applied');
  return counts;
}

/**
 * Check if a calendar event matches a sync rule
 */
function matchesRule(eventData, rule) {
  // Calendar filter
  if (rule.calendar_id && eventData.calendar_id !== rule.calendar_id) {
    return false;
  }

  // Calendar name filter (partial match)
  if (rule.calendar_name) {
    const calName = (eventData.calendar_name || '').toLowerCase();
    if (!calName.includes(rule.calendar_name.toLowerCase())) {
      return false;
    }
  }

  // Keyword filter (matches in title or description)
  if (rule.keyword_filter) {
    const title = (eventData.title || '').toLowerCase();
    const desc = (eventData.description || '').toLowerCase();
    const keyword = rule.keyword_filter.toLowerCase();

    try {
      const regex = new RegExp(keyword, 'i');
      if (!regex.test(title) && !regex.test(desc)) return false;
    } catch {
      // If not valid regex, do substring match
      if (!title.includes(keyword) && !desc.includes(keyword)) return false;
    }
  }

  // Exclude filter
  if (rule.exclude_filter) {
    const title = (eventData.title || '').toLowerCase();
    const excludeKeyword = rule.exclude_filter.toLowerCase();
    try {
      const regex = new RegExp(excludeKeyword, 'i');
      if (regex.test(title)) return false;
    } catch {
      if (title.includes(excludeKeyword)) return false;
    }
  }

  // Skip cancelled events
  if (eventData.status === 'cancelled') return false;

  return true;
}

export default router;
