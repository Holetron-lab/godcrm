// backend/services/CalendarSyncScheduler.js
// Периодическая синхронизация Google Calendar + Auto-sync rules
// Запускается каждые 5 минут

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { syncAllAccounts, generateBaseId } from './GoogleCalendarService.js';
import { dbGet, dbRun, dbAll, isPostgres, sqlNow, safeJsonParse } from '../database/connection.js';
import { fireRowCreateTriggers } from './AutomationTriggerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const calLogger = logger.child({ module: 'calendar-scheduler' });

let syncInterval = null;
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 минут
let isSyncing = false;

// Default ticket values
const DEFAULT_EVENTS_TABLE_ID = 2671;
const TICKETS_TABLE_ID = 1708;
const DEFAULT_STATE_BACKLOG = 24275;
const DEFAULT_TYPE_TASK = 24269;
const DEFAULT_PRIORITY_MEDIUM = 24272;

const SYNC_RULES_PATH = path.resolve(__dirname, '../calendar-sync-rules.json');

/**
 * Load sync rules from config file
 */
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

/**
 * Check if a calendar event matches a sync rule
 */
function matchesRule(eventData, rule) {
  // Calendar filter
  if (rule.calendar_id && eventData.calendar_id !== rule.calendar_id) return false;

  // Calendar name filter (partial match)
  if (rule.calendar_name) {
    const calName = (eventData.calendar_name || '').toLowerCase();
    if (!calName.includes(rule.calendar_name.toLowerCase())) return false;
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
      if (!title.includes(keyword) && !desc.includes(keyword)) return false;
    }
  }

  // Exclude filter
  if (rule.exclude_filter) {
    const title = (eventData.title || '').toLowerCase();
    const excludeKw = rule.exclude_filter.toLowerCase();
    try {
      if (new RegExp(excludeKw, 'i').test(title)) return false;
    } catch {
      if (title.includes(excludeKw)) return false;
    }
  }

  // Skip cancelled events
  if (eventData.status === 'cancelled') return false;

  return true;
}

/**
 * Apply auto-sync rules: create tickets from calendar events
 */
async function applyAutoSyncRules() {
  const config = loadSyncRules();
  if (!config || !config.enabled || !config.rules) return { created: 0, skipped: 0, errors: 0 };

  const enabledRules = config.rules.filter(r => r.enabled);
  if (enabledRules.length === 0) return { created: 0, skipped: 0, errors: 0 };

  const counts = { created: 0, skipped: 0, errors: 0, matched: 0 };

  // Get all calendar events without ticket
  const events = await dbAll(
    isPostgres()
      ? `SELECT id, data, created_by FROM table_rows WHERE table_id = ? AND (data->>'ticket_id' IS NULL OR data->>'ticket_id' = '')`
      : `SELECT id, data, created_by FROM table_rows WHERE table_id = ? AND (data NOT LIKE '%"ticket_id":%' OR data LIKE '%"ticket_id":null%' OR data LIKE '%"ticket_id":""%')`,
    [DEFAULT_EVENTS_TABLE_ID]
  );

  for (const eventRow of events) {
    const eventData = safeJsonParse(eventRow.data) || {};
    if (eventData.ticket_id) { counts.skipped++; continue; }

    for (const rule of enabledRules) {
      if (matchesRule(eventData, rule)) {
        counts.matched++;
        try {
          const ticketData = {
            what: eventData.title || 'Calendar Event',
            why: [
              eventData.description || '',
              `\n\n📅 Auto-created from: ${eventData.calendar_name || eventData.calendar_id || ''}`,
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
          const userId = eventRow.created_by || 1;
          const result = await dbRun(
            `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
            [ticketsTableId, baseId, JSON.stringify(ticketData), userId]
          );
          const ticketRowId = result.lastID || result.lastInsertRowid;

          // Link event → ticket
          eventData.ticket_id = ticketRowId;
          eventData.auto_ticket = true;
          await dbRun(
            `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
            [JSON.stringify(eventData), eventRow.id]
          );

          calLogger.info({ eventRowId: eventRow.id, ticketRowId, rule: rule.name }, 'Auto-created ticket from calendar event');
          counts.created++;

          // Fire CRM automation triggers for the new ticket
          if (ticketRowId) {
            fireRowCreateTriggers(ticketsTableId, ticketRowId, ticketData).catch(err => {
              calLogger.warn({ err, ticketRowId }, 'Auto-sync: ticket automation trigger failed (non-blocking)');
            });
          }

          break; // First matching rule wins
        } catch (err) {
          calLogger.error({ err, eventRowId: eventRow.id, rule: rule.name }, 'Failed to auto-create ticket');
          counts.errors++;
        }
      }
    }
  }

  return counts;
}

/**
 * Запускает периодическую синхронизацию
 */
export function startCalendarSync() {
  if (syncInterval) {
    calLogger.warn('Calendar sync scheduler already running');
    return;
  }

  calLogger.info(`Starting calendar sync scheduler (every ${SYNC_INTERVAL_MS / 1000}s)`);

  // Первая синхронизация через 30 секунд после старта
  setTimeout(async () => {
    await runSync();
  }, 30 * 1000);

  // Периодическая синхронизация
  syncInterval = setInterval(async () => {
    await runSync();
  }, SYNC_INTERVAL_MS);
}

/**
 * Останавливает периодическую синхронизацию
 */
export function stopCalendarSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    calLogger.info('Calendar sync scheduler stopped');
  }
}

/**
 * Выполняет одну итерацию синхронизации + применяет правила
 */
async function runSync() {
  if (isSyncing) {
    calLogger.debug('Sync already in progress, skipping');
    return;
  }

  isSyncing = true;
  const startTime = Date.now();

  try {
    calLogger.info('Starting scheduled calendar sync...');
    const results = await syncAllAccounts();
    const duration = Date.now() - startTime;

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    calLogger.info({
      duration,
      total: results.length,
      success: successCount,
      errors: errorCount
    }, `Scheduled sync completed in ${duration}ms`);

    // Apply auto-sync rules after successful sync
    if (successCount > 0) {
      try {
        const rulesResult = await applyAutoSyncRules();
        if (rulesResult.created > 0) {
          calLogger.info(rulesResult, 'Auto-sync rules applied after scheduled sync');
        }
      } catch (rulesErr) {
        calLogger.error({ err: rulesErr }, 'Failed to apply auto-sync rules after sync');
      }
    }
  } catch (err) {
    calLogger.error({ err }, 'Scheduled sync failed');
  } finally {
    isSyncing = false;
  }
}

export default { startCalendarSync, stopCalendarSync };
