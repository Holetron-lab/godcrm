// backend/routes/v3/telegram/weeklyFortuna.js
// Weekly summary and Fortune Wheel commands: /week, /fortuna, /fortune, /wheel

import { apiLogger, sendMessage, sendToTopic, dbAll, isPostgres, safeJsonParse, spinFortuneWheel } from './shared.js';

/**
 * Handle /week command — Weekly summary (tasks by status for current week).
 */
export async function handleWeek(chatId) {
  try {
    // All tasks that were active or completed this week
    const allTasks = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND (
               (data->>'state') NOT IN ('Archive')
               OR (
                 (data->>'completed_date') IS NOT NULL
                 AND (data->>'completed_date')::date >= date_trunc('week', CURRENT_DATE)
               )
             )`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND (
               json_extract(data, '$.state') != 'Archive'
               OR (
                 json_extract(data, '$.completed_date') IS NOT NULL
                 AND date(json_extract(data, '$.completed_date')) >= date('now', 'weekday 1', '-7 days')
               )
             )`
    );

    // Tasks completed this week
    const doneThisWeek = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND (data->>'state') = 'Done'
             AND (data->>'completed_date') IS NOT NULL
             AND (data->>'completed_date')::date >= date_trunc('week', CURRENT_DATE)`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND json_extract(data, '$.state') = 'Done'
             AND json_extract(data, '$.completed_date') IS NOT NULL
             AND date(json_extract(data, '$.completed_date')) >= date('now', 'weekday 1', '-7 days')`
    );

    // Count by status
    const statusCounts = {};
    let totalActive = 0;
    for (const row of (allTasks || [])) {
      const d = safeJsonParse(row.data, {});
      const state = d.state || 'Unknown';
      statusCounts[state] = (statusCounts[state] || 0) + 1;
      if (state !== 'Done' && state !== 'Archive') totalActive++;
    }

    const doneCount = (doneThisWeek || []).length;
    const totalTracked = totalActive + doneCount;
    const completionRate = totalTracked > 0 ? Math.round((doneCount / totalTracked) * 100) : 0;

    // Week range
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const fmtDate = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

    const stateEmoji = { 'Done': '✅', 'In Progress': '🔄', 'To Do': '📌', 'Backlog': '📥', 'Review': '👀', 'Blocked': '🚫' };

    let msg = `📊 *Итоги недели*\n📅 ${fmtDate(weekStart)} — ${fmtDate(weekEnd)}\n\n`;

    // Completion rate bar
    const barLen = 10;
    const filled = Math.round((completionRate / 100) * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    msg += `*Прогресс:* ${bar} ${completionRate}%\n`;
    msg += `✅ Завершено: ${doneCount} | 📋 Активных: ${totalActive}\n\n`;

    // Status breakdown
    msg += '*По статусам:*\n';
    for (const [state, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
      const emoji = stateEmoji[state] || '▪️';
      msg += `  ${emoji} ${state}: ${count}\n`;
    }
    msg += '\n';

    // List completed this week
    if (doneThisWeek && doneThisWeek.length > 0) {
      msg += '*Завершено на этой неделе:*\n';
      for (const row of doneThisWeek.slice(0, 10)) {
        const d = safeJsonParse(row.data, {});
        const title = (d.title || d.name || 'Untitled').substring(0, 50);
        msg += `  ✔️ ${title}\n`;
      }
      if (doneThisWeek.length > 10) {
        msg += `  _...и ещё ${doneThisWeek.length - 10}_\n`;
      }
    }

    await sendMessage(chatId, msg);
  } catch (err) {
    apiLogger.error({ err }, '[Telegram] /week command failed');
    await sendMessage(chatId, '❌ Ошибка загрузки недельной сводки.');
  }
}

/**
 * Handle /fortuna, /fortune, /wheel command — Fortune Wheel: random break activity.
 */
export async function handleFortuna(chatId) {
  try {
    const { activity, message: fortuneMsg } = spinFortuneWheel();

    // Inline keyboard: Done (+15 pts) / Skip
    const inlineKeyboard = {
      reply_markup: JSON.stringify({
        inline_keyboard: [[
          { text: '✅ Сделал! +15 очков', callback_data: 'fortuna_done' },
          { text: '❌ Пропустить', callback_data: 'fortuna_skip' }
        ]]
      })
    };

    // 1. Send to the Fortune topic in the group (no buttons in topic)
    const topicResult = await sendToTopic('fortune', fortuneMsg);
    if (!topicResult.success) {
      apiLogger.error({ error: topicResult.error }, '[Telegram] Failed to send fortune to topic');
    }

    // 2. Send to user's private chat WITH inline buttons
    await sendMessage(chatId, fortuneMsg, inlineKeyboard);

    apiLogger.info({ activity: activity.name, chatId }, '[Telegram] Fortune wheel spun via /fortuna command');
  } catch (err) {
    apiLogger.error({ err }, '[Telegram] /fortuna command failed');
    await sendMessage(chatId, '❌ Ошибка колеса фортуны. Попробуй ещё раз!');
  }
}
