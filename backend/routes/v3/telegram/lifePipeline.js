// backend/routes/v3/telegram/lifePipeline.js
// Life Pipeline quick commands: /sprint, /today, /done, /weight, /mood

import { apiLogger, sendMessage, dbRun, dbGet, dbAll, isPostgres, safeJsonParse } from './shared.js';

/**
 * Handle /sprint command — Show current sprint tasks.
 */
export async function handleSprint(chatId) {
  try {
    const rows = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND (data->>'state') NOT IN ('Done', 'Archive')
           ORDER BY
             CASE data->>'priority'
               WHEN 'P1' THEN 1
               WHEN 'P2' THEN 2
               WHEN 'P3' THEN 3
               ELSE 4
             END ASC,
             id DESC`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND json_extract(data, '$.state') NOT IN ('Done', 'Archive')
           ORDER BY id DESC`
    );

    if (!rows || rows.length === 0) {
      await sendMessage(chatId, '📋 *Sprint* — нет активных задач.');
      return;
    }

    // Group by priority
    const groups = {};
    for (const row of rows) {
      const d = safeJsonParse(row.data, {});
      const prio = d.priority || 'No Priority';
      if (!groups[prio]) groups[prio] = [];
      groups[prio].push({ id: row.id, ...d });
    }

    const prioEmoji = { P1: '🔴', P2: '🟠', P3: '🟡' };
    const stateEmoji = { 'In Progress': '🔄', 'To Do': '📌', 'Backlog': '📥', 'Review': '👀', 'Blocked': '🚫' };
    let msg = `📋 *Sprint* — ${rows.length} задач(а)\n\n`;

    for (const prio of ['P1', 'P2', 'P3', 'No Priority']) {
      const items = groups[prio];
      if (!items || items.length === 0) continue;
      msg += `${prioEmoji[prio] || '⚪'} *${prio}* (${items.length})\n`;
      for (const item of items) {
        const st = stateEmoji[item.state] || '▪️';
        const title = (item.title || item.name || 'Untitled').substring(0, 60);
        msg += `  ${st} \`#${item.id || ''}\` ${title}\n`;
      }
      msg += '\n';
    }

    msg += '✅ Отметить: `/done <id>`';
    await sendMessage(chatId, msg);
  } catch (err) {
    apiLogger.error({ err }, '[Telegram] /sprint command failed');
    await sendMessage(chatId, '❌ Ошибка загрузки спринта.');
  }
}

/**
 * Handle /today command — Morning briefing on demand (calendar + tasks + health).
 */
export async function handleToday(chatId) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Active sprint tasks (not Done/Archive)
    const tasks = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND (data->>'state') NOT IN ('Done', 'Archive')
           ORDER BY
             CASE data->>'priority'
               WHEN 'P1' THEN 1
               WHEN 'P2' THEN 2
               WHEN 'P3' THEN 3
               ELSE 4
             END ASC
           LIMIT 10`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND json_extract(data, '$.state') NOT IN ('Done', 'Archive')
           ORDER BY id DESC
           LIMIT 10`
    );

    // Today's completed tasks
    const doneToday = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND (data->>'state') = 'Done'
             AND (data->>'completed_date')::date = CURRENT_DATE`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND json_extract(data, '$.state') = 'Done'
             AND date(json_extract(data, '$.completed_date')) = date('now')`
    );

    // Today's health metrics
    const healthMetrics = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2643
             AND (data->>'recorded_at')::date = CURRENT_DATE
           ORDER BY created_at DESC`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2643
             AND date(json_extract(data, '$.recorded_at')) = date('now')
           ORDER BY created_at DESC`
    );

    // Calendar events for today
    let calendarEvents = [];
    try {
      calendarEvents = await dbAll(
        isPostgres()
          ? `SELECT id, data FROM table_rows
             WHERE table_id IN (SELECT id FROM tables WHERE name ILIKE '%calendar%' LIMIT 1)
               AND (data->>'start_time')::date = CURRENT_DATE
             ORDER BY data->>'start_time' ASC
             LIMIT 10`
          : `SELECT id, data FROM table_rows
             WHERE table_id IN (SELECT id FROM tables WHERE name LIKE '%calendar%' LIMIT 1)
               AND date(json_extract(data, '$.start_time')) = date('now')
             ORDER BY json_extract(data, '$.start_time') ASC
             LIMIT 10`
      );
    } catch (_) { /* calendar table may not exist */ }

    // Build message
    const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    let msg = `☀️ *Брифинг на сегодня*\n📅 ${dateStr}\n\n`;

    // Calendar section
    if (calendarEvents && calendarEvents.length > 0) {
      msg += '🗓 *Календарь:*\n';
      for (const evt of calendarEvents) {
        const d = safeJsonParse(evt.data, {});
        const time = d.start_time ? new Date(d.start_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
        const title = d.title || d.summary || d.name || 'Событие';
        msg += `  🕐 ${time} — ${title}\n`;
      }
      msg += '\n';
    } else {
      msg += '🗓 *Календарь:* нет событий\n\n';
    }

    // Tasks section
    msg += `📋 *Задачи* (${(tasks || []).length} активных):\n`;
    if (tasks && tasks.length > 0) {
      for (const row of tasks) {
        const d = safeJsonParse(row.data, {});
        const prio = d.priority ? `[${d.priority}]` : '';
        const title = (d.title || d.name || 'Untitled').substring(0, 50);
        msg += `  ▪️ ${prio} ${title}\n`;
      }
    } else {
      msg += '  _Нет активных задач_\n';
    }
    msg += '\n';

    // Done today
    if (doneToday && doneToday.length > 0) {
      msg += `✅ *Завершено сегодня:* ${doneToday.length}\n`;
      for (const row of doneToday) {
        const d = safeJsonParse(row.data, {});
        const title = (d.title || d.name || 'Untitled').substring(0, 50);
        msg += `  ✔️ ${title}\n`;
      }
      msg += '\n';
    }

    // Health section
    if (healthMetrics && healthMetrics.length > 0) {
      msg += '💪 *Здоровье сегодня:*\n';
      for (const row of healthMetrics) {
        const d = safeJsonParse(row.data, {});
        if (d.metric_type === 'weight') {
          msg += `  ⚖️ Вес: ${d.value} ${d.unit || 'кг'}\n`;
        } else if (d.metric_type === 'mood') {
          msg += `  😊 Настроение: ${d.value}/10\n`;
        } else {
          msg += `  📊 ${d.metric_type}: ${d.value}\n`;
        }
      }
      msg += '\n';
    }

    msg += '💡 `/sprint` — все задачи | `/done <id>` — завершить';
    await sendMessage(chatId, msg);
  } catch (err) {
    apiLogger.error({ err }, '[Telegram] /today command failed');
    await sendMessage(chatId, '❌ Ошибка загрузки брифинга.');
  }
}

/**
 * Handle /done command — Mark a sprint task as Done.
 */
export async function handleDone(chatId, text) {
  const parts = text.split(/\s+/);
  const rowId = parseInt(parts[1], 10);

  if (!rowId || isNaN(rowId)) {
    await sendMessage(chatId, '❓ Использование: `/done <id>`\nПример: `/done 1234`');
    return;
  }

  try {
    // Verify the row exists and belongs to the sprint table
    const row = await dbGet(
      isPostgres()
        ? `SELECT id, data FROM table_rows WHERE id = $1 AND table_id = 2649`
        : `SELECT id, data FROM table_rows WHERE id = ? AND table_id = 2649`,
      [rowId]
    );

    if (!row) {
      await sendMessage(chatId, `❌ Задача #${rowId} не найдена в спринте.`);
      return;
    }

    const now = new Date().toISOString();

    // Update state to Done and set completed_date
    if (isPostgres()) {
      await dbRun(
        `UPDATE table_rows
         SET data = jsonb_set(
           jsonb_set(data, '{state}', '"Done"'),
           '{completed_date}', $1::jsonb
         ),
         updated_at = NOW()
         WHERE id = $2 AND table_id = 2649`,
        [JSON.stringify(now), rowId]
      );
    } else {
      await dbRun(
        `UPDATE table_rows
         SET data = json_set(json_set(data, '$.state', 'Done'), '$.completed_date', ?),
         updated_at = datetime('now')
         WHERE id = ? AND table_id = 2649`,
        [now, rowId]
      );
    }

    const d = safeJsonParse(row.data, {});
    const title = (d.title || d.name || 'Untitled').substring(0, 60);

    await sendMessage(chatId,
      `✅ *Задача завершена!*\n\n` +
      `*#${rowId}* — ${title}\n` +
      `📅 ${new Date().toLocaleDateString('ru-RU')}`
    );

    apiLogger.info({ rowId, title }, '[Telegram] Task marked as Done via /done');
  } catch (err) {
    apiLogger.error({ err, rowId }, '[Telegram] /done command failed');
    await sendMessage(chatId, `❌ Ошибка при завершении задачи #${rowId}.`);
  }
}

/**
 * Handle /weight command — Record weight in Health Metrics (table_id = 2643).
 */
export async function handleWeight(chatId, text) {
  const parts = text.split(/\s+/);
  const value = parseFloat(parts[1]);

  if (!value || isNaN(value) || value < 20 || value > 300) {
    await sendMessage(chatId, '❓ Использование: `/weight <кг>`\nПример: `/weight 75.5`');
    return;
  }

  try {
    const now = new Date().toISOString();
    const rowData = JSON.stringify({
      metric_type: 'weight',
      value: value,
      unit: 'kg',
      recorded_at: now
    });

    if (isPostgres()) {
      await dbRun(
        `INSERT INTO table_rows (table_id, data, created_at, updated_at)
         VALUES (2643, $1::jsonb, NOW(), NOW())`,
        [rowData]
      );
    } else {
      await dbRun(
        `INSERT INTO table_rows (table_id, data, created_at, updated_at)
         VALUES (2643, ?, datetime('now'), datetime('now'))`,
        [rowData]
      );
    }

    await sendMessage(chatId, `✅ Вес записан: ${value} кг`);
    apiLogger.info({ value }, '[Telegram] Weight recorded via /weight');
  } catch (err) {
    apiLogger.error({ err, value }, '[Telegram] /weight command failed');
    await sendMessage(chatId, '❌ Ошибка записи веса.');
  }
}

/**
 * Handle /mood command — Record mood in Health Metrics (table_id = 2643).
 */
export async function handleMood(chatId, text) {
  const parts = text.split(/\s+/);
  const value = parseInt(parts[1], 10);

  if (!value || isNaN(value) || value < 1 || value > 10) {
    await sendMessage(chatId, '❓ Использование: `/mood <1-10>`\nПример: `/mood 7`');
    return;
  }

  try {
    const now = new Date().toISOString();
    const rowData = JSON.stringify({
      metric_type: 'mood',
      value: value,
      recorded_at: now
    });

    if (isPostgres()) {
      await dbRun(
        `INSERT INTO table_rows (table_id, data, created_at, updated_at)
         VALUES (2643, $1::jsonb, NOW(), NOW())`,
        [rowData]
      );
    } else {
      await dbRun(
        `INSERT INTO table_rows (table_id, data, created_at, updated_at)
         VALUES (2643, ?, datetime('now'), datetime('now'))`,
        [rowData]
      );
    }

    await sendMessage(chatId, `✅ Настроение записано: ${value}/10`);
    apiLogger.info({ value }, '[Telegram] Mood recorded via /mood');
  } catch (err) {
    apiLogger.error({ err, value }, '[Telegram] /mood command failed');
    await sendMessage(chatId, '❌ Ошибка записи настроения.');
  }
}

