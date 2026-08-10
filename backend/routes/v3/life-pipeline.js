// backend/routes/v3/life-pipeline.js
// GOD CRM Life Pipeline - Morning Briefing & Evening Check-in
// Generates structured daily briefings and sends via Telegram

import { Router } from 'express';
import { dbAll, dbGet, safeJsonParse } from '../../database/connection.js';
import { sendMessage, sendToTopic } from '../../services/TelegramService.js';
import { apiLogger } from '../../utils/logger.js';
import { success, error } from '../../utils/response.js';

const router = Router();
const log = apiLogger.child({ module: 'life-pipeline' });

// =============================================================================
// CONSTANTS
// =============================================================================

const TELEGRAM_CHAT_ID = '423753027';

// Table IDs in GOD CRM
const TABLE_IDS = {
  CALENDAR_EVENTS: 2671,   // Google Calendar events (synced)
  SPRINT_TASKS: 2649,      // Sprint / Kanban tasks
  HEALTH_METRICS: 2643,    // Health tracking data
  MEDICATIONS: 2658,       // Medications & supplements
};

const TIMEZONE = 'Europe/Moscow';

// Priority display mapping
const PRIORITY_ICONS = {
  p1: '\u{1F534}',  // red circle
  p0: '\u{1F534}',
  high: '\u{1F534}',
  urgent: '\u{1F534}',
  p2: '\u{1F7E1}',  // yellow circle
  medium: '\u{1F7E1}',
  normal: '\u{1F7E1}',
  p3: '\u{1F7E2}',  // green circle
  low: '\u{1F7E2}',
  p4: '\u26AA',      // white circle
};

const DONE_STATES = ['Done', 'Archive', 'done', 'archive', 'completed', 'Completed'];

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get today's date boundaries in Europe/Moscow timezone
 * @returns {{ todayStart: string, todayEnd: string, todayLabel: string }}
 */
function getTodayBounds() {
  const now = new Date();

  // Format in target timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = formatter.format(now); // YYYY-MM-DD

  // Human-readable label
  const labelFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const todayLabel = labelFormatter.format(now);

  return {
    todayStr,
    todayStart: `${todayStr}T00:00:00`,
    todayEnd: `${todayStr}T23:59:59`,
    todayLabel,
  };
}

/**
 * Extract time string (HH:MM) from a datetime string
 * @param {string} datetime - ISO datetime or similar
 * @returns {string} - "HH:MM" or "all-day"
 */
function extractTime(datetime) {
  if (!datetime) return 'all-day';

  // All-day events are just dates: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(datetime)) {
    return 'all-day';
  }

  try {
    const d = new Date(datetime);
    if (isNaN(d.getTime())) return 'all-day';

    const timeFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return timeFormatter.format(d);
  } catch {
    return 'all-day';
  }
}

/**
 * Get priority icon for a task
 * @param {string} priority
 * @returns {string}
 */
function getPriorityIcon(priority) {
  if (!priority) return '\u26AA';
  const key = String(priority).toLowerCase().trim();
  return PRIORITY_ICONS[key] || '\u26AA';
}

/**
 * Escape Telegram Markdown v1 special characters
 * @param {string} text
 * @returns {string}
 */
function escTg(text) {
  if (!text) return '';
  return String(text).replace(/([_*`\[])/g, '\\$1');
}

// =============================================================================
// DATA FETCHERS
// =============================================================================

/**
 * Fetch today's calendar events from table_rows
 */
async function fetchTodayEvents(todayStr) {
  try {
    // Query events where start_datetime contains today's date
    const rows = await dbAll(
      `SELECT id, data, created_at
       FROM table_rows
       WHERE table_id = ?
       ORDER BY created_at DESC`,
      [TABLE_IDS.CALENDAR_EVENTS]
    );

    const events = [];
    for (const row of rows) {
      const data = safeJsonParse(row.data) || {};
      const startDt = data.start_datetime || '';

      // Check if this event starts today
      if (startDt.startsWith(todayStr)) {
        events.push({
          id: row.id,
          title: data.title || data.summary || 'Untitled',
          start_datetime: startDt,
          end_datetime: data.end_datetime || '',
          location: data.location || '',
          time: extractTime(startDt),
        });
      }
    }

    // Sort by start time
    events.sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
    return events;
  } catch (err) {
    log.error({ err }, 'Failed to fetch calendar events');
    return [];
  }
}

/**
 * Fetch active sprint tasks (not Done/Archive)
 */
async function fetchSprintTasks() {
  try {
    const rows = await dbAll(
      `SELECT id, data
       FROM table_rows
       WHERE table_id = ?
       ORDER BY created_at DESC`,
      [TABLE_IDS.SPRINT_TASKS]
    );

    const tasks = [];
    for (const row of rows) {
      const data = safeJsonParse(row.data) || {};
      const state = data.state || data.status || '';

      if (!DONE_STATES.includes(state)) {
        tasks.push({
          id: row.id,
          title: data.title || data.name || 'Untitled',
          state,
          priority: data.priority || '',
          assigned_to: data.assigned_to || '',
        });
      }
    }

    // Sort by priority: P1/high first
    const priorityOrder = { p0: 0, p1: 1, urgent: 1, high: 1, p2: 2, medium: 2, normal: 2, p3: 3, low: 3, p4: 4 };
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

/**
 * Fetch latest health metrics
 */
async function fetchHealthMetrics() {
  try {
    const row = await dbGet(
      `SELECT id, data, created_at
       FROM table_rows
       WHERE table_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [TABLE_IDS.HEALTH_METRICS]
    );

    if (!row) return null;
    return { id: row.id, ...safeJsonParse(row.data), _recorded_at: row.created_at };
  } catch (err) {
    log.error({ err }, 'Failed to fetch health metrics');
    return null;
  }
}

/**
 * Fetch medications/supplements
 */
async function fetchMedications() {
  try {
    const rows = await dbAll(
      `SELECT id, data
       FROM table_rows
       WHERE table_id = ?
       ORDER BY created_at ASC`,
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

/**
 * Fetch tasks completed today (for evening check-in)
 */
async function fetchCompletedToday(todayStr) {
  try {
    const rows = await dbAll(
      `SELECT id, data, updated_at
       FROM table_rows
       WHERE table_id = ?
       ORDER BY updated_at DESC`,
      [TABLE_IDS.SPRINT_TASKS]
    );

    const completed = [];
    for (const row of rows) {
      const data = safeJsonParse(row.data) || {};
      const state = data.state || data.status || '';
      const updatedAt = row.updated_at || '';

      if (DONE_STATES.includes(state) && updatedAt.startsWith(todayStr)) {
        completed.push({
          id: row.id,
          title: data.title || data.name || 'Untitled',
          state,
          priority: data.priority || '',
        });
      }
    }

    return completed;
  } catch (err) {
    log.error({ err }, 'Failed to fetch completed tasks');
    return [];
  }
}

// =============================================================================
// MESSAGE FORMATTERS
// =============================================================================

/**
 * Format morning briefing message for Telegram (Markdown v1)
 */
function formatMorningBriefing({ todayLabel, events, tasks, health, medications }) {
  const lines = [];

  // Header
  lines.push('\u2600\uFE0F *\u0414\u043E\u0431\u0440\u043E\u0435 \u0443\u0442\u0440\u043E, \u0413\u0435\u0440\u0430!*');
  lines.push('');
  lines.push(`\u{1F4C5} *\u0421\u0415\u0413\u041E\u0414\u041D\u042F* (${escTg(todayLabel)}):`);
  lines.push('');

  // Calendar events
  lines.push('\u{1F4C6} *\u041A\u0410\u041B\u0415\u041D\u0414\u0410\u0420\u042C:*');
  if (events.length === 0) {
    lines.push('  \u041D\u0435\u0442 \u0441\u043E\u0431\u044B\u0442\u0438\u0439 \u043D\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F');
  } else {
    for (const event of events) {
      const timeStr = event.time === 'all-day' ? '\u{1F30D} all-day' : event.time;
      const locationStr = event.location ? ` (\u{1F4CD}${escTg(event.location)})` : '';
      lines.push(`  ${timeStr} - ${escTg(event.title)}${locationStr}`);
    }
  }
  lines.push('');

  // Sprint tasks
  lines.push('\u{1F4CB} *\u0417\u0410\u0414\u0410\u0427\u0418 (Sprint):*');
  if (tasks.length === 0) {
    lines.push('  \u0412\u0441\u0435 \u0437\u0430\u0434\u0430\u0447\u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u044B! \u{1F389}');
  } else {
    const shown = tasks.slice(0, 15); // Limit to avoid Telegram message size overflow
    for (const task of shown) {
      const icon = getPriorityIcon(task.priority);
      const pLabel = task.priority ? String(task.priority).toUpperCase() : '';
      const stateStr = task.state ? ` [${escTg(task.state)}]` : '';
      lines.push(`  ${icon} ${pLabel ? pLabel + ': ' : ''}${escTg(task.title)}${stateStr}`);
    }
    if (tasks.length > 15) {
      lines.push(`  ... \u0438 \u0435\u0449\u0451 ${tasks.length - 15} \u0437\u0430\u0434\u0430\u0447`);
    }
  }
  lines.push('');

  // Medications
  lines.push('\u{1F48A} *\u041B\u0415\u041A\u0410\u0420\u0421\u0422\u0412\u0410/\u0414\u041E\u0411\u0410\u0412\u041A\u0418:*');
  if (medications.length === 0) {
    lines.push('  \u041D\u0435\u0442 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0439');
  } else {
    // Group by time_of_day
    const groups = {};
    for (const med of medications) {
      const time = med.time_of_day || 'any';
      if (!groups[time]) groups[time] = [];
      const dosageStr = med.dosage ? ` (${escTg(med.dosage)})` : '';
      groups[time].push(`${escTg(med.name)}${dosageStr}`);
    }

    const timeLabels = {
      morning: '\u0423\u0442\u0440\u043E',
      afternoon: '\u0414\u0435\u043D\u044C',
      evening: '\u0412\u0435\u0447\u0435\u0440',
      night: '\u041D\u043E\u0447\u044C',
      any: '\u041B\u044E\u0431\u043E\u0435 \u0432\u0440\u0435\u043C\u044F',
    };

    for (const [time, meds] of Object.entries(groups)) {
      const label = timeLabels[time.toLowerCase()] || escTg(time);
      lines.push(`  ${label}: ${meds.join(', ')}`);
    }
  }
  lines.push('');

  // Health metrics
  lines.push('\u{1F4CA} *\u0417\u0414\u041E\u0420\u041E\u0412\u042C\u0415:*');
  if (!health) {
    lines.push('  \u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445');
  } else {
    if (health.streak !== undefined && health.streak !== null) {
      lines.push(`  Streak: ${health.streak} \u0434\u043D\u0435\u0439`);
    }
    if (health.weight) {
      lines.push(`  \u0412\u0435\u0441: ${health.weight} kg`);
    }
    if (health.steps) {
      lines.push(`  \u0428\u0430\u0433\u0438: ${health.steps}`);
    }
    if (health.sleep_hours) {
      lines.push(`  \u0421\u043E\u043D: ${health.sleep_hours}h`);
    }
    if (health.mood) {
      lines.push(`  \u041D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0438\u0435: ${escTg(health.mood)}`);
    }
    if (health.energy) {
      lines.push(`  \u042D\u043D\u0435\u0440\u0433\u0438\u044F: ${health.energy}/10`);
    }
    // If nothing specific was printed, show recorded_at
    const hasSpecificMetrics = health.streak || health.weight || health.steps || health.sleep_hours || health.mood || health.energy;
    if (!hasSpecificMetrics) {
      lines.push(`  \u041F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0437\u0430\u043F\u0438\u0441\u044C: ${health._recorded_at || 'N/A'}`);
    }
  }
  lines.push('');

  // Footer
  lines.push('\u0425\u043E\u0440\u043E\u0448\u0435\u0433\u043E \u0434\u043D\u044F! \u{1F4AA}');

  return lines.join('\n');
}

/**
 * Format evening check-in message for Telegram (Markdown v1)
 */
function formatEveningCheckin({ todayLabel, completedTasks, remainingTasks, medications, health }) {
  const lines = [];

  // Header
  lines.push('\u{1F319} *\u0412\u0435\u0447\u0435\u0440\u043D\u0438\u0439 \u0447\u0435\u043A-\u0438\u043D*');
  lines.push('');
  lines.push(`\u{1F4C5} *\u0418\u0422\u041E\u0413\u0418 \u0414\u041D\u042F* (${escTg(todayLabel)}):`);
  lines.push('');

  // Completed tasks
  lines.push('\u2705 *\u0421\u0414\u0415\u041B\u0410\u041D\u041E:*');
  if (completedTasks.length === 0) {
    lines.push('  \u041D\u0435\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0445 \u0437\u0430\u0434\u0430\u0447 \u0441\u0435\u0433\u043E\u0434\u043D\u044F');
  } else {
    for (const task of completedTasks) {
      const icon = getPriorityIcon(task.priority);
      lines.push(`  ${icon} ${escTg(task.title)}`);
    }
  }
  lines.push('');

  // Remaining tasks
  lines.push('\u{1F6A7} *\u041D\u0415 \u0417\u0410\u0412\u0415\u0420\u0428\u0415\u041D\u041E:*');
  if (remainingTasks.length === 0) {
    lines.push('  \u0412\u0441\u0435 \u0437\u0430\u0434\u0430\u0447\u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u044B! \u{1F3C6}');
  } else {
    const shown = remainingTasks.slice(0, 10);
    for (const task of shown) {
      const icon = getPriorityIcon(task.priority);
      const stateStr = task.state ? ` [${escTg(task.state)}]` : '';
      lines.push(`  ${icon} ${escTg(task.title)}${stateStr}`);
    }
    if (remainingTasks.length > 10) {
      lines.push(`  ... \u0438 \u0435\u0449\u0451 ${remainingTasks.length - 10} \u0437\u0430\u0434\u0430\u0447`);
    }
  }
  lines.push('');

  // Evening medications reminder
  lines.push('\u{1F48A} *\u0412\u0415\u0427\u0415\u0420\u041D\u0418\u0415 \u041B\u0415\u041A\u0410\u0420\u0421\u0422\u0412\u0410:*');
  const eveningMeds = medications.filter(m => {
    const t = (m.time_of_day || '').toLowerCase();
    return t === 'evening' || t === 'night' || t === 'any';
  });
  if (eveningMeds.length === 0) {
    lines.push('  \u041D\u0435\u0442 \u0432\u0435\u0447\u0435\u0440\u043D\u0438\u0445 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0439');
  } else {
    const medNames = eveningMeds.map(m => {
      const dosageStr = m.dosage ? ` (${escTg(m.dosage)})` : '';
      return `${escTg(m.name)}${dosageStr}`;
    });
    lines.push(`  ${medNames.join(', ')}`);
  }
  lines.push('');

  // Health / streak
  lines.push('\u{1F4CA} *\u0417\u0414\u041E\u0420\u041E\u0412\u042C\u0415:*');
  if (!health) {
    lines.push('  \u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445');
  } else {
    if (health.streak !== undefined && health.streak !== null) {
      lines.push(`  Streak: ${health.streak} \u0434\u043D\u0435\u0439 \u{1F525}`);
    }
    if (health.mood) {
      lines.push(`  \u041D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u0438\u0435: ${escTg(health.mood)}`);
    }
    if (health.energy) {
      lines.push(`  \u042D\u043D\u0435\u0440\u0433\u0438\u044F: ${health.energy}/10`);
    }
  }
  lines.push('');

  // Summary stats
  const total = completedTasks.length + remainingTasks.length;
  const pct = total > 0 ? Math.round((completedTasks.length / total) * 100) : 0;
  lines.push(`\u{1F4C8} *\u041F\u0440\u043E\u0434\u0443\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C:* ${completedTasks.length}/${total} \u0437\u0430\u0434\u0430\u0447 (${pct}%)`);
  lines.push('');

  // Footer
  lines.push('\u0421\u043F\u043E\u043A\u043E\u0439\u043D\u043E\u0439 \u043D\u043E\u0447\u0438! \u{1F303}');

  return lines.join('\n');
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * GET /api/v3/integrations/morning-briefing
 * Generate and send a morning briefing via Telegram
 */
router.get('/morning-briefing', async (req, res) => {
  try {
    log.info('Generating morning briefing');

    const { todayStr, todayLabel } = getTodayBounds();

    // Fetch all data in parallel
    const [events, tasks, health, medications] = await Promise.all([
      fetchTodayEvents(todayStr),
      fetchSprintTasks(),
      fetchHealthMetrics(),
      fetchMedications(),
    ]);

    // Format the message
    const message = formatMorningBriefing({
      todayLabel,
      events,
      tasks,
      health,
      medications,
    });

    // Send to forum topic (not DM) — schedule topic for morning briefing
    const tgResult = await sendToTopic('schedule', message);

    log.info({
      eventsCount: events.length,
      tasksCount: tasks.length,
      hasMedications: medications.length > 0,
      hasHealth: !!health,
      telegramSuccess: tgResult.success,
      topic: 'schedule',
    }, 'Morning briefing sent to topic');

    return success(res, {
      message,
      telegram: tgResult,
      stats: {
        events: events.length,
        active_tasks: tasks.length,
        medications: medications.length,
        has_health_data: !!health,
      },
      date: todayStr,
    });
  } catch (err) {
    log.error({ err }, 'Failed to generate morning briefing');
    return error(res, 'BRIEFING_FAILED', `Failed to generate morning briefing: ${err.message}`, 500);
  }
});

/**
 * GET /api/v3/integrations/evening-checkin
 * Generate and send an evening check-in via Telegram
 */
router.get('/evening-checkin', async (req, res) => {
  try {
    log.info('Generating evening check-in');

    const { todayStr, todayLabel } = getTodayBounds();

    // Fetch all data in parallel
    const [completedTasks, remainingTasks, health, medications] = await Promise.all([
      fetchCompletedToday(todayStr),
      fetchSprintTasks(), // These are still active (not done)
      fetchHealthMetrics(),
      fetchMedications(),
    ]);

    // Format the message
    const message = formatEveningCheckin({
      todayLabel,
      completedTasks,
      remainingTasks,
      medications,
      health,
    });

    // Send to forum topic (not DM) — tasks topic for evening check-in
    const tgResult = await sendToTopic('tasks', message);

    log.info({
      completedCount: completedTasks.length,
      remainingCount: remainingTasks.length,
      telegramSuccess: tgResult.success,
      topic: 'tasks',
    }, 'Evening check-in sent to topic');

    return success(res, {
      message,
      telegram: tgResult,
      stats: {
        completed_today: completedTasks.length,
        remaining: remainingTasks.length,
        productivity_pct: completedTasks.length + remainingTasks.length > 0
          ? Math.round((completedTasks.length / (completedTasks.length + remainingTasks.length)) * 100)
          : 0,
        medications: medications.length,
        has_health_data: !!health,
      },
      date: todayStr,
    });
  } catch (err) {
    log.error({ err }, 'Failed to generate evening check-in');
    return error(res, 'CHECKIN_FAILED', `Failed to generate evening check-in: ${err.message}`, 500);
  }
});

export default router;
