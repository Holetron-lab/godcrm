// backend/routes/v3/telegramNikitron/pipeline.js
// Sprint and life pipeline command handlers: /sprint, /today, /done, /weight, /mood, /week

import { apiLogger } from '../../../utils/logger.js';
import { dbRun, dbGet, dbAll, isPostgres, safeJsonParse } from '../../../database/connection.js';
import { sendMessage } from './shared.js';

export async function handleSprint(chatId) {
  try {
    const rows = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND (data->>'state') NOT IN ('Done', 'Archive')
           ORDER BY
             CASE data->>'priority'
               WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4
             END ASC, id DESC`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2649
             AND json_extract(data, '$.state') NOT IN ('Done', 'Archive')
           ORDER BY id DESC`
    );

    if (!rows || rows.length === 0) {
      await sendMessage(chatId, '*Sprint* — нет активных задач.');
      return;
    }

    const groups = {};
    for (const row of rows) {
      const d = safeJsonParse(row.data, {});
      const prio = d.priority || 'No Priority';
      if (!groups[prio]) groups[prio] = [];
      groups[prio].push({ id: row.id, ...d });
    }

    const prioEmoji = { P1: 'P1', P2: 'P2', P3: 'P3' };
    const stateMap = { 'In Progress': 'WIP', 'To Do': 'TODO', 'Backlog': 'BL', 'Review': 'REV', 'Blocked': 'BLOCK' };
    let msg = `*Sprint* — ${rows.length} задач\n\n`;

    for (const prio of ['P1', 'P2', 'P3', 'No Priority']) {
      const items = groups[prio];
      if (!items || items.length === 0) continue;
      msg += `*${prioEmoji[prio] || prio}* (${items.length})\n`;
      for (const item of items) {
        const st = stateMap[item.state] || item.state || '';
        const title = (item.title || item.name || 'Untitled').substring(0, 55);
        msg += `  \`#${item.id || ''}\` [${st}] ${title}\n`;
      }
      msg += '\n';
    }
    msg += '`/done <id>` — завершить';
    await sendMessage(chatId, msg);
  } catch (err) {
    apiLogger.error({ err }, '[NikitronBot] /sprint failed');
    await sendMessage(chatId, 'Ошибка загрузки спринта.');
  }
}

export async function handleToday(chatId) {
  try {
    const tasks = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2649 AND (data->>'state') NOT IN ('Done', 'Archive')
           ORDER BY CASE data->>'priority' WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END ASC
           LIMIT 10`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2649 AND json_extract(data, '$.state') NOT IN ('Done', 'Archive')
           ORDER BY id DESC LIMIT 10`
    );

    const doneToday = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2649 AND (data->>'state') = 'Done'
             AND (data->>'completed_date')::date = CURRENT_DATE`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2649 AND json_extract(data, '$.state') = 'Done'
             AND date(json_extract(data, '$.completed_date')) = date('now')`
    );

    const healthMetrics = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows
           WHERE table_id = 2643 AND (data->>'recorded_at')::date = CURRENT_DATE
           ORDER BY created_at DESC`
        : `SELECT id, data FROM table_rows
           WHERE table_id = 2643 AND date(json_extract(data, '$.recorded_at')) = date('now')
           ORDER BY created_at DESC`
    );

    const dateStr = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    let msg = `*Брифинг*\n${dateStr}\n\n`;

    msg += `*Задачи* (${(tasks || []).length} активных):\n`;
    if (tasks && tasks.length > 0) {
      for (const row of tasks) {
        const d = safeJsonParse(row.data, {});
        const prio = d.priority ? `[${d.priority}]` : '';
        const title = (d.title || d.name || 'Untitled').substring(0, 50);
        msg += `  ${prio} ${title}\n`;
      }
    } else {
      msg += '  _Нет активных задач_\n';
    }
    msg += '\n';

    if (doneToday && doneToday.length > 0) {
      msg += `*Завершено сегодня:* ${doneToday.length}\n`;
      for (const row of doneToday) {
        const d = safeJsonParse(row.data, {});
        msg += `  ${(d.title || d.name || 'Untitled').substring(0, 50)}\n`;
      }
      msg += '\n';
    }

    if (healthMetrics && healthMetrics.length > 0) {
      msg += '*Здоровье:*\n';
      for (const row of healthMetrics) {
        const d = safeJsonParse(row.data, {});
        if (d.metric_type === 'weight') msg += `  Вес: ${d.value} ${d.unit || 'кг'}\n`;
        else if (d.metric_type === 'mood') msg += `  Настроение: ${d.value}/10\n`;
        else msg += `  ${d.metric_type}: ${d.value}\n`;
      }
      msg += '\n';
    }

    msg += '`/sprint` — все задачи | `/done <id>` — завершить';
    await sendMessage(chatId, msg);
  } catch (err) {
    apiLogger.error({ err }, '[NikitronBot] /today failed');
    await sendMessage(chatId, 'Ошибка загрузки брифинга.');
  }
}

export async function handleDone(chatId, text) {
  const rowId = parseInt(text.split(/\s+/)[1], 10);
  if (!rowId || isNaN(rowId)) {
    await sendMessage(chatId, 'Использование: `/done <id>`\nПример: `/done 1234`');
    return;
  }

  try {
    const row = await dbGet(
      isPostgres()
        ? `SELECT id, data FROM table_rows WHERE id = $1 AND table_id = 2649`
        : `SELECT id, data FROM table_rows WHERE id = ? AND table_id = 2649`,
      [rowId]
    );

    if (!row) {
      await sendMessage(chatId, `Задача #${rowId} не найдена в спринте.`);
      return;
    }

    const now = new Date().toISOString();
    if (isPostgres()) {
      await dbRun(
        `UPDATE table_rows
         SET data = jsonb_set(jsonb_set(data, '{state}', '"Done"'), '{completed_date}', $1::jsonb),
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
    await sendMessage(chatId, `*Задача завершена!*\n\n*#${rowId}* — ${title}`);
  } catch (err) {
    apiLogger.error({ err, rowId }, '[NikitronBot] /done failed');
    await sendMessage(chatId, `Ошибка при завершении задачи #${rowId}.`);
  }
}

export async function handleWeight(chatId, text) {
  const value = parseFloat(text.split(/\s+/)[1]);
  if (!value || isNaN(value) || value < 20 || value > 300) {
    await sendMessage(chatId, 'Использование: `/weight <кг>`\nПример: `/weight 75.5`');
    return;
  }

  try {
    const rowData = JSON.stringify({
      metric_type: 'weight', value, unit: 'kg',
      recorded_at: new Date().toISOString(),
    });

    if (isPostgres()) {
      await dbRun(`INSERT INTO table_rows (table_id, data, created_at, updated_at) VALUES (2643, $1::jsonb, NOW(), NOW())`, [rowData]);
    } else {
      await dbRun(`INSERT INTO table_rows (table_id, data, created_at, updated_at) VALUES (2643, ?, datetime('now'), datetime('now'))`, [rowData]);
    }
    await sendMessage(chatId, `Вес записан: ${value} кг`);
  } catch (err) {
    apiLogger.error({ err, value }, '[NikitronBot] /weight failed');
    await sendMessage(chatId, 'Ошибка записи веса.');
  }
}

export async function handleMood(chatId, text) {
  const value = parseInt(text.split(/\s+/)[1], 10);
  if (!value || isNaN(value) || value < 1 || value > 10) {
    await sendMessage(chatId, 'Использование: `/mood <1-10>`\nПример: `/mood 7`');
    return;
  }

  try {
    const rowData = JSON.stringify({
      metric_type: 'mood', value,
      recorded_at: new Date().toISOString(),
    });

    if (isPostgres()) {
      await dbRun(`INSERT INTO table_rows (table_id, data, created_at, updated_at) VALUES (2643, $1::jsonb, NOW(), NOW())`, [rowData]);
    } else {
      await dbRun(`INSERT INTO table_rows (table_id, data, created_at, updated_at) VALUES (2643, ?, datetime('now'), datetime('now'))`, [rowData]);
    }
    await sendMessage(chatId, `Настроение записано: ${value}/10`);
  } catch (err) {
    apiLogger.error({ err, value }, '[NikitronBot] /mood failed');
    await sendMessage(chatId, 'Ошибка записи настроения.');
  }
}

export async function handleWeek(chatId) {
  try {
    const allTasks = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows WHERE table_id = 2649
           AND ((data->>'state') NOT IN ('Archive')
             OR ((data->>'completed_date') IS NOT NULL
               AND (data->>'completed_date')::date >= date_trunc('week', CURRENT_DATE)))`
        : `SELECT id, data FROM table_rows WHERE table_id = 2649
           AND (json_extract(data, '$.state') != 'Archive'
             OR (json_extract(data, '$.completed_date') IS NOT NULL
               AND date(json_extract(data, '$.completed_date')) >= date('now', 'weekday 1', '-7 days')))`
    );

    const doneThisWeek = await dbAll(
      isPostgres()
        ? `SELECT id, data FROM table_rows WHERE table_id = 2649
           AND (data->>'state') = 'Done'
           AND (data->>'completed_date') IS NOT NULL
           AND (data->>'completed_date')::date >= date_trunc('week', CURRENT_DATE)`
        : `SELECT id, data FROM table_rows WHERE table_id = 2649
           AND json_extract(data, '$.state') = 'Done'
           AND json_extract(data, '$.completed_date') IS NOT NULL
           AND date(json_extract(data, '$.completed_date')) >= date('now', 'weekday 1', '-7 days')`
    );

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

    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const fmtDate = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

    let msg = `*Итоги недели*\n${fmtDate(weekStart)} — ${fmtDate(weekEnd)}\n\n`;

    const barLen = 10;
    const filled = Math.round((completionRate / 100) * barLen);
    const bar = '='.repeat(filled) + '-'.repeat(barLen - filled);
    msg += `*Прогресс:* [${bar}] ${completionRate}%\n`;
    msg += `Завершено: ${doneCount} | Активных: ${totalActive}\n\n`;

    msg += '*По статусам:*\n';
    for (const [state, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
      msg += `  ${state}: ${count}\n`;
    }
    msg += '\n';

    if (doneThisWeek && doneThisWeek.length > 0) {
      msg += '*Завершено на этой неделе:*\n';
      for (const row of doneThisWeek.slice(0, 10)) {
        const d = safeJsonParse(row.data, {});
        msg += `  ${(d.title || d.name || 'Untitled').substring(0, 50)}\n`;
      }
    }

    await sendMessage(chatId, msg);
  } catch (err) {
    apiLogger.error({ err }, '[NikitronBot] /week failed');
    await sendMessage(chatId, 'Ошибка загрузки недельной сводки.');
  }
}
