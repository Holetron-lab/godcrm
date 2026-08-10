/**
 * Briefing — Public API / Generators
 *
 * generateMorningBriefing, generateEveningCheckin,
 * sendWellnessReminder, generateWellnessSchedule
 */

import { sendToTopic } from '../TelegramService.js';
import { log, getTodayBounds, escTg } from './constants.js';
import {
  fetchTodayEvents, fetchSprintTasks, fetchHealthMetrics,
  fetchMedications, fetchCompletedToday,
  fetchWellnessSchedule, fetchAtomicHabits,
} from './fetchers.js';
import { formatMorningBriefing, formatEveningCheckin } from './formatters.js';

// =============================================================================
// PUBLIC API — called by ScheduleTriggerService
// =============================================================================

/**
 * Generate and send morning briefing via Telegram.
 * All briefings are routed to forum topics (not DMs).
 * @param {Object} config - { topic?: string }
 * @returns {Promise<{success: boolean, stats: Object}>}
 */
export async function generateMorningBriefing(config = {}) {
  // Route to forum topic — default: schedule
  const topic = config.topic || 'schedule';

  log.info({ topic }, 'Generating morning briefing \u2192 topic');

  const { todayStr, todayLabel } = getTodayBounds();

  const [events, tasks, health, medications] = await Promise.all([
    fetchTodayEvents(todayStr),
    fetchSprintTasks(),
    fetchHealthMetrics(),
    fetchMedications(),
  ]);

  // Single message for the household (no per-user DM)
  const message = formatMorningBriefing({ todayLabel, events, tasks, health, medications, recipientName: '\u043a\u043e\u043c\u0430\u043d\u0434\u0430' });
  const res = await sendToTopic(topic, message);

  log.info({
    topic,
    eventsCount: events.length,
    tasksCount: tasks.length,
    telegramSuccess: res.success,
  }, 'Morning briefing sent to topic');

  return {
    success: res.success,
    stats: {
      events: events.length,
      active_tasks: tasks.length,
      medications: medications.length,
      has_health_data: !!health,
    },
    telegram: [{ topic, success: res.success }],
    date: todayStr,
  };
}

/**
 * Generate and send evening check-in via Telegram.
 * All check-ins are routed to forum topics (not DMs).
 * @param {Object} config - { topic?: string }
 * @returns {Promise<{success: boolean, stats: Object}>}
 */
export async function generateEveningCheckin(config = {}) {
  // Route to forum topic — default: tasks (итоги дня = задачи)
  const topic = config.topic || 'tasks';

  log.info({ topic }, 'Generating evening check-in \u2192 topic');

  const { todayStr, todayLabel } = getTodayBounds();

  const [completedTasks, remainingTasks, health, medications] = await Promise.all([
    fetchCompletedToday(todayStr),
    fetchSprintTasks(),
    fetchHealthMetrics(),
    fetchMedications(),
  ]);

  const message = formatEveningCheckin({ todayLabel, completedTasks, remainingTasks, medications, health });
  const res = await sendToTopic(topic, message);

  const total = completedTasks.length + remainingTasks.length;

  log.info({
    topic,
    completedCount: completedTasks.length,
    remainingCount: remainingTasks.length,
    telegramSuccess: res.success,
  }, 'Evening check-in sent to topic');

  return {
    success: res.success,
    stats: {
      completed_today: completedTasks.length,
      remaining: remainingTasks.length,
      productivity_pct: total > 0 ? Math.round((completedTasks.length / total) * 100) : 0,
      medications: medications.length,
      has_health_data: !!health,
    },
    telegram: [{ topic, success: res.success }],
    date: todayStr,
  };
}

// =============================================================================
// WELLNESS SCHEDULE REMINDERS
// =============================================================================

/**
 * Send a wellness reminder to the forum topic (not DMs).
 * Called by ScheduleTriggerService via automation config.
 *
 * @param {Object} config - { message: string, topic?: string, category?: string }
 */
export async function sendWellnessReminder(config = {}) {
  const message = config.message || config.text || 'Wellness reminder';
  // Route to forum topic — default: fitness
  const topic = config.topic || config.category || 'fitness';

  log.info({ topic, messagePreview: message.substring(0, 50) }, 'Sending wellness reminder \u2192 topic');

  const res = await sendToTopic(topic, message);

  return {
    success: res.success,
    telegram: [{ topic, success: res.success }],
  };
}

/**
 * Generate a full daily wellness schedule summary.
 * Can be sent as part of morning briefing or on-demand via /schedule command.
 *
 * @param {Object} config - { chatIds?: string[] }
 */
export async function generateWellnessSchedule(config = {}) {
  const [schedule, habits] = await Promise.all([
    fetchWellnessSchedule(),
    fetchAtomicHabits(),
  ]);

  const lines = [];
  lines.push('\u{1F4CB} *\u0420\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0434\u043d\u044f*');
  lines.push('');

  if (schedule.length === 0) {
    lines.push('\u0420\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043d\u0435 \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u043e');
  } else {
    for (const block of schedule) {
      const timeStr = block.time_start ? `${block.time_start}-${block.time_end}` : '\u23F0';
      const catIcon = {
        Morning: '\u{1F305}', Work: '\u{1F4BB}', Fitness: '\u{1F3CB}',
        Nutrition: '\u{1F372}', Relationship: '\u{2764}\u{FE0F}', Communication: '\u{1F4AC}',
        Creative: '\u{1F3B5}', 'Self-Care': '\u{1F9D8}', Recovery: '\u{1F634}',
      }[block.category] || '\u{1F4CC}';
      lines.push(`${catIcon} \`${timeStr}\` ${escTg(block.block_name)}`);
    }
  }

  if (habits.length > 0) {
    lines.push('');
    lines.push('\u{1F517} *Atomic Habits \u0441\u0442\u0435\u043a\u0438:*');
    for (const h of habits.slice(0, 10)) {
      lines.push(`  \u{27A1}\u{FE0F} ${escTg(h.trigger)} \u2192 ${escTg(h.habit)} (${escTg(h.duration)})`);
    }
    if (habits.length > 10) lines.push(`  ... \u0438 \u0435\u0449\u0451 ${habits.length - 10}`);
  }

  lines.push('');
  lines.push('\u{1F4AA} \u041e\u0442\u043b\u0438\u0447\u043d\u043e\u0433\u043e \u0434\u043d\u044f!');

  const message = lines.join('\n');

  // Route to forum topic — default: schedule
  const topic = config.topic || 'schedule';

  log.info({ topic }, 'Sending wellness schedule \u2192 topic');

  const res = await sendToTopic(topic, message);

  return {
    success: res.success,
    telegram: [{ topic, success: res.success }],
    stats: { schedule_blocks: schedule.length, habits: habits.length },
  };
}
