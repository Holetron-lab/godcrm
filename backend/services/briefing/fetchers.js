/**
 * Briefing — Data Fetchers
 *
 * Functions that query CRM tables for calendar events, tasks, health, medications, etc.
 */

import { dbAll, dbGet, safeJsonParse } from '../../database/connection.js';
import {
  log, TABLE_IDS, WELLNESS_SCHEDULE_TABLE, ATOMIC_HABITS_TABLE,
  getOptionLabels, resolveTaskFields, extractTime,
} from './constants.js';

// =============================================================================
// DATA FETCHERS
// =============================================================================

export async function fetchTodayEvents(todayStr) {
  try {
    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at DESC',
      [TABLE_IDS.CALENDAR_EVENTS]
    );
    const events = [];
    for (const row of rows) {
      const data = safeJsonParse(row.data) || {};
      const startDt = data.start_datetime || '';
      if (startDt.startsWith(todayStr)) {
        events.push({
          id: row.id,
          title: data.title || data.summary || '\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f',
          start_datetime: startDt,
          end_datetime: data.end_datetime || '',
          location: data.location || '',
          time: extractTime(startDt),
        });
      }
    }
    events.sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
    return events;
  } catch (err) {
    log.error({ err }, 'Failed to fetch calendar events');
    return [];
  }
}

export async function fetchSprintTasks() {
  try {
    const opts = await getOptionLabels();
    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at DESC',
      [TABLE_IDS.SPRINT_TASKS]
    );
    const tasks = [];
    for (const row of rows) {
      const data = safeJsonParse(row.data) || {};
      const { title, stateLabel, priorityLabel, isDone } = resolveTaskFields(data, opts);
      if (!isDone) {
        tasks.push({
          id: row.id,
          title,
          state: stateLabel,
          priority: priorityLabel,
          assigned_to: data.assigned_to || '',
        });
      }
    }
    const priorityOrder = { p0: 0, p1: 1, urgent: 1, high: 1, critical: 0, p2: 2, medium: 2, normal: 2, p3: 3, low: 3, p4: 4 };
    tasks.sort((a, b) => {
      const pa = priorityOrder[String(a.priority).toLowerCase()] ?? 5;
      const pb = priorityOrder[String(b.priority).toLowerCase()] ?? 5;
      return pa - pb;
    });
    return tasks;
  } catch (err) {
    log.error({ err }, 'Failed to fetch sprint tasks');
    return [];
  }
}

export async function fetchHealthMetrics() {
  try {
    const row = await dbGet(
      'SELECT id, data, created_at FROM table_rows WHERE table_id = ? ORDER BY created_at DESC LIMIT 1',
      [TABLE_IDS.HEALTH_METRICS]
    );
    if (!row) return null;
    return { id: row.id, ...safeJsonParse(row.data), _recorded_at: row.created_at };
  } catch (err) {
    log.error({ err }, 'Failed to fetch health metrics');
    return null;
  }
}

export async function fetchMedications() {
  try {
    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at ASC',
      [TABLE_IDS.MEDICATIONS]
    );
    return rows.map(row => {
      const data = safeJsonParse(row.data) || {};
      return {
        id: row.id,
        name: data.name || data.title || 'Unknown',
        dosage: data.dosage || '',
        time_of_day: data.time_of_day || data.schedule || data.time || 'any',
        notes: data.notes || '',
      };
    });
  } catch (err) {
    log.error({ err }, 'Failed to fetch medications');
    return [];
  }
}

export async function fetchCompletedToday(todayStr) {
  try {
    const opts = await getOptionLabels();
    const rows = await dbAll(
      'SELECT id, data, updated_at FROM table_rows WHERE table_id = ? ORDER BY updated_at DESC',
      [TABLE_IDS.SPRINT_TASKS]
    );
    const completed = [];
    for (const row of rows) {
      const data = safeJsonParse(row.data) || {};
      const { title, stateLabel, priorityLabel, isDone } = resolveTaskFields(data, opts);
      const rawUpdated = row.updated_at || '';
      const updatedAt = rawUpdated instanceof Date ? rawUpdated.toISOString() : String(rawUpdated);
      if (isDone && updatedAt.startsWith(todayStr)) {
        completed.push({
          id: row.id,
          title,
          state: stateLabel,
          priority: priorityLabel,
        });
      }
    }
    return completed;
  } catch (err) {
    log.error({ err }, 'Failed to fetch completed tasks');
    return [];
  }
}

/**
 * Fetch wellness schedule blocks from CRM table.
 */
export async function fetchWellnessSchedule() {
  try {
    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at ASC',
      [WELLNESS_SCHEDULE_TABLE]
    );
    return rows.map(row => {
      const data = safeJsonParse(row.data) || {};
      return {
        id: row.id,
        time_start: data.time_start || data.start_time || '',
        time_end: data.time_end || data.end_time || '',
        block_name: data.block_name || data.name || data.title || '',
        category: data.category || data.type || '',
        details: data.details || data.description || '',
      };
    });
  } catch (err) {
    log.error({ err }, 'Failed to fetch wellness schedule');
    return [];
  }
}

/**
 * Fetch atomic habit stacks from CRM table.
 */
export async function fetchAtomicHabits() {
  try {
    const rows = await dbAll(
      'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at ASC',
      [ATOMIC_HABITS_TABLE]
    );
    return rows.map(row => {
      const data = safeJsonParse(row.data) || {};
      return {
        id: row.id,
        trigger: data.trigger || data.cue || '',
        habit: data.habit || data.micro_habit || data.name || '',
        duration: data.duration || data.time || '',
      };
    });
  } catch (err) {
    log.error({ err }, 'Failed to fetch atomic habits');
    return [];
  }
}
