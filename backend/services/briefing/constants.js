/**
 * Briefing — Constants & Helpers
 *
 * Shared constants, option cache, formatting utilities
 */

import { dbAll, safeJsonParse } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'briefing-service' });
export { log };

// =============================================================================
// CONSTANTS
// =============================================================================

export const DEFAULT_CHAT_ID = '423753027';
export const VIKA_CHAT_ID = '400602216';

// All household members who receive briefings
export const ALL_CHAT_IDS = [DEFAULT_CHAT_ID, VIKA_CHAT_ID];

// All notifications are routed to forum topics — no DMs.
// Topic mapping is handled by TelegramService.sendToTopic().
// Table IDs in GOD CRM (GERAVIKA space)
export const TABLE_IDS = {
  CALENDAR_EVENTS: 2671,
  SPRINT_TASKS: 2649,
  HEALTH_METRICS: 2643,
  MEDICATIONS: 2658,
};

export const TIMEZONE = 'Europe/Moscow';

export const PRIORITY_ICONS = {
  p1: '\u{1F534}', p0: '\u{1F534}', high: '\u{1F534}', urgent: '\u{1F534}',
  p2: '\u{1F7E1}', medium: '\u{1F7E1}', normal: '\u{1F7E1}',
  p3: '\u{1F7E2}', low: '\u{1F7E2}',
  p4: '\u26AA',
};

export const DONE_STATES = ['Done', 'Archive', 'done', 'archive', 'completed', 'Completed'];

// Wellness schedule table IDs
export const WELLNESS_SCHEDULE_TABLE = 2934;
export const ATOMIC_HABITS_TABLE = 2933;

// =============================================================================
// OPTION CACHE
// =============================================================================

// Lookup tables for select columns in Family Task Board (table 2649)
// Related table IDs: state->2646, priority->2648, type->2647
let _optionCache = null;

export async function getOptionLabels() {
  if (_optionCache) return _optionCache;
  try {
    const stateRows = await dbAll('SELECT id, data FROM table_rows WHERE table_id = 2646');
    const priorityRows = await dbAll('SELECT id, data FROM table_rows WHERE table_id = 2648');
    const typeRows = await dbAll('SELECT id, data FROM table_rows WHERE table_id = 2647');

    const stateMap = {};
    const priorityMap = {};
    const typeMap = {};
    const doneStateIds = new Set();

    for (const r of stateRows) {
      const d = safeJsonParse(r.data) || {};
      stateMap[r.id] = d.name || String(r.id);
      if (d.is_final) doneStateIds.add(r.id);
    }
    for (const r of priorityRows) {
      const d = safeJsonParse(r.data) || {};
      priorityMap[r.id] = d.name || String(r.id);
    }
    for (const r of typeRows) {
      const d = safeJsonParse(r.data) || {};
      typeMap[r.id] = d.name || String(r.id);
    }

    _optionCache = { stateMap, priorityMap, typeMap, doneStateIds };
    return _optionCache;
  } catch (err) {
    log.error({ err }, 'Failed to load option labels');
    return { stateMap: {}, priorityMap: {}, typeMap: {}, doneStateIds: new Set() };
  }
}

export function resolveTaskFields(data, opts) {
  const stateRaw = data.state || data.status || '';
  const priorityRaw = data.priority || '';
  const stateLabel = opts.stateMap[stateRaw] || String(stateRaw);
  const priorityLabel = opts.priorityMap[priorityRaw] || String(priorityRaw);
  const isDone = opts.doneStateIds.has(Number(stateRaw)) || DONE_STATES.includes(stateLabel);
  const title = data.what || data.title || data.name || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f';
  return { title, stateLabel, priorityLabel, isDone };
}

// =============================================================================
// HELPERS
// =============================================================================

export function getTodayBounds() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayStr = formatter.format(now);

  const labelFormatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: TIMEZONE, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
  const todayLabel = labelFormatter.format(now);

  return { todayStr, todayStart: `${todayStr}T00:00:00`, todayEnd: `${todayStr}T23:59:59`, todayLabel };
}

export function extractTime(datetime) {
  if (!datetime) return '\u0432\u0435\u0441\u044c \u0434\u0435\u043d\u044c';
  if (/^\d{4}-\d{2}-\d{2}$/.test(datetime)) return '\u0432\u0435\u0441\u044c \u0434\u0435\u043d\u044c';
  try {
    const d = new Date(datetime);
    if (isNaN(d.getTime())) return '\u0432\u0435\u0441\u044c \u0434\u0435\u043d\u044c';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch {
    return '\u0432\u0435\u0441\u044c \u0434\u0435\u043d\u044c';
  }
}

export function getPriorityIcon(priority) {
  if (!priority) return '\u26AA';
  return PRIORITY_ICONS[String(priority).toLowerCase().trim()] || '\u26AA';
}

export function escTg(text) {
  if (!text) return '';
  return String(text).replace(/([_*`\[])/g, '\\$1');
}
