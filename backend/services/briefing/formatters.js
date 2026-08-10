/**
 * Briefing — Message Formatters
 *
 * formatMorningBriefing, formatEveningCheckin
 */

import { getPriorityIcon, escTg } from './constants.js';

// =============================================================================
// MESSAGE FORMATTERS
// =============================================================================

export function formatMorningBriefing({ todayLabel, events, tasks, health, medications, recipientName }) {
  const lines = [];

  const name = recipientName || '\u0413\u0435\u0440\u0430';
  lines.push(`\u2600\uFE0F *\u0414\u043e\u0431\u0440\u043e\u0435 \u0443\u0442\u0440\u043e, ${escTg(name)}!*`);
  lines.push('');
  lines.push(`\u{1F4C5} *\u0421\u0415\u0413\u041e\u0414\u041d\u042f* (${escTg(todayLabel)}):`);
  lines.push('');

  // Calendar
  lines.push('\u{1F4C6} *\u041a\u0410\u041b\u0415\u041d\u0414\u0410\u0420\u042c:*');
  if (events.length === 0) {
    lines.push('  \u041d\u0435\u0442 \u0441\u043e\u0431\u044b\u0442\u0438\u0439 \u043d\u0430 \u0441\u0435\u0433\u043e\u0434\u043d\u044f');
  } else {
    for (const event of events) {
      const timeStr = event.time === '\u0432\u0435\u0441\u044c \u0434\u0435\u043d\u044c' ? '\u{1F30D} \u0432\u0435\u0441\u044c \u0434\u0435\u043d\u044c' : event.time;
      const loc = event.location ? ` (\u{1F4CD}${escTg(event.location)})` : '';
      lines.push(`  ${timeStr} \u2014 ${escTg(event.title)}${loc}`);
    }
  }
  lines.push('');

  // Tasks
  lines.push('\u{1F4CB} *\u0417\u0410\u0414\u0410\u0427\u0418 (Sprint):*');
  if (tasks.length === 0) {
    lines.push('  \u0412\u0441\u0435 \u0437\u0430\u0434\u0430\u0447\u0438 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u044b! \u{1F389}');
  } else {
    const shown = tasks.slice(0, 15);
    for (const task of shown) {
      const icon = getPriorityIcon(task.priority);
      const pLabel = task.priority ? String(task.priority).toUpperCase() + ': ' : '';
      const stateStr = task.state ? ` [${escTg(task.state)}]` : '';
      lines.push(`  ${icon} ${pLabel}${escTg(task.title)}${stateStr}`);
    }
    if (tasks.length > 15) lines.push(`  ... \u0438 \u0435\u0449\u0451 ${tasks.length - 15} \u0437\u0430\u0434\u0430\u0447`);
  }
  lines.push('');

  // Medications
  lines.push('\u{1F48A} *\u041b\u0415\u041a\u0410\u0420\u0421\u0422\u0412\u0410/\u0414\u041e\u0411\u0410\u0412\u041a\u0418:*');
  if (medications.length === 0) {
    lines.push('  \u041d\u0435\u0442 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0439');
  } else {
    const groups = {};
    for (const med of medications) {
      const time = med.time_of_day || 'any';
      if (!groups[time]) groups[time] = [];
      const dosageStr = med.dosage ? ` (${escTg(med.dosage)})` : '';
      groups[time].push(`${escTg(med.name)}${dosageStr}`);
    }
    const timeLabels = { morning: '\u0423\u0442\u0440\u043e', afternoon: '\u0414\u0435\u043d\u044c', evening: '\u0412\u0435\u0447\u0435\u0440', night: '\u041d\u043e\u0447\u044c', any: '\u041b\u044e\u0431\u043e\u0435 \u0432\u0440\u0435\u043c\u044f' };
    for (const [time, meds] of Object.entries(groups)) {
      lines.push(`  ${timeLabels[time.toLowerCase()] || escTg(time)}: ${meds.join(', ')}`);
    }
  }
  lines.push('');

  // Health
  lines.push('\u{1F4CA} *\u0417\u0414\u041e\u0420\u041e\u0412\u042c\u0415:*');
  if (!health) {
    lines.push('  \u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445');
  } else {
    if (health.streak !== undefined && health.streak !== null) lines.push(`  Streak: ${health.streak} \u0434\u043d\u0435\u0439`);
    if (health.weight) lines.push(`  \u0412\u0435\u0441: ${health.weight} kg`);
    if (health.steps) lines.push(`  \u0428\u0430\u0433\u0438: ${health.steps}`);
    if (health.sleep_hours) lines.push(`  \u0421\u043e\u043d: ${health.sleep_hours}h`);
    if (health.mood) lines.push(`  \u041d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u0435: ${escTg(health.mood)}`);
    if (health.energy) lines.push(`  \u042d\u043d\u0435\u0440\u0433\u0438\u044f: ${health.energy}/10`);
    const hasSpecific = health.streak || health.weight || health.steps || health.sleep_hours || health.mood || health.energy;
    if (!hasSpecific) lines.push(`  \u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u0437\u0430\u043f\u0438\u0441\u044c: ${health._recorded_at || 'N/A'}`);
  }
  lines.push('');
  lines.push('\u0425\u043e\u0440\u043e\u0448\u0435\u0433\u043e \u0434\u043d\u044f! \u{1F4AA}');

  return lines.join('\n');
}

export function formatEveningCheckin({ todayLabel, completedTasks, remainingTasks, medications, health }) {
  const lines = [];

  lines.push('\u{1F319} *\u0412\u0435\u0447\u0435\u0440\u043d\u0438\u0439 \u0447\u0435\u043a-\u0438\u043d*');
  lines.push('');
  lines.push(`\u{1F4C5} *\u0418\u0422\u041e\u0413\u0418 \u0414\u041d\u042f* (${escTg(todayLabel)}):`);
  lines.push('');

  // Completed
  lines.push('\u2705 *\u0421\u0414\u0415\u041b\u0410\u041d\u041e:*');
  if (completedTasks.length === 0) {
    lines.push('  \u041d\u0435\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u044b\u0445 \u0437\u0430\u0434\u0430\u0447 \u0441\u0435\u0433\u043e\u0434\u043d\u044f');
  } else {
    for (const task of completedTasks) {
      lines.push(`  ${getPriorityIcon(task.priority)} ${escTg(task.title)}`);
    }
  }
  lines.push('');

  // Remaining
  lines.push('\u{1F6A7} *\u041d\u0415 \u0417\u0410\u0412\u0415\u0420\u0428\u0415\u041d\u041e:*');
  if (remainingTasks.length === 0) {
    lines.push('  \u0412\u0441\u0435 \u0437\u0430\u0434\u0430\u0447\u0438 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u044b! \u{1F3C6}');
  } else {
    const shown = remainingTasks.slice(0, 10);
    for (const task of shown) {
      const stateStr = task.state ? ` [${escTg(task.state)}]` : '';
      lines.push(`  ${getPriorityIcon(task.priority)} ${escTg(task.title)}${stateStr}`);
    }
    if (remainingTasks.length > 10) lines.push(`  ... \u0438 \u0435\u0449\u0451 ${remainingTasks.length - 10} \u0437\u0430\u0434\u0430\u0447`);
  }
  lines.push('');

  // Evening meds
  lines.push('\u{1F48A} *\u0412\u0415\u0427\u0415\u0420\u041d\u0418\u0415 \u041b\u0415\u041a\u0410\u0420\u0421\u0422\u0412\u0410:*');
  const eveningMeds = medications.filter(m => {
    const t = (m.time_of_day || '').toLowerCase();
    return t === 'evening' || t === 'night' || t === 'any';
  });
  if (eveningMeds.length === 0) {
    lines.push('  \u041d\u0435\u0442 \u0432\u0435\u0447\u0435\u0440\u043d\u0438\u0445 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0439');
  } else {
    lines.push(`  ${eveningMeds.map(m => `${escTg(m.name)}${m.dosage ? ` (${escTg(m.dosage)})` : ''}`).join(', ')}`);
  }
  lines.push('');

  // Health
  lines.push('\u{1F4CA} *\u0417\u0414\u041e\u0420\u041e\u0412\u042c\u0415:*');
  if (!health) {
    lines.push('  \u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445');
  } else {
    if (health.streak !== undefined && health.streak !== null) lines.push(`  Streak: ${health.streak} \u0434\u043d\u0435\u0439 \u{1F525}`);
    if (health.mood) lines.push(`  \u041d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u0435: ${escTg(health.mood)}`);
    if (health.energy) lines.push(`  \u042d\u043d\u0435\u0440\u0433\u0438\u044f: ${health.energy}/10`);
  }
  lines.push('');

  // Productivity
  const total = completedTasks.length + remainingTasks.length;
  const pct = total > 0 ? Math.round((completedTasks.length / total) * 100) : 0;
  lines.push(`\u{1F4C8} *\u041f\u0440\u043e\u0434\u0443\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c:* ${completedTasks.length}/${total} \u0437\u0430\u0434\u0430\u0447 (${pct}%)`);
  lines.push('');
  lines.push('\u0421\u043f\u043e\u043a\u043e\u0439\u043d\u043e\u0439 \u043d\u043e\u0447\u0438! \u{1F303}');

  return lines.join('\n');
}
