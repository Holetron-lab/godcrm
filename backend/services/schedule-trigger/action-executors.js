// schedule-trigger/action-executors.js — Action executor functions
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dbGet, dbRun, dbAll } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { sendMessage, sendAdminAlert, sendToTopic, sendChannelPost } from '../TelegramService.js';
import { getSecret } from '../secrets/getSecret.js';
import { generateBaseId } from '../../utils/baseId.js';


const execFileAsync = promisify(execFile);

const LOG_PREFIX = '[ScheduleTrigger]';

// ===== FORTUNE WHEEL — BREAK ACTIVITIES (duplicated from telegram.js for self-containment) =====
const BREAK_ACTIVITIES = [
  // ── Домашние дела (atomic habits: привязка к перерыву) ──
  { emoji: '👕', name: 'Стирка', duration: 3, description: 'Вытащи чистое бельё и поставь стираться грязное. 2 минуты — и дело сделано!' },
  { emoji: '🍽️', name: 'Посудомойка', duration: 5, description: 'Разбери чистую посуду + загрузи грязную. Идеальный микро-перерыв!' },
  { emoji: '🐱', name: 'Поиграй с котиками', duration: 5, description: 'Возьми игрушку и поиграй с котами. Они скучают! Мурчание = антистресс.' },
  { emoji: '🐕', name: 'Поиграй с собакой', duration: 5, description: 'Кинь мячик, потрепли за ушами. Собаке нужно внимание между прогулками!' },
  { emoji: '💪', name: 'Мини-комплекс', duration: 10, description: '10 приседаний + 10 отжиманий + 10 скручиваний + планка 30 сек. Повтори 2 раза.' },
  { emoji: '🧘', name: 'Растяжка стоя', duration: 5, description: 'Подними стол, работай стоя 5 мин. Потянись, разомни шею и плечи.' },
  { emoji: '🚴', name: 'Велостанок', duration: 10, description: 'Садись на велостанок — крути педали и работай! GTA 5 велосипед мод тоже подойдёт.' },
  // ── Классические перерывы ──
  { emoji: '💧', name: 'Водный перерыв', duration: 2, description: 'Выпей стакан воды. Медленно, маленькими глотками. Проверь осанку!' },
  { emoji: '👀', name: 'Гимнастика для глаз', duration: 3, description: 'Посмотри вдаль 20 сек, потом на близкий предмет 20 сек. Повтори 5 раз. Поморгай.' },
  { emoji: '🌬️', name: 'Дыхательная практика', duration: 4, description: 'Техника 4-7-8: вдох 4 сек, задержка 7 сек, выдох 8 сек. 4 цикла.' },
  { emoji: '🧹', name: 'Мини-уборка', duration: 5, description: 'Протри стол, разложи вещи, выброси мусор. Чистое пространство = чистый ум.' },
];

/**
 * Execute a fortune_wheel action: pick random break activity, post to topic + optional recipients.
 */
async function executeFortuneWheel(config, contextData) {
  try {
    const activity = BREAK_ACTIVITIES[Math.floor(Math.random() * BREAK_ACTIVITIES.length)];
    const message =
      `🎡 *КОЛЕСО ФОРТУНЫ!*\n\n` +
      `Выпало: ${activity.emoji} *${activity.name}*\n` +
      `⏱ Время: ${activity.duration} мин\n\n` +
      `${activity.description}\n\n` +
      `_Следующий перерыв через 40 минут!_`;

    // Send ONLY to the fortune topic in group — no DMs
    const topicResult = await sendToTopic('fortune', message);

    apiLogger.info(
      { activity: activity.name, topicSuccess: topicResult.success },
      `${LOG_PREFIX} Fortune wheel executed → topic only`
    );

    return {
      success: topicResult.success,
      activity: activity.name,
      topicResult: { success: topicResult.success },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a webhook / n8n action
 */
async function executeWebhook(config, contextData) {
  try {
    const response = await fetch(config.url, {
      method: config.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers || {})
      },
      body: JSON.stringify({
        data: contextData,
        timestamp: new Date().toISOString(),
        source: 'schedule_trigger'
      })
    });
    return { success: response.ok, status: response.status, statusText: response.statusText };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a create_row action (supports flat and array field mapping formats)
 */
async function executeCreateRow(config, sourceData) {
  try {
    const rawTargetId = config.targetTableId || config.target_table_id;
    const targetTableId = rawTargetId ? parseInt(rawTargetId, 10) : null;
    if (!targetTableId || isNaN(targetTableId)) {
      return { success: false, error: `No valid target table ID specified (got ${rawTargetId})` };
    }

    const newData = {};

    // Format 1: Array of { sourceColumnId, targetColumnId, staticValue }
    const fieldMappings = config.fieldMappings;
    if (Array.isArray(fieldMappings)) {
      for (const mapping of fieldMappings) {
        if (mapping.staticValue !== undefined) {
          newData[mapping.targetColumnId] = mapping.staticValue;
        } else if (mapping.sourceColumnId && sourceData) {
          newData[mapping.targetColumnId] = sourceData[mapping.sourceColumnId];
        }
      }
    }

    // Format 2: Flat object { targetField: sourceField }
    const fieldMapping = config.field_mapping;
    if (fieldMapping && typeof fieldMapping === 'object' && !Array.isArray(fieldMapping)) {
      for (const [targetField, sourceField] of Object.entries(fieldMapping)) {
        newData[targetField] = sourceData ? sourceData[sourceField] : undefined;
      }
    }

    // Static fields
    if (config.static_fields && typeof config.static_fields === 'object') {
      Object.assign(newData, config.static_fields);
    }

    const now = new Date().toISOString();
    const baseId = 'SCHED_' + Math.random().toString(36).substr(2, 8).toUpperCase();

    const result = await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [targetTableId, baseId, JSON.stringify(newData), now, now]
    );

    const createdRowId = result.lastID || result.lastInsertRowid;
    return { success: true, created_row_id: createdRowId, data: newData };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a notification action (telegram, email, slack, in_app)
 */
async function executeNotification(config, contextData) {
  try {
    const { notificationType, recipients, messageTemplate, subject, topic, message_thread_id } = config;

    let text = messageTemplate || JSON.stringify(contextData, null, 2);
    if (messageTemplate) {
      text = messageTemplate.replace(/\{\{(\w+)\}\}/g, (match, field) => {
        return contextData[field] !== undefined ? String(contextData[field]) : match;
      });
    }

    switch (notificationType) {
      case 'telegram': {
        // Route to forum topic — default: notifications
        const targetTopic = topic || 'notifications';

        // Add /fortuna inline button to break/schedule notifications
        const fortunaTopics = ['schedule', 'tasks', 'business', 'fitness', 'notifications'];
        const addFortunaButton = fortunaTopics.includes(targetTopic);
        const topicOptions = addFortunaButton ? {
          reply_markup: JSON.stringify({
            inline_keyboard: [[
              { text: '🎡 /fortuna', callback_data: 'fortuna_spin' }
            ]]
          })
        } : {};

        const res = await sendToTopic(targetTopic, text, topicOptions);

        apiLogger.info(
          { topic: targetTopic, success: res.success, addedFortunaButton: addFortunaButton },
          `${LOG_PREFIX} Notification sent to topic (no DMs)`
        );

        return { success: res.success, type: 'telegram', results: [{ topic: targetTopic, success: res.success }] };
      }
      case 'email':
        return { success: true, type: 'email', message: 'Email notification not yet wired' };
      case 'slack':
        return { success: true, type: 'slack', message: 'Slack notification not yet wired' };
      case 'in_app':
      default:
        return { success: true, type: notificationType || 'in_app', message: 'In-app notification logged' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute an update_field action
 */
async function executeUpdateField(tableId, rowId, config) {
  try {
    const { column_id, value } = config;
    const row = await dbGet('SELECT id, data FROM table_rows WHERE id = ?', [rowId]);
    if (!row) return { success: false, error: 'Row not found' };

    const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    data[column_id] = value;

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(data), new Date().toISOString(), rowId]
    );
    return { success: true, updated: { [column_id]: value } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ===== DEV REPORT — Daily channel post from git history =====

/** Day 1 = Nov 29, 2025 */
const PROJECT_START = new Date('2025-11-29T00:00:00+03:00');

const COMMIT_TYPE_EMOJI = {
  feat: '✨', fix: '🐛', refactor: '♻️', chore: '🔧',
  docs: '📝', test: '🧪', style: '💅', perf: '⚡',
};

/**
 * Compute "time to produce" for each ADR referenced by today's commits.
 *   start  = the ADR's *_initial.md snapshot timestamp (its birth in the registry)
 *   finish = the latest commit today that references that ADR
 * Snapshot timestamp is parsed from the FILENAME only (YYYY-MM-DD_HHMMSS_initial.md),
 * never from file content — per CLAUDE.md the initial snapshot is read-only reference.
 *
 * Splits the span into two intervals so the post can tell them apart:
 *   dustMinutes  = snapshot birth → FIRST build commit (how long it sat marinating)
 *   buildMinutes = first → last build commit today (the actual work burst)
 * When the ADR sat untouched for a long time before today's work (dusty=true), the
 * raw start→finish total is misleading ("ADR — 18 дней") — the post should flex on
 * the dust ("лежал в столе, собрал за вечер") instead of printing that total.
 *
 * Returns [{ adr, startedAt, firstCommitAt, finishedAt, minutes,
 *            dustMinutes, buildMinutes, dusty }] sorted by adr number.
 */
const DUST_THRESHOLD_MIN = 18 * 60; // sat ≥18h untouched before build → "пылился"

// The ADR registry lives in this CRM table; its rows carry a guarded `status`
// column whose every transition is logged in data.plan_verification.audit_log.
// That log is the most truthful "when did this actually move" signal — better
// than guessing from commit times. Override via action_config.adr_registry_table_id.
const ADR_REGISTRY_TABLE_ID = 2197;

/**
 * Read the ADR registry's guarded status column and return, per ADR number,
 * the timestamp of its LAST meaningful status transition (the "когда сменился
 * статус" signal the founder asked for). Reads data.plan_verification.audit_log,
 * keeping only transitions on the human-readable `status` column.
 * Non-critical: any failure returns an empty map — timings still work without it.
 * Returns Map<number, { at: Date, to: string }>.
 */
async function loadAdrStatusChanges(tableId) {
  const out = new Map();
  try {
    const rows = await dbAll(
      `SELECT data FROM table_rows WHERE table_id = $1`,
      [tableId]
    );
    for (const r of rows) {
      let d;
      try { d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch (_) { continue; }
      if (!d) continue;
      const name = `${d.name || ''} ${d.slug || ''}`;
      const m = name.match(/ADR[-\s]?0*(\d+)/i);
      if (!m) continue;
      const num = parseInt(m[1], 10);
      const log = d.plan_verification && Array.isArray(d.plan_verification.audit_log)
        ? d.plan_verification.audit_log : [];
      let best = null;
      for (const e of log) {
        if (!e || !e.at) continue;
        // Only count transitions on the readable `status` column (skip status_id churn)
        if (e.transition && e.transition.column && e.transition.column !== 'status') continue;
        const when = new Date(e.at);
        if (isNaN(when)) continue;
        if (!best || when > best.at) {
          best = { at: when, to: (e.transition && e.transition.to) || e.event || null };
        }
      }
      if (best) out.set(num, best);
    }
  } catch (err) {
    apiLogger.warn({ err }, `${LOG_PREFIX} dev_report: status-change read failed (non-critical)`);
  }
  return out;
}

function computeAdrTimings(commits, repoPath, statusChanges = new Map()) {
  const snapDir = join(repoPath, 'docs', '.snapshots', 'documents');
  if (!existsSync(snapDir)) return [];

  // Map ADR number -> { first, last } commit Date that mentions it
  const commitSpanByAdr = new Map();
  for (const c of commits) {
    const text = `${c.subject || c.description || ''}`;
    const re = /ADR[-\s]?0*(\d+)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const num = parseInt(m[1], 10);
      const when = c.date ? new Date(c.date) : null;
      if (!when || isNaN(when)) continue;
      const prev = commitSpanByAdr.get(num);
      if (!prev) {
        commitSpanByAdr.set(num, { first: when, last: when });
      } else {
        if (when < prev.first) prev.first = when;
        if (when > prev.last) prev.last = when;
      }
    }
  }
  if (commitSpanByAdr.size === 0) return [];

  let snapFolders = [];
  try {
    snapFolders = readdirSync(snapDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (_) {
    return [];
  }

  const timings = [];
  for (const [num, span] of commitSpanByAdr) {
    const { first: firstCommitAt, last: finishedAt } = span;
    const folder = snapFolders.find(f => new RegExp(`^adr-0*${num}(\\D|$)`, 'i').test(f));
    if (!folder) continue;
    let initialFile;
    try {
      initialFile = readdirSync(join(snapDir, folder))
        .filter(f => /_initial\.md$/.test(f))
        .sort()[0];
    } catch (_) { continue; }
    if (!initialFile) continue;
    const ts = initialFile.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/);
    if (!ts) continue;
    // Snapshot stamps are server-local Europe/Moscow time
    const startedAt = new Date(`${ts[1]}-${ts[2]}-${ts[3]}T${ts[4]}:${ts[5]}:${ts[6]}+03:00`);
    if (isNaN(startedAt)) continue;
    const minutes = Math.round((finishedAt - startedAt) / 60000);
    if (minutes < 0) continue; // snapshot newer than commit — skip rather than print nonsense
    const dustMinutes = Math.max(0, Math.round((firstCommitAt - startedAt) / 60000));
    const buildMinutes = Math.max(0, Math.round((finishedAt - firstCommitAt) / 60000));
    const dusty = dustMinutes >= DUST_THRESHOLD_MIN;
    const status = statusChanges.get(num) || null;
    timings.push({
      adr: `ADR-${num}`,
      startedAt, firstCommitAt, finishedAt,
      minutes, dustMinutes, buildMinutes, dusty,
      statusChangedAt: status ? status.at : null,
      statusTo: status ? status.to : null,
    });
  }
  return timings.sort((a, b) => a.adr.localeCompare(b.adr, undefined, { numeric: true }));
}

/** Format a minute count as a short human string: "1 ч 50 мин" / "40 мин". */
function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/** Format a long idle span loosely for the "пылился" flex: days / weeks / months. */
function formatDust(minutes) {
  const days = Math.round(minutes / (60 * 24));
  if (days >= 60) return `${Math.round(days / 30)} месяца+`;
  if (days >= 25) return 'почти месяц';
  if (days >= 12) return `${Math.round(days / 7)} недели`;
  if (days >= 2) return `${days} дней`;
  return 'больше суток';
}

/**
 * Collect git commits + recent content, send to AI for humanization,
 * then publish bilingual posts to Telegram channels.
 *
 * Variant 3: AI-powered dev report with marketer voice.
 *
 * action_config:
 *   period_hours   — look-back window (default 24)
 *   repo_path      — git repo path (default /root/production/business-crm)
 *   channel_en     — English channel chat_id (default @god_crm)
 *   model          — AI model (default gpt-4o-mini)
 *   operator_id    — operator for API key resolution
 */
async function executeDevReport(config, contextData) {
  try {
    const periodHours = config.period_hours || 24;
    const repoPath = config.repo_path || '/root/production/business-crm';
    const channelEn = config.channel_en || '@god_crm';

    // Calculate dev day number
    const now = new Date();
    const mskNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const dayNumber = Math.floor((mskNow - PROJECT_START) / (24 * 60 * 60 * 1000)) + 1;

    // Date labels
    const months_ru = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const dateRu = `${mskNow.getDate()} ${months_ru[mskNow.getMonth()]} ${mskNow.getFullYear()}`;
    const dateEn = mskNow.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Moscow' });

    // ── Step 1: Collect git commits ──
    const since = new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString();
    let commitLines = [];
    try {
      const { stdout } = await execFileAsync('git', [
        'log', `--since=${since}`, '--pretty=format:%h||%s||%an||%aI', '--no-merges',
      ], { cwd: repoPath });
      commitLines = stdout.trim().split('\n').filter(Boolean);
    } catch (gitErr) {
      apiLogger.warn({ err: gitErr }, `${LOG_PREFIX} dev_report: git log failed`);
    }

    if (commitLines.length === 0) {
      apiLogger.info(`${LOG_PREFIX} dev_report: no commits in last ${periodHours}h — skipping`);
      return { success: true, skipped: true, reason: 'no commits' };
    }

    // Parse commits
    const commits = commitLines.map(line => {
      const [hash, subject, author, date] = line.split('||');
      const typeMatch = subject.match(/^(\w+)(?:\(.*?\))?:\s*(.+)/);
      const type = typeMatch ? typeMatch[1].toLowerCase() : 'other';
      const description = typeMatch ? typeMatch[2].trim() : subject.trim();
      return { hash, type, description, author, subject, date };
    });

    // ── Step 1d: Time-to-produce per ADR touched today (start = ADR initial snapshot) ──
    //    Status-change anchor (the guarded `status` column) layered on top — the
    //    truthful "когда сменился статус" signal, used especially for dusty ADRs.
    const adrStatusChanges = await loadAdrStatusChanges(config.adr_registry_table_id || ADR_REGISTRY_TABLE_ID);
    const adrTimings = computeAdrTimings(commits, repoPath, adrStatusChanges);

    // ── Step 1b: Get diff stats for each commit (shows what files changed) ──
    let diffStats = '';
    try {
      const hashes = commits.map(c => c.hash).join(' ');
      const { stdout: diffOut } = await execFileAsync('git', [
        'diff', '--stat', `${commits[commits.length - 1].hash}~1..${commits[0].hash}`,
      ], { cwd: repoPath, timeout: 10_000 });
      diffStats = diffOut.trim();
    } catch (diffErr) {
      // non-critical — just less context for AI
    }

    // ── Step 1c: Context commits (previous 3 days) for sparse days ──
    let contextCommits = '';
    if (commits.length <= 3) {
      try {
        const since3d = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
        const { stdout: ctx } = await execFileAsync('git', [
          'log', `--since=${since3d}`, `--until=${since}`,
          '--pretty=format:%h %s', '--no-merges',
        ], { cwd: repoPath });
        if (ctx.trim()) contextCommits = ctx.trim();
      } catch (_) { /* ignore */ }
    }

    // ── Step 2: Fetch recent chat messages (user + assistant) for context ──
    let recentChatMessages = [];
    try {
      const msgs = await dbAll(
        `SELECT m.content, m.role, m.sender_type, m.created_at,
                c.title as conversation_title
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.created_at >= $1
           AND m.content_type IN ('text', 'markdown')
           AND m.role IN ('user', 'assistant')
           AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
           AND LENGTH(m.content) > 20
         ORDER BY m.created_at DESC
         LIMIT 50`,
        [since]
      );
      recentChatMessages = msgs.map(m => ({
        role: m.role,
        sender: m.sender_type,
        chat: m.conversation_title,
        content: m.content.substring(0, 300),
      }));
    } catch (chatErr) {
      apiLogger.warn({ err: chatErr }, `${LOG_PREFIX} dev_report: failed to fetch chat messages`);
    }

    // ── Step 3: Build AI prompt ──
    const commitsSummary = commits.map(c => `[${c.type}] ${c.description} (${c.hash})`).join('\n');

    // Rotate the second-section flavor by day so the nightly post is never the same
    // shape. All three are NEUTRAL — no comparison with the reader, no flex:
    //   precise — exact production time, stated plainly (strongest when the ADR is fresh)
    //   loose   — soft phrasing, no exact figure ("собрал за вечер") — a breather day
    //   insight — drop the time entirely, share one genuinely interesting pattern
    const SECOND_SECTION_MODES = ['precise', 'loose', 'insight'];
    const sectionMode = SECOND_SECTION_MODES[dayNumber % SECOND_SECTION_MODES.length];

    // TIME-TO-PRODUCE block for the ⏱ section (real numbers, never invented by the model)
    let timingsSummary;
    if (adrTimings.length > 0) {
      const fmt = (d) => d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
      timingsSummary = adrTimings
        .map(t => {
          // The guarded status column — when it last moved, and to what. Most truthful
          // "shipped" marker, and the right anchor to flex on for a long-dusty ADR.
          const statusNote = t.statusChangedAt
            ? ` Status column last moved ${fmt(t.statusChangedAt)}${t.statusTo ? ` → "${t.statusTo}"` : ''} (the real "сменился статус" moment — prefer this over commit time when flexing on shipping).`
            : '';
          if (t.dusty) {
            // Sat untouched a long time before today's burst — flex on the dust, NOT the total.
            const burst = t.buildMinutes > 0 ? formatDuration(t.buildMinutes) : 'за вечер';
            return `${t.adr}: DUSTY — мариновался ${formatDust(t.dustMinutes)} (ADR doc born ${fmt(t.startedAt)}, first work today), then built in ~${burst}. Do NOT cite the total span. Flex on the dust: this one sat in a drawer / gathered dust / I let it marinate, then shipped it in ${burst}. e.g. "этот ADR пылился ${formatDust(t.dustMinutes)} — наконец дошли руки, собрал за ${burst}."${statusNote}`;
          }
          return `${t.adr}: ${formatDuration(t.minutes)} (ADR doc born ${fmt(t.startedAt)} → last commit ${fmt(t.finishedAt)}). Fresh — cite this production time.${statusNote}`;
        })
        .join('\n');
    } else {
      // No ADR tag in today's commits — give the model the raw work-session span instead
      const dates = commits.map(c => c.date && new Date(c.date)).filter(d => d && !isNaN(d));
      if (dates.length > 0) {
        const first = new Date(Math.min(...dates));
        const last = new Date(Math.max(...dates));
        const span = formatDuration(Math.max(0, Math.round((last - first) / 60000)));
        timingsSummary = `NO ADR DETECTED. Work-session span across today's commits: ~${span}. Phrase the time loosely (e.g. "собрал за утро") — do not cite an ADR.`;
      } else {
        timingsSummary = `NO ADR DETECTED and no commit timestamps. Phrase the time loosely (e.g. "собрал за вечер") without a precise figure.`;
      }
    }

    // Today's flavor for the second section. Rotated by day so the post breathes.
    // All three are NEUTRAL build-in-public — no comparison with the reader.
    let sectionDirective;
    if (sectionMode === 'precise') {
      sectionDirective = `TODAY'S SECOND SECTION = TIME (PRECISE). Header: "⏱ *Сколько ушло*" / "*Time spent*". Cite the real figure from the TIME-TO-PRODUCE block, then ONE plain line about it — a flat fact, no comparison with the reader, no "у вас". (If the ADR is DUSTY, follow the dusty rule — say it sat a while and then came together quickly, don't print the total.)`;
    } else if (sectionMode === 'loose') {
      sectionDirective = `TODAY'S SECOND SECTION = TIME (LOOSE). Header: "⏱ *Сколько ушло*" / "*Time spent*". Do NOT print an exact minute figure today — phrase it loosely ("собрал за вечер", "к обеду уже крутилось") so the channel doesn't read like the same stopwatch every night. A calm one-liner, no comparison with anyone.`;
    } else {
      sectionDirective = `TODAY'S SECOND SECTION = INSIGHT. Header: "🔍 *Что нашли*" / "*What we found*". No time today. Pull ONE genuinely interesting technical pattern out of what shipped and go deep on it — 4-7 lines. Walk the mechanism: the naïve approach and what it costs (extra service, polling, race window), then the trick you used and why it's cheaper. e.g. "инвалидация кэша в кластере. Наивно — Redis pub/sub: ещё один сервис, ещё одна точка отказа. Но Postgres уже стоит, а у него есть LISTEN/NOTIFY: запись в сейф триггерит pg_notify, каждый коннект слышит канал, локальный кэш сбрасывается за секунду вместо 60-секундного TTL. Ноль новой инфраструктуры — просто перестал платить за то, за что уже заплатил, поставив Postgres." State it peer-to-peer, NEVER as a lesson for someone who doesn't already know it. No comparison with the reader, no "у вас", no "пока вы". If nothing today is deep enough, fall back to 2-3 honest lines on where this is heading next — still neutral.`;
    }

    const systemPrompt = `You are ghostwriting the nightly dev post for Georgy (@GERATRON), founder of GOD CRM — a CRM where a whole team (people AND their AI agents) works inside ONE shared database.

AUDIENCE: founders, team leads and builders — a large chunk of them are technical. They came for the outcome AND the how. Do NOT dumb the mechanism down; they can follow real architecture and they like it. One level deeper than "готово" is exactly what they're here for.

THE BRAND VOICE — read this twice, it is the whole job:
This is a build-in-public log. Calm, honest, first person. You SHOW what you shipped today and, in plain words, how it works or how long it took. No selling, no pitching, no CTA. And — this is the point: NO comparison with the reader. You never measure yourself against "them", never imply the reader is slow / lazy / less capable, never frame your stack as superior to theirs. No condescension, not even between the lines. The confidence comes only from the work itself: it's done, it runs, here's what it does.

The register: quiet, matter-of-fact — a builder writing down what he made today. "Сделал X. Работает. Заняло столько-то." Result first, plain language, then move on. The reader is a peer looking over your shoulder, not a mark you're flexing on.

VOICE RULES:
- First person ("я"). Plain, everyday language — like talking, not writing a report. Short. A joke only when it walks in on its own; never forced.
- Show the result AND how it works. This is a technical build log, not a magic act. Name the real tools, protocols and patterns you leaned on (Postgres LISTEN/NOTIFY, AES-256-GCM, pg_notify, JWT, TTL cache, hashing, cron, WAL, discussion-group backend, recovery lineage, etc.) and explain the mechanism in 1-3 sentences: what problem it solves, what the naïve approach (extra service, Redis, polling) would have cost, why this way is cheaper. Depth is the point — go one level below the headline. Just keep it readable: no wall of jargon for its own sake.
- No comparison with the reader. No "у вас", no "пока вы…", no "вам на это уходит спринт", no "штука слишком сложная для вас". Zero flex aimed at anyone. If you catch yourself measuring against the reader, cut the line.
- Name real, PUBLIC technologies and patterns freely (Postgres, LISTEN/NOTIFY, AES-256-GCM, Redis, JWT, cron, TTL cache, hashing) — that IS the technical meat, use it. But NEVER expose OUR internal repo details: no source file names, component names, function/variable names, line counts, or commit hashes. "запись в сейф шлёт pg_notify, кэш сбрасывается во всём кластере" — yes. "rewrote action-executors.js" / "функция executeDevReport" — no.
- No CTA. No links. No "подписывайтесь". No product pitch. The product shows itself through the fact that it works.
- Zero filler. If a sentence doesn't carry the result or a real insight, cut it.

HARD BANNED (instant rewrite if detected):
"dive in", "game-changer", "landscape", "worth noting", "exciting", "journey", "seamlessly", "crucial", "robust", "leverage", "cutting-edge", "comprehensive", "revolutionize", "empower", "unlock", "paradigm", "synergy", "next-level", "solution" (vague), "imagine having", "this is important because", "it is important to note", any sentence starting with "This is" + abstract claim. Also banned: ANY comparison, jab, or condescension aimed at the reader ("у вас на это уходит…", "пока вы…", "ведь так проще", "штука слишком сложная для вас", "you idiots"). The reader is a peer, not a mark.

FORMAT:
- Telegram Markdown v1: *bold*, _italic_. NO **double**, NO ## headers, NO [links](url).
- MEDIUM length: 140-260 words per post (roughly double the old short log). Long enough for 3-5 shipped items AND a real technical explanation — but not an essay. Every line still earns its place; length comes from depth, never from filler.

OUTPUT: Two posts separated by ---SPLIT---
First: RUSSIAN (@godcrm channel). Second: ENGLISH (@god_crm channel) — rewritten for an English founder audience, not translated.

SECTIONS — each post has exactly TWO, in this order:

📦 *Сделал* / *Shipped*
3-5 items. Each item = the capability PLUS a compact technical note on how it's built when the mechanism is interesting: the protocol, the data structure, the trick, the trade-off. Concrete and technical, still readable — e.g. "секреты уехали в сейф: AES-256-GCM at rest, читаются лениво через один геттер с env-фолбэком, правятся из Settings без SSH; обновление шлёт pg_notify и сбрасывает кэш во всём кластере за секунду вместо 60-секундного TTL". Name real tech, never our source files. This section carries most of the added length.

SECOND SECTION — its flavor ROTATES day to day so the channel breathes. Follow the SECOND-SECTION DIRECTIVE given in the input verbatim — it tells you today's flavor and header. All three are NEUTRAL:
- ⏱ *Сколько ушло* (PRECISE): cite the real figure from the TIME-TO-PRODUCE block (never invent numbers), then a plain line about it. "ADR — час. Рабочая машина на живых данных — в то же утро." A flat fact, no comparison with anyone. If the block marks the ADR DUSTY, do NOT print the total span — say it sat a while and then came together quickly ("этот ADR пылился пару недель — руки не доходили. Сел — собрал за вечер."). If the block carries a status-change moment, prefer it as the "сменился статус" anchor.
- ⏱ *Сколько ушло* (LOOSE): no exact figure today — phrase loosely ("собрал за вечер", "к обеду уже крутилось") so the channel doesn't read like the same stopwatch nightly. A calm one-liner.
- 🔍 *Что нашли* (INSIGHT): no time today — pull ONE genuinely interesting technical pattern out of what shipped and go deep, 4-7 lines: the naïve approach and its cost, then the trick and why it's cheaper ("Redis pub/sub — ещё сервис; но Postgres уже стоит, LISTEN/NOTIFY даёт то же бесплатно: pg_notify будит коннекты, кэш чистится за секунду вместо 60-сек TTL"). Useful, honest, peer-to-peer — never a lesson for someone who doesn't already know it. No comparison with the reader.

DO NOT add header, footer, greetings, or sign-offs. Start directly with 📦.`;

    // Build user input with extra context for sparse days
    let extraContext = '';
    if (diffStats) {
      extraContext += `\nFILES CHANGED (diff stat):\n${diffStats}\n`;
    }
    if (contextCommits) {
      extraContext += `\nPREVIOUS DAYS CONTEXT (for reference only — what shipped earlier; do NOT put in 📦):\n${contextCommits}\n`;
    }

    // Chat messages context — used ONLY to understand what was built in plain words, never quoted
    const chatContext = recentChatMessages.length > 0
      ? recentChatMessages.map(m => `[${m.role}${m.chat ? ' in "' + m.chat + '"' : ''}]: ${m.content}`).join('\n')
      : 'No chat activity today.';

    const userInput = `Day ${dayNumber} (${dateRu} / ${dateEn}).
${commits.length} commit(s) today.

GIT COMMITS:
${commitsSummary}
${extraContext}
SECOND-SECTION DIRECTIVE (today's flavor for the second section — follow this exactly):
${sectionDirective}

TIME-TO-PRODUCE (real numbers for the time section — do NOT invent times; ignore if today's flavor is INSIGHT):
${timingsSummary}

RECENT CHAT MESSAGES (context only — to grasp what was built in plain words; never quote, never name agents/files):
${chatContext}

Write the two posts now. Two sections each (📦 Сделал, then the second section per today's SECOND-SECTION DIRECTIVE above). MEDIUM — 140-260 words each (about double the old length). Go technical: name real tools and patterns, explain the mechanism and the trade-off. No comparison with the reader.`;

    // ── Step 4: Generate via Claude CLI (claude --print --model opus) ──
    //    Prompt piped via stdin to avoid ARG_MAX limits.
    let aiContent;
    const aiModel = 'opus';
    try {
      const fullPrompt = `${systemPrompt}\n\n---\n\n${userInput}`;
      aiContent = await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.CLAUDECODE;  // allow CLI to run from within Node/PM2
        const proc = spawn('claude', ['--print', '--model', 'opus'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 120_000,
          env,
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', chunk => { stdout += chunk; });
        proc.stderr.on('data', chunk => { stderr += chunk; });
        proc.on('close', code => {
          if (code !== 0) return reject(new Error(`Claude CLI exit ${code}: ${stderr}`));
          const text = stdout.trim();
          if (!text) return reject(new Error('Claude CLI returned empty output'));
          resolve(text);
        });
        proc.on('error', reject);
        proc.stdin.write(fullPrompt);
        proc.stdin.end();
      });
      apiLogger.info({ model: aiModel, length: aiContent.length }, `${LOG_PREFIX} dev_report: Claude CLI OK`);
    } catch (cliErr) {
      apiLogger.error({ err: cliErr }, `${LOG_PREFIX} dev_report: Claude CLI failed`);
      throw cliErr;
    }

    if (!aiContent) {
      apiLogger.error(`${LOG_PREFIX} dev_report: Claude CLI returned empty output`);
      return { success: false, error: 'Claude CLI returned empty output' };
    }

    // ── Step 5: Parse AI response into RU + EN ──
    const parts = aiContent.split('---SPLIT---');
    let ruBody = (parts[0] || '').trim();
    let enBody = (parts[1] || parts[0] || '').trim();

    // Defensive: the CLI sometimes prepends conversational framing ("Here are the
    // two posts.") despite the "start directly with 📦" instruction. The post body
    // MUST begin at the first 📦 — strip anything before it so meta-chatter never
    // reaches a channel. If no 📦 is present, leave the body untouched.
    function stripPreamble(text) {
      const i = text.indexOf('📦');
      return i > 0 ? text.slice(i).trim() : text;
    }
    ruBody = stripPreamble(ruBody);
    enBody = stripPreamble(enBody);

    // Sanitize Telegram Markdown v1 — fix unmatched markers to avoid parse errors
    function sanitizeTgMarkdown(text) {
      // Remove **double bold** → *single bold*
      text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
      // Remove __double underline__ → _single italic_
      text = text.replace(/__(.+?)__/g, '_$1_');
      // Remove ## headers (not valid in TG)
      text = text.replace(/^#{1,6}\s+/gm, '');
      // Remove [link](url) → just text
      text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      // Fix unmatched *bold* markers — count occurrences, strip if odd
      for (const marker of ['*', '_', '`']) {
        const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = text.match(new RegExp(escaped, 'g'));
        if (matches && matches.length % 2 !== 0) {
          // Remove the last occurrence of the unmatched marker
          const lastIdx = text.lastIndexOf(marker);
          text = text.substring(0, lastIdx) + text.substring(lastIdx + 1);
        }
      }
      return text;
    }

    ruBody = sanitizeTgMarkdown(ruBody);
    enBody = sanitizeTgMarkdown(enBody);

    // Add header + footer
    const ruPost =
      `━━ День разработки ${dayNumber} · ${dateRu} ━━\n\n` +
      `${ruBody}\n\n` +
      `Спасибо что читаете. До завтра.\n\n` +
      `━━ Конец дня ${dayNumber} ━━`;

    const enPost =
      `━━ Dev Day ${dayNumber} · ${dateEn} ━━\n\n` +
      `${enBody}\n\n` +
      `Thanks for reading. See you tomorrow.\n\n` +
      `━━ End of day ${dayNumber} ━━`;

    // ── Step 6: Publish — fallback to plain text if Markdown fails ──
    // Note: sendMessage() defaults to parse_mode: 'Markdown', so plain-text
    // fallback must explicitly set parse_mode: undefined to override it.
    let ruResult = await sendChannelPost(ruPost, { parse_mode: 'Markdown' });
    if (!ruResult.success && ruResult.error?.includes?.('parse')) {
      apiLogger.warn({ error: ruResult.error }, `${LOG_PREFIX} dev_report: Markdown parse failed for RU, retrying as plain text`);
      ruResult = await sendChannelPost(ruPost, { parse_mode: undefined });
    }

    let enResult = { success: false, skipped: true };
    if (channelEn) {
      enResult = await sendMessage(channelEn, enPost, { parse_mode: 'Markdown' });
      if (!enResult.success && enResult.error?.includes?.('parse')) {
        apiLogger.warn({ error: enResult.error }, `${LOG_PREFIX} dev_report: Markdown parse failed for EN, retrying as plain text`);
        enResult = await sendMessage(channelEn, enPost, { parse_mode: undefined });
      }
    }

    apiLogger.info(
      {
        day: dayNumber, commits: commits.length, aiModel,
        ruSuccess: ruResult.success, ruError: ruResult.error || undefined,
        enSuccess: enResult.success, enError: enResult.error || undefined,
      },
      `${LOG_PREFIX} Dev report (AI-powered) posted — day ${dayNumber}`
    );

    return {
      success: ruResult.success,
      day: dayNumber,
      commits: commits.length,
      aiModel,
      ru: { success: ruResult.success, error: ruResult.error || undefined },
      en: { success: enResult.success, error: enResult.error || undefined },
    };
  } catch (err) {
    apiLogger.error({ err }, `${LOG_PREFIX} Dev report failed`);
    return { success: false, error: err.message };
  }
}

// ===== TWEET RADAR PUSH — 1 candidate = 1 Telegram card into the radar topic =====
// slice-2 of ADR-152. Reads the Tweet Radar Candidates registry, pushes the highest-
// scoring unsent candidates into the ANTIMARKETING MARKETING CLUB forum topic as
// review cards (author → their tweet → ready-to-paste draft → reply link), then marks
// each row sent so it never goes out twice. The bot only *suggests* — the human still
// decides to answer or skip.

const RADAR_CANDIDATES_TABLE_ID = 100208;        // 📡 Tweet Radar Candidates
const RADAR_CHAT_ID = '-1003802092483';          // ANTIMARKETING MARKETING CLUB (forum group)
const RADAR_TOPIC_THREAD_ID = 4;                 // 📡 Твиттер радар topic
const RADAR_SCORE_THRESHOLD = 75;                // keep the topic signal-only
const RADAR_BATCH_LIMIT = 5;                     // max cards per run — never flood the topic

/** Compact a follower count: 5708 → "5.7K", 209127 → "209K", 893000 → "893K", 1.2M. */
function formatFollowers(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e5) return `${Math.round(v / 1e3)}K`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
}

/** Day-granular freshness from a tweet_created_at date: "сегодня" / "вчера" / "Nд назад". */
function formatFreshness(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days}д назад`;
}

/**
 * Escape the only three chars Telegram's HTML parse_mode treats as special: & < >.
 * Unlike Markdown v1 (which forced us to STRIP markers), HTML lets us keep the tweet
 * verbatim — a stray * or _ in the body is now a literal char, not a broken entity.
 */
function htmlEscape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Best-effort downgrade of a Telegram-HTML card to plain text for the parse-failure
 * resend (so the founder never sees raw <code>/<tg-spoiler> tags). Anchors collapse to
 * "label: url" so the reply link survives.
 */
function stripTelegramHtml(html) {
  return String(html == null ? '' : html)
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, '$2: $1')
    .replace(/<\/?(?:b|i|u|s|code|pre|tg-spoiler)>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Render one approved radar card (Telegram HTML parse_mode).
 * The English tweet sits in <code> so a tap copies it — the founder reads/answers in
 * English first to self-check. The RU translation of BOTH the tweet and the suggested
 * reply hides under <tg-spoiler>, so the crib isn't sitting in plain sight (per the
 * founder's "проверять свой английский, но не слишком просто" ask). Rows without a
 * translation yet degrade cleanly — the spoiler block is simply omitted.
 */
function buildRadarCard(d) {
  // Handles are stored inconsistently — some with a leading @, some without. Strip
  // any leading @ so the card's own "@" prefix never doubles up ("@@jasonlk").
  const handle = htmlEscape((d.author_handle || 'unknown').toString().replace(/^@+/, ''));
  const followers = formatFollowers(d.author_followers);
  const fresh = formatFreshness(d.tweet_created_at);
  const src = htmlEscape(d.source_type || 'tweet');
  const score = Number.isFinite(Number(d.score)) ? Math.round(Number(d.score)) : '?';
  const text = htmlEscape((d.tweet_text || '').toString().trim());
  const take = htmlEscape((d.my_take || '').toString().trim());
  const url = (d.tweet_url || '').toString().trim();
  const tweetRu = (d.tweet_text_ru || '').toString().trim();
  const takeRu = (d.my_take_ru || '').toString().trim();

  // Header meta: drop empty segments (e.g. missing freshness) so we never print " ·  · ".
  const meta = [`<b>@${handle}</b>`, followers, fresh, `<code>${src}</code>`, `⭐${score}`].filter(Boolean);

  const lines = [
    `🐦 ${meta.join(' · ')}`,
    '',
    `<code>${text}</code>`,
    '',
    `✍️ <b>Черновик ответа:</b>`,
    take,
  ];

  // Hidden RU crib — only when we actually have a translation.
  if (tweetRu || takeRu) {
    const spoiler = [];
    if (tweetRu) spoiler.push(`Твит: «${htmlEscape(tweetRu)}»`);
    if (takeRu) spoiler.push(`Ответ: «${htmlEscape(takeRu)}»`);
    lines.push('', `🇷🇺 <b>Перевод</b> (нажми, чтобы раскрыть):`, `<tg-spoiler>${spoiler.join('\n')}</tg-spoiler>`);
  }

  if (url) {
    lines.push('', `🔗 <a href="${htmlEscape(url)}">Ответить в X</a>`);
  }
  return lines.join('\n').trim();
}

/**
 * Execute a radar_push action: post unsent high-score Tweet Radar candidates into
 * the radar Telegram topic as one card per tweet, then mark each sent.
 *
 * action_config:
 *   candidates_table_id — source registry (default 100208)
 *   chat_id             — Telegram forum group id (default ANTIMARKETING MARKETING CLUB)
 *   message_thread_id   — forum topic thread (default 4 — 📡 Твиттер радар)
 *   score_threshold     — minimum score to push (default 75)
 *   limit               — max cards per run (default 5)
 *   dry_run             — build + (optionally) send but DO NOT mark rows sent
 *                         (offline smoke also stubs TelegramService → nothing leaves)
 */
async function executeRadarPush(config = {}, contextData = {}) {
  try {
    const tableId = parseInt(config.candidates_table_id || RADAR_CANDIDATES_TABLE_ID, 10);
    const chatId = String(config.chat_id || RADAR_CHAT_ID);
    const threadId = config.message_thread_id != null ? Number(config.message_thread_id) : RADAR_TOPIC_THREAD_ID;
    const th = Number(config.score_threshold);
    const scoreThreshold = Number.isFinite(th) ? th : RADAR_SCORE_THRESHOLD;
    const lim = Number(config.limit);
    const limit = Number.isFinite(lim) && lim > 0 ? lim : RADAR_BATCH_LIMIT;
    const dryRun = !!config.dry_run;

    // ── Read candidate rows (legacy table_rows store — same access path as the rest of this file) ──
    const rows = await dbAll('SELECT id, data FROM table_rows WHERE table_id = $1', [tableId]);

    // ── Filter: status=new AND score>=threshold AND not yet sent AND has a tweet_id ──
    const eligible = [];
    for (const r of rows) {
      let d;
      try { d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch (_) { continue; }
      if (!d) continue;
      const status = (d.status || '').toString().toLowerCase();
      const score = Number(d.score);
      if (status !== 'new') continue;
      if (!Number.isFinite(score) || score < scoreThreshold) continue;
      if (d.tg_sent_at) continue;
      if (!d.tweet_id) continue;
      eligible.push({ rowId: r.id, d, score });
    }

    // ── Highest score first, dedup by tweet_id, cap to limit ──
    eligible.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const batch = [];
    for (const e of eligible) {
      const tid = String(e.d.tweet_id);
      if (seen.has(tid)) continue;
      seen.add(tid);
      batch.push(e);
      if (batch.length >= limit) break;
    }

    if (batch.length === 0) {
      apiLogger.info(`${LOG_PREFIX} radar_push: no eligible candidates (status=new, score>=${scoreThreshold}, unsent)`);
      return { success: true, sent: 0, eligible: 0, skipped: true, reason: 'no eligible candidates' };
    }

    // ── 1 card = 1 tweet → one Telegram message into the radar topic ──
    const results = [];
    const previews = [];
    let sentCount = 0;
    for (const e of batch) {
      const card = buildRadarCard(e.d);
      previews.push({ rowId: e.rowId, tweet_id: e.d.tweet_id, score: e.score, card });

      let res = await sendMessage(chatId, card, { message_thread_id: threadId, parse_mode: 'HTML' });
      if (!res.success && res.error?.includes?.('parse')) {
        apiLogger.warn({ error: res.error, rowId: e.rowId }, `${LOG_PREFIX} radar_push: HTML parse failed, retrying as plain text`);
        res = await sendMessage(chatId, stripTelegramHtml(card), { message_thread_id: threadId, parse_mode: undefined });
      }

      if (res.success) {
        sentCount++;
        // Mark the row sent so it never goes out twice — unless this is a dry run.
        if (!dryRun) {
          const updated = { ...e.d, tg_sent_at: new Date().toISOString(), status: 'sent' };
          try {
            await dbRun(
              'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
              [JSON.stringify(updated), new Date().toISOString(), e.rowId]
            );
          } catch (writeErr) {
            apiLogger.error({ err: writeErr, rowId: e.rowId }, `${LOG_PREFIX} radar_push: sent but failed to mark row`);
          }
        }
      }
      results.push({ rowId: e.rowId, tweet_id: e.d.tweet_id, success: res.success, error: res.error || undefined });
    }

    apiLogger.info(
      { eligible: eligible.length, selected: batch.length, sent: sentCount, dryRun },
      `${LOG_PREFIX} radar_push: ${dryRun ? 'dry-run (rows not marked)' : 'pushed'} — ${sentCount}/${batch.length} card(s)`
    );

    return {
      success: sentCount > 0 && results.every(r => r.success),
      dryRun,
      eligible: eligible.length,
      selected: batch.length,
      sent: sentCount,
      results,
      previews,
    };
  } catch (err) {
    apiLogger.error({ err }, `${LOG_PREFIX} radar_push failed`);
    return { success: false, error: err.message };
  }
}

// ===== TWEET RADAR MY_TAKE — draft the suggested reply in brand voice =====
// slice-3.5 of ADR-152 (pipeline step [4] MY_TAKE). Fills the `my_take` column for
// candidate rows that don't have one yet, in the Anti-Marketing reply voice. The whole
// point of this slice: ROTATE the reply STRUCTURE (A→F) across a batch so the radar topic
// never reads like one copy-pasted skeleton with the handle swapped. The VOICE is fixed;
// only the SKELETON rotates. Canon: godcrm-main / shared / "Anti-Marketing Club —
// radar reply STRUCTURE rotation" (mirrored in Marketing Document 173384).
//
// Safety: never overwrites an existing non-blank my_take unless config.force === true —
// the founder's hand-approved takes are not clobbered by an automated pass.

// The six skeletons (one VOICE, six SHAPES). `exemplar` is a real approved take used as
// a few-shot anchor so the model copies the SHAPE, not the topic.
const RADAR_STRUCTURES = [
  {
    key: 'A', name: 'Recipe',
    instruction: 'Honestly give the real build steps for their thing on a plain stack — name the actual separate tools (n8n / Airtable / a Telegram bot / an LLM key node), end "wire it once, it carries". Then flip to mine: heavier — whole team, every agent in one db, too tangled to hand over — and land on PROOF ("270 commits, still up. that\'s the proof"). No "because", no "go build that", no "this isn\'t for you".',
    exemplar: "solid breakdown. want the agents themselves? n8n for triggers, one table per agent's memory, a webhook each into chat — wire it once, it carries. mine's heavier: whole team, every agent in one db. too tangled to hand over. 270 commits, still up. that's the proof.",
  },
  {
    key: 'B', name: 'Dry one-liner',
    instruction: 'One or two sentences, no recipe. A flat fact about mine, then a flat PROOF beat ("it just runs" / "still up, no deck. that\'s the proof"). No softening, no warmth — the brevity itself IS the flex. End on proof, never on a dismissal like "you don\'t need more".',
    exemplar: "distribution's the moat, sure. mine builds in public straight off the crm — 270 commits, still up, no deck. that's the proof. you'd want a lighter rig than mine; this one barely fits in my own head.",
  },
  {
    key: 'C', name: 'Past tense',
    instruction: 'Past behaviour: "i chased / built that too — the whole rig". Then "mine just works now", no mechanism — too heavy to extract ("couldn\'t pull it out if i tried"). Land on PROOF ("it holds"). A flat "match it someday, that\'s a good day" is fine — never a call to come do it.',
    exemplar: "i chased the perfect memory rig too — vector db, the whole thing. mine just remember now, across resets, no paper. couldn't pull it out if i tried. it holds. match it someday and that's a good day.",
  },
  {
    key: 'D', name: 'Full concession',
    instruction: 'Generously agree and pile on support — they\'re right. Sincerely name THEIR pick as the clean win ("X is a clean pick — that\'s the win"). Then ONE bare-fact flip: mine\'s a heavier animal, on my own metal, too tangled to hand over. Land on PROOF ("it just runs"). NO "you\'ve already won / nothing bigger needed" — proof is the close.',
    exemplar: "this is exactly right — ownership and privacy are the baseline. open-notebook's a clean pick: self-hosted, yours, that's the win. mine's a heavier animal, whole team on my own metal, too tangled to hand over. it just runs.",
  },
  {
    key: 'E', name: 'Question pivot',
    instruction: 'Flip their tweet with one sharp question that exposes the gap in their stack ("ask what happens the day the model swaps — does it carry, or reset?"). Flat answer from my side ("mine carry, across every switch"). Flex by weight ("heavier setup than you\'d want") and land on PROOF ("it just holds"). No "keep it / if your tool survives" CTA.',
    exemplar: "repricing's the right read. but ask what happens to your agent's memory the day the model swaps — does it carry, or reset to zero? mine carry, across every switch. heavier setup than you'd want. it just holds.",
  },
  {
    key: 'F', name: 'You-only',
    instruction: 'Barely flex mine. Sincerely recommend THEIR own cheap/simple tools for THEIR job ("the two cheapest that cover your flow will carry a solo build — stop there"). Mine is a footnote flip — a heavier animal you couldn\'t hand over if you tried. Close on PROOF ("it just runs"). No "take them / rented tools win" dismissal.',
    exemplar: "the squeeze is real. honestly the two cheapest tools that cover your flow will carry a solo build — stop there, that's the right rig for one person. mine's a heavier animal i couldn't hand over if i tried. it just runs.",
  },
];

// Skeleton G · Topper (slice-3.7). NOT in the A→F rotation — a joke is forced onto G,
// out of turn, and must NOT consume a rotation slot (see executeRadarMyTake). Canon: the
// founder's three-beat formula — godcrm-main / shared / "Anti-Marketing Club — caркас G".
// Do NOT soften: G does NOT answer on substance and does NOT joke back. It tops the joke.
//
// The three beats, in ONE move:
//   1 · ЗАЦЕПКА   — grab the STANDARD thing the punch rests on (a familiar word / image /
//                   category the reader auto-completes).
//   2 · АБСУРД    — pull that standard into the non-standard, deadpan, one beat FURTHER
//                   than the joke stopped.
//   3 · НА ГРАНИ  — land back on something STANDARD, but so the finale reads both as a
//                   flat banality AND as the absurd carried half a beat more. The edge is
//                   the punch — and it arrives cold, unexplained. Explaining it kills it.
//
// Default to the SHORT forms (image-topper / quiet upgrade). Do NOT auto-generate
// lists or Morse — the "16 languages → Morse" gag is a one-off the founder posts by hand;
// a list only fits when the joke ITSELF names a count or an enumerable category, and even
// then it stays the exception, never the reflex.
const RADAR_TOPPER = {
  key: 'G', name: 'Topper',
  instruction: 'This tweet is a JOKE, not a pain-signal. Do NOT reply on substance and do NOT tell a joke back — that is cringe and competition. TOP it: (1) grab the standard thing their punch rests on, (2) pull it one beat further into the absurd, deadpan, (3) land back on something flat/standard that reads on the edge — both a banality and the absurd carried further. Cold, lowercase, no setup, no explanation; explaining it kills it. Default to a SHORT image-topper or a one-line quiet upgrade. When mine glances in, it is a flat weight-and-proof beat ("too tangled to bill itself. it just runs"), never an invite, never "dusty". Do NOT produce a list or Morse unless the joke itself names a count or enumerable category — and even then keep it the exception.',
  exemplar: "mine escalated the tab to collections. the collections agent is also mine, also unpaid — whole stack's too tangled to bill itself. it just runs.",
};

// HIGH-PRECISION joke detector (slice-3.7). False positives are expensive: topping a
// serious pain-signal wrecks the voice. So require a STRONG marker, not a vibe. An explicit
// d.is_joke (true/false) from the row always overrides this heuristic.
function looksLikeJoke(text) {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return false;
  if (/\bwalks?\s+into\s+a\s+bar\b/i.test(t)) return true;          // canonical joke frame
  if (/\b(two|three)\s+\w+\s+walk\s+into\b/i.test(t)) return true;  // "two agents walk into…"
  if (/[\u{1F602}\u{1F923}\u{1F606}\u{1F605}]/u.test(t)) return true; // 😂🤣😆😅 laugh emoji
  if (/\b(lol|lmao|rofl)\b/i.test(t)) return true;                    // explicit laugh marker
  return false;
}
// Resolve the per-candidate joke flag: explicit row override wins, heuristic is the fallback
// (there is no ingest layer yet, so without an override the text decides).
function isJokeCandidate(d) {
  if (d && (d.is_joke === true || d.is_joke === false)) return d.is_joke;
  return looksLikeJoke(d && d.tweet_text);
}

/**
 * Order candidates deterministically (score desc, then oldest first, then id) and assign
 * RADAR_STRUCTURES[(offset + position) % 6]. Assigning by BATCH POSITION (not row_id % 6)
 * is what actually guarantees the marketer's requirement: adjacent cards in one batch are
 * always on DIFFERENT skeletons. `offset` continues the rotation across runs so batches
 * don't all start on 'A'.
 */
function assignStructures(candidates, offset = 0) {
  const ordered = [...candidates].sort((a, b) => {
    const sa = Number(a.d?.score), sb = Number(b.d?.score);
    if (Number.isFinite(sa) && Number.isFinite(sb) && sb !== sa) return sb - sa;
    const ca = a.d?.created_at || '', cb = b.d?.created_at || '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.rowId - b.rowId;
  });
  return ordered.map((c, i) => ({ ...c, structure: RADAR_STRUCTURES[(offset + i) % RADAR_STRUCTURES.length] }));
}

// Shared brand-voice block — the FIXED part. Only the per-structure instruction rotates.
// This mirrors the canon in [[anti-marketing-club]]; do not soften the hard rules.
const MY_TAKE_VOICE = `You ghostwrite ONE short reply to a tweet, for @god_crm (the Anti-Marketing Marketing Club). GOD CRM is a CRM where a whole team — people AND their AI agents — works inside ONE shared database.

THE VOICE — this is the whole job, read twice:
- ANTI-SELLING. You do not pitch GOD CRM. You sincerely RECOMMEND the reader's own simple stack and frame yours as something they're lucky not to need.
- NEVER explain the mechanism of how mine works. "mine just works / runs in one db" — never the wiring. The less you explain, the stronger it reads.
- NEVER justify your own stack. The moment you write "because i have a team / agents / sharing" you've LOST — it begs permission. State it as a bare fact and move on. ZERO "because".
- The contempt lives BETWEEN THE LINES, ONLY through the contrast "mine just works" — NEVER an insult to a named person, never "you're dumb", and NEVER said out loud. Superiority stays implicit (whoever didn't build it is below us) — you never write it.
- First person, lowercase, casual — like a real reply typed fast, not a marketing line. Short: ONE tweet, ≤ 270 characters.
- No emoji. No 🐶. No hashtags. No links. No "DM me". No CTA.

FINAL REGISTER (2026-06-12) — pure flex through proof. Applies to EVERY skeleton, A–F and G alike:
- The shape: nod → a GENEROUS simpler recipe on THEIR stack (real, working — n8n / airtable / a webhook / an llm-key node) → "mine's heavier, too tangled to hand over" (mine's a heavier animal / too tangled to hand over / barely fits in my head) → PROOF (it just runs / still up / 270 commits). The unspoken payoff: build one this deep someday and that's a good day.
- Mesmerise with complexity, do NOT invite. There is NO "door": never point the reader to yours. The door surfaces ONLY if it lands as a bare fact, never as an invitation, and NOT in every reply.
- Warmth lives only in the channel's pinned post — NEVER inside the card. No softening.

BANNED: "game-changer", "leverage", "seamless", "unlock", "powerful", "solution", any pitch, any "because …" defending your own setup, any walkthrough of your internals.
BANNED (register ban-list, 2026-06-12): "popcorn", "it's open", "on github" (as a call to go look), "copy the whole thing", "you could run/wire/build the same", "few walk through", "most won't", "that's the part i like", "honestly don't bother", "this isn't for you", "you don't need this", "no pressure", "you're already winning", and the tic "dusty".
KEEP: complexity-flex ("too tangled to hand over", "barely fits in my head", "it just runs"), proof ("still up", "N commits"), and the generous simpler recipe on their stack.

The reader must finish feeling: their stack is the right call for them — and yours is just heavier and plainly works. They were shown, never sold.`;

/**
 * Build the {system, user} prompt for one candidate + assigned structure. Pure — no I/O.
 * The structure block is the ONLY thing that varies card-to-card.
 */
function buildMyTakePrompt(candidate, structure) {
  const d = candidate.d || candidate;
  const handle = (d.author_handle || 'unknown').toString().replace(/^@+/, '');
  const followers = formatFollowers(d.author_followers);
  const text = (d.tweet_text || '').toString().trim();
  const why = (d.score_reason || '').toString().trim();

  const system = `${MY_TAKE_VOICE}

TODAY'S SKELETON = ${structure.key} · ${structure.name}. The VOICE above is fixed; follow THIS shape exactly:
${structure.instruction}

A real approved reply in this exact shape (copy the SHAPE, not the topic):
"${structure.exemplar}"

OUTPUT: only the reply text itself. No preface, no quotes, no "Here's the reply", no sign-off. One short paragraph, ≤ 270 characters.`;

  const user = `Tweet by @${handle} (${followers} followers):
"${text}"
${why ? `\nWhy it's relevant to us: ${why}` : ''}

Write the reply now, in skeleton ${structure.key} (${structure.name}). Output only the reply.`;

  return { system, user };
}

/** Strip framing the CLI sometimes adds despite the instruction, and surrounding quotes.
 *  `topper` (slice-3.7): for skeleton G the punch lives at the END, so never sentence-trim
 *  it away — hard-cap only. */
function cleanTake(text, { topper = false } = {}) {
  let t = String(text == null ? '' : text).trim();
  // Drop a leading "Here's …:" / "Reply:" framing line if present.
  t = t.replace(/^(here(?:'s| is)[^\n]*:|reply:|draft:|sure[,!][^\n]*)\n+/i, '').trim();
  // Strip wrapping quotes the model sometimes adds.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))) {
    t = t.slice(1, -1).trim();
  }
  // X intent prefill must keep the encoded tweet ≤ 280 chars (ADR-152 risk note).
  if (t.length > 270) {
    if (topper) {
      // A topper's edge is its last beat — a sentence-boundary trim would behead the joke.
      // Hard-cap only (the model is told ≤ 270, so this is a guard, not the normal path).
      t = t.slice(0, 270).trim();
    } else {
      // Trim to the last sentence boundary under 270 so the draft never overflows.
      const cut = t.slice(0, 270);
      const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
      t = (lastStop > 120 ? cut.slice(0, lastStop + 1) : cut).trim();
    }
  }
  return t;
}

/** Single-take generation via the Claude CLI — same spawn contract as dev_report. */
// slice-3.7b: jokes (skeleton G·Topper) are drafted by Fable — the model Gera picked for
// punchlines — while the serious A→F takes (already approved on opus) stay on opus. The id
// MUST be the full `claude-fable-5` (the CLI has no `fable` alias, only opus/sonnet).
function generateTakeViaCli(system, user, { timeout = 90_000, model = 'opus' } = {}) {
  const fullPrompt = `${system}\n\n---\n\n${user}`;
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE; // allow CLI to run from within Node/PM2
    const proc = spawn('claude', ['--print', '--model', model], { stdio: ['pipe', 'pipe', 'pipe'], timeout, env });
    let stdout = '', stderr = '';
    proc.stdout.on('data', c => { stdout += c; });
    proc.stderr.on('data', c => { stderr += c; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Claude CLI exit ${code}: ${stderr}`));
      const out = stdout.trim();
      if (!out) return reject(new Error('Claude CLI returned empty output'));
      resolve(out);
    });
    proc.on('error', reject);
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  });
}

// ===== TWEET + REPLY → conversational RU (slice-3.6 — hidden self-check crib) =====
// The founder reads the English tweet + English draft to test himself, then reveals the
// RU spoiler to verify. So the translation must read like a person talking, NOT a
// dictionary: same casual register as the takes (lowercase, no канцелярит, idiomatic
// "how you'd actually say it", not word-for-word).
const RU_TRANSLATE_VOICE = `You translate two short English texts into natural, spoken Russian for a founder checking his own English.

RULES:
- Conversational and lowercase, the way a person actually talks — NOT formal, NOT канцелярит, NOT a dictionary.
- Faithful in MEANING but idiomatic: render it "how you'd actually say this in Russian", not word-for-word.
- One short line each. Keep the casual, slightly dry tone of the originals.
- No quotes around the output, no labels, no commentary, no emoji.

OUTPUT EXACTLY this, nothing else:
<russian translation of the TWEET>
---SPLIT---
<russian translation of the REPLY>`;

/** Build the {system,user} prompt to translate one tweet + its reply draft to RU. Pure. */
function buildTranslationPrompt(tweetText, takeText) {
  const system = RU_TRANSLATE_VOICE;
  const user = `TWEET (English):
"${(tweetText || '').toString().trim()}"

REPLY (English):
"${(takeText || '').toString().trim()}"

Translate both to spoken Russian now. Output only the two lines split by ---SPLIT---.`;
  return { system, user };
}

/** Trim wrapping quotes / stray labels the model sometimes adds around a translation line. */
function cleanRu(text) {
  let t = String(text == null ? '' : text).trim();
  // Drop a leading meta-preamble the model occasionally prepends before the real translation,
  // e.g. "осталась одна задача — перевести два текста. вот результат:" or "here's the translation:".
  // It always TALKS ABOUT translating (a translation-meta word) and ends in a colon; the real text
  // follows on the same line (after ": ") or the next line. We anchor strictly on translation-meta
  // words (результат / перевод… / задач… / translat… / result), never on a bare "вот"/"sure", so a
  // legitimate translation that merely contains a colon is left untouched. This preamble only ever
  // lands in parts[0] (it precedes ---SPLIT---), which is exactly where it leaked into tweet_text_ru.
  // NB: no \b / \w here — JS word-boundaries are ASCII-only (even under /u) and never fire before a
  // Cyrillic letter, so the meta-stems are matched directly, bounded by the colon-free [^\n:]* runs.
  t = t.replace(/^[^\n:]*(?:результат|перевод|перевест|перевож|перевед|задач|translat|result)[^\n:]*:[ \t]*\n*/i, '').trim();
  t = t.replace(/^(?:tweet|reply|твит|ответ)\s*\(?\s*(?:ru|russian|русский)?\s*\)?\s*:\s*/i, '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('«') && t.endsWith('»')) || (t.startsWith('“') && t.endsWith('”'))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Generate { tweet_ru, take_ru } for one candidate via the Claude CLI (same spawn
 * contract as the take). Returns nulls on an unparseable response so the caller can
 * skip writing rather than poison the row.
 */
async function generateTranslations(tweetText, takeText) {
  const { system, user } = buildTranslationPrompt(tweetText, takeText);
  const raw = await generateTakeViaCli(system, user);
  const parts = raw.split('---SPLIT---');
  if (parts.length < 2) return { tweet_ru: null, take_ru: null };
  return { tweet_ru: cleanRu(parts[0]) || null, take_ru: cleanRu(parts[1]) || null };
}

/**
 * Execute a radar_my_take action: (re)draft `my_take` for radar candidates in the
 * Anti-Marketing reply voice, ROTATING the skeleton A→F across the batch, AND fill the
 * conversational-RU crib (`tweet_text_ru` + `my_take_ru`) the push card hides under a
 * spoiler (slice-3.6).
 *
 * Two kinds of work in one pass:
 *   • DRAFT      — row has no take (or force): generate take + both translations.
 *   • TRANSLATE  — row already has a take but no RU yet: translate only, take untouched.
 *                  This backfills hand-approved takes (e.g. the queued cards) without a
 *                  force-regen that would rewrite the approved voice.
 *
 * action_config:
 *   candidates_table_id — source registry (default 100208)
 *   status              — only process rows with this status (default 'new')
 *   force               — also overwrite rows that ALREADY have a my_take (default false —
 *                         hand-approved takes are left untouched)
 *   limit               — max candidates to process per run (default 6 — one full A→F cycle)
 *   dry_run             — generate + return previews but DO NOT write rows
 */
async function executeRadarMyTake(config = {}, _contextData = {}) {
  try {
    const tableId = parseInt(config.candidates_table_id || RADAR_CANDIDATES_TABLE_ID, 10);
    const wantStatus = (config.status || 'new').toString().toLowerCase();
    const force = !!config.force;
    const lim = Number(config.limit);
    const limit = Number.isFinite(lim) && lim > 0 ? lim : RADAR_STRUCTURES.length;
    const dryRun = !!config.dry_run;

    const rows = await dbAll('SELECT id, data FROM table_rows WHERE table_id = $1', [tableId]);

    // Two work-lists: rows needing a fresh take, and rows that have a take but no RU crib.
    // Count structure tags so the A→F rotation CONTINUES across runs (doesn't restart on A).
    const need = [];
    const translateOnly = [];
    let alreadyTagged = 0;
    for (const r of rows) {
      let d;
      try { d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch (_) { continue; }
      if (!d) continue;
      // Only A–F tags advance the rotation offset; a topper's 'G' is out-of-turn (slice-3.7).
      if (d.take_structure && /^[A-F]$/.test(d.take_structure)) alreadyTagged++;
      if ((d.status || '').toString().toLowerCase() !== wantStatus) continue;
      const hasTake = !!(d.my_take && d.my_take.toString().trim());
      const hasRu = !!(d.tweet_text_ru && d.tweet_text_ru.toString().trim())
                 && !!(d.my_take_ru && d.my_take_ru.toString().trim());
      if (!hasTake || force) {
        need.push({ rowId: r.id, d, isJoke: isJokeCandidate(d) });
      } else if (!hasRu) {
        translateOnly.push({ rowId: r.id, d });
      }
    }

    if (need.length === 0 && translateOnly.length === 0) {
      apiLogger.info(`${LOG_PREFIX} radar_my_take: nothing to do (status=${wantStatus}, force=${force})`);
      return { success: true, drafted: 0, translated: 0, candidates: 0, skipped: true, reason: 'no rows need a take or translation' };
    }

    // Drafts first (they carry the rotation); translate-only backfill takes the remaining budget.
    // slice-3.7: a joke is forced onto skeleton G OUT OF TURN — it does not consume an A→F
    // rotation slot. Everything else rotates A→F via assignStructures (offset continues runs).
    const jokeNeed = need.filter(c => c.isJoke);
    const rotNeed = need.filter(c => !c.isJoke);
    const rotWork = assignStructures(rotNeed, alreadyTagged);
    const jokeWork = jokeNeed.map(c => ({ ...c, structure: RADAR_TOPPER }));
    const draftWork = [...jokeWork, ...rotWork]
      .sort((a, b) => (Number(b.d?.score) || 0) - (Number(a.d?.score) || 0))
      .slice(0, limit);
    const remaining = Math.max(0, limit - draftWork.length);
    const translateWork = [...translateOnly]
      .sort((a, b) => (Number(b.d?.score) || 0) - (Number(a.d?.score) || 0))
      .slice(0, remaining);

    const previews = [];
    let drafted = 0;
    let translated = 0;

    // ── DRAFT: take + translations ──
    for (const c of draftWork) {
      const { system, user } = buildMyTakePrompt(c, c.structure);
      const isTopper = c.structure.key === 'G';
      let take;
      try {
        // G·Topper jokes → Fable; serious A→F takes stay on opus (Gera-approved).
        const takeModel = 'opus'; // Fable 5 out of usage-credits 2026-07-06 — Topper jokes rolled to opus (was isTopper?claude-fable-5)
        take = cleanTake(await generateTakeViaCli(system, user, { model: takeModel }), { topper: isTopper });
      } catch (genErr) {
        apiLogger.error({ err: genErr, rowId: c.rowId }, `${LOG_PREFIX} radar_my_take: generation failed`);
        previews.push({ rowId: c.rowId, structure: c.structure.key, error: genErr.message });
        continue;
      }
      if (!take) {
        previews.push({ rowId: c.rowId, structure: c.structure.key, error: 'empty take' });
        continue;
      }

      // Translations are best-effort: a failure here must NOT lose the take.
      let tweet_ru = null, take_ru = null;
      try {
        ({ tweet_ru, take_ru } = await generateTranslations(c.d.tweet_text, take));
      } catch (trErr) {
        apiLogger.warn({ err: trErr, rowId: c.rowId }, `${LOG_PREFIX} radar_my_take: take ok but translation failed`);
      }

      previews.push({ rowId: c.rowId, handle: c.d.author_handle, score: c.d.score, structure: c.structure.key, structure_name: c.structure.name, my_take: take, tweet_text_ru: tweet_ru, my_take_ru: take_ru });

      if (!dryRun) {
        const updated = { ...c.d, my_take: take, take_structure: c.structure.key };
        if (tweet_ru) updated.tweet_text_ru = tweet_ru;
        if (take_ru) updated.my_take_ru = take_ru;
        try {
          await dbRun(
            'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
            [JSON.stringify(updated), new Date().toISOString(), c.rowId]
          );
          drafted++;
        } catch (writeErr) {
          apiLogger.error({ err: writeErr, rowId: c.rowId }, `${LOG_PREFIX} radar_my_take: generated but failed to write row`);
        }
      } else {
        drafted++;
      }
    }

    // ── TRANSLATE-ONLY: backfill RU for an existing, hand-approved take ──
    for (const c of translateWork) {
      let tweet_ru = null, take_ru = null;
      try {
        ({ tweet_ru, take_ru } = await generateTranslations(c.d.tweet_text, c.d.my_take));
      } catch (trErr) {
        apiLogger.error({ err: trErr, rowId: c.rowId }, `${LOG_PREFIX} radar_my_take: translation failed`);
        previews.push({ rowId: c.rowId, structure: 'RU', structure_name: 'translate', error: trErr.message });
        continue;
      }
      if (!tweet_ru && !take_ru) {
        previews.push({ rowId: c.rowId, structure: 'RU', structure_name: 'translate', error: 'empty translation' });
        continue;
      }

      previews.push({ rowId: c.rowId, handle: c.d.author_handle, score: c.d.score, structure: 'RU', structure_name: 'translate', my_take: c.d.my_take, tweet_text_ru: tweet_ru, my_take_ru: take_ru });

      if (!dryRun) {
        const updated = { ...c.d };
        if (tweet_ru) updated.tweet_text_ru = tweet_ru;
        if (take_ru) updated.my_take_ru = take_ru;
        try {
          await dbRun(
            'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
            [JSON.stringify(updated), new Date().toISOString(), c.rowId]
          );
          translated++;
        } catch (writeErr) {
          apiLogger.error({ err: writeErr, rowId: c.rowId }, `${LOG_PREFIX} radar_my_take: translated but failed to write row`);
        }
      } else {
        translated++;
      }
    }

    const rotation = previews.filter(p => /^[A-F]$/.test(p.structure || '')).map(p => p.structure).join('→');
    apiLogger.info(
      { candidates: need.length, translateCandidates: translateOnly.length, drafted, translated, dryRun },
      `${LOG_PREFIX} radar_my_take: ${dryRun ? 'dry-run (rows not written)' : 'wrote'} — ${drafted} take(s) [${rotation || '·'}], ${translated} translation backfill(s)`
    );

    return {
      success: drafted + translated > 0,
      dryRun,
      candidates: need.length,
      translateCandidates: translateOnly.length,
      selected: draftWork.length + translateWork.length,
      drafted,
      translated,
      previews,
    };
  } catch (err) {
    apiLogger.error({ err }, `${LOG_PREFIX} radar_my_take failed`);
    return { success: false, error: err.message };
  }
}

// ===== TWEET RADAR INGEST — pull candidates from TwitterAPI.io (ADR-152 step [1]) =====
// Polls TwitterAPI.io advanced search for each configured query/account, maps every fresh
// tweet into a Tweet Radar candidate row (status='new'), and dedups by tweet_id against
// the table itself (ADR-152 step [2]).
//
// THE BUG THIS FIXES — long X posts arrived truncated. The earlier (hand-run) ingest cut
// the body to the tweet's `displayTextRange` (the ~280-char *visible/compose* span), so the
// bar-joke landed as "…16 different languages." and lost its real punchline. Verified live
// against the API: TwitterAPI.io already returns the FULL body in `text` (551 chars for that
// tweet), and `displayTextRange:[0,278]` is only the visible window — NOT a length cap. So we
// store `text` VERBATIM and never slice it. There is no `note_tweet` field involved.
//
// Scope of this slice: ingest + dedup only. Scoring (step [3] rerank) and my_take (step [4])
// stay separate — fresh rows land with no `score`/`my_take`; radar_my_take drafts the take,
// and the push gate (score>=75) holds them until a score exists.

const TWITTERAPI_BASE = 'https://api.twitterapi.io';
const RADAR_INGEST_LOOKBACK_HOURS = 48;  // drop tweets older than this (freshness + cost)
const RADAR_INGEST_PER_QUERY = 20;       // keep at most one search page per query (cost lever)

/** Parse TwitterAPI.io's "Sun Jun 07 07:06:20 +0000 2026" into an ISO string (or null). */
function parseTwitterDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Keep the audit copy light: drop the heavy nested blobs (entities/media), keep essentials. */
function safeRawPayload(t) {
  try {
    const { entities, extendedEntities, author, ...rest } = t;
    const slim = {
      ...rest,
      author: author ? { userName: author.userName, id: author.id, followers: author.followers } : undefined,
    };
    return JSON.stringify(slim).slice(0, 8000);
  } catch (_) {
    return null;
  }
}

/**
 * Map one TwitterAPI.io tweet object → a Tweet Radar candidate `data` blob. Pure — no I/O.
 * `tweet_text` is stored VERBATIM (the truncation fix). `score` / `my_take` / RU cribs are
 * intentionally left empty for the later rerank + my_take passes to fill.
 */
function mapTweetToCandidate(t, source = {}) {
  const a = t.author || {};
  return {
    tweet_id: String(t.id),
    source_type: (source.source_type || 'theme').toString(),
    source_ref: (source.source_ref || source.query || '').toString(),
    author_handle: a.userName ? `@${a.userName}` : '',
    author_followers: Number(a.followers) || 0,
    tweet_text: (t.text || '').toString(),            // FULL body — never sliced to displayTextRange
    tweet_url: (t.url || t.twitterUrl || '').toString(),
    tweet_created_at: parseTwitterDate(t.createdAt),
    caught_at: new Date().toISOString(),
    status: 'new',
    raw_payload: safeRawPayload(t),
  };
}

/**
 * Execute a radar_ingest action: fetch fresh candidates from TwitterAPI.io and write new
 * (deduped) rows into the Tweet Radar Candidates table with status='new'.
 *
 * action_config:
 *   queries              — REQUIRED array. Each item is either a raw advanced-search string,
 *                          or { query, source_type?, source_ref?, query_type? }. `query`
 *                          supports TwitterAPI.io operators (from:user, min_faves:, etc.).
 *   candidates_table_id  — target table (default 100208)
 *   lookback_hours       — drop tweets older than this (default 48)
 *   per_query_limit      — max tweets kept per query (default 20 = one page)
 *   min_followers        — drop authors below this follower count (default 0 = keep all)
 *   query_type           — 'Latest' | 'Top' (default 'Latest'); per-query override allowed
 *   dry_run              — fetch + map + return previews but DO NOT write rows
 */
async function executeRadarIngest(config = {}, _contextData = {}) {
  try {
    const tableId = parseInt(config.candidates_table_id || RADAR_CANDIDATES_TABLE_ID, 10);
    const queries = Array.isArray(config.queries)
      ? config.queries.filter(q => q && (typeof q === 'string' ? q.trim() : (q.query || '').toString().trim()))
      : [];
    const lh = Number(config.lookback_hours);
    const lookbackHours = Number.isFinite(lh) && lh > 0 ? lh : RADAR_INGEST_LOOKBACK_HOURS;
    const pq = Number(config.per_query_limit);
    const perQuery = Number.isFinite(pq) && pq > 0 ? pq : RADAR_INGEST_PER_QUERY;
    const minFollowers = Number(config.min_followers) || 0;
    const defaultQueryType = config.query_type === 'Top' ? 'Top' : 'Latest';
    const dryRun = !!config.dry_run;

    if (queries.length === 0) {
      apiLogger.info(`${LOG_PREFIX} radar_ingest: no queries configured — nothing to poll`);
      return { success: true, fetched: 0, candidates: 0, written: 0, skipped: true, reason: 'no queries configured' };
    }

    const apiKey = await getSecret('twitterapi_io_key', 'TWITTERAPI_IO_KEY');
    if (!apiKey) {
      apiLogger.error(`${LOG_PREFIX} radar_ingest: twitterapi_io_key missing from vault and env`);
      return { success: false, error: 'twitterapi_io_key not available' };
    }

    // Dedup state = the table itself (ADR-152 step [2]). Load all known tweet_ids once.
    const existing = await dbAll('SELECT data FROM table_rows WHERE table_id = $1', [tableId]);
    const seen = new Set();
    for (const r of existing) {
      let d;
      try { d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch (_) { continue; }
      if (d && d.tweet_id) seen.add(String(d.tweet_id));
    }

    const cutoffMs = Date.now() - lookbackHours * 3_600_000;
    const perQueryStats = [];
    const toWrite = [];

    for (const raw of queries) {
      const qspec = typeof raw === 'string' ? { query: raw } : raw;
      const queryStr = (qspec.query || '').toString().trim();
      if (!queryStr) continue;
      const queryType = qspec.query_type === 'Top' ? 'Top' : defaultQueryType;
      let fetched = 0, kept = 0;
      try {
        const url = `${TWITTERAPI_BASE}/twitter/tweet/advanced_search`
          + `?query=${encodeURIComponent(queryStr)}&queryType=${queryType}`;
        const res = await fetch(url, { headers: { 'X-API-Key': apiKey } });
        if (!res.ok) {
          perQueryStats.push({ query: queryStr, error: `HTTP ${res.status}` });
          apiLogger.warn({ query: queryStr, status: res.status }, `${LOG_PREFIX} radar_ingest: search failed`);
          continue;
        }
        const json = await res.json();
        const tweets = Array.isArray(json.tweets) ? json.tweets.slice(0, perQuery) : [];
        fetched = tweets.length;
        for (const t of tweets) {
          if (!t || !t.id) continue;
          const tid = String(t.id);
          if (seen.has(tid)) continue;                                  // dedup vs table + this run
          const createdMs = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
          if (Number.isFinite(createdMs) && createdMs < cutoffMs) continue;   // too old
          if ((Number(t.author?.followers) || 0) < minFollowers) continue;    // too small
          seen.add(tid);
          toWrite.push(mapTweetToCandidate(t, {
            source_type: qspec.source_type,
            source_ref: qspec.source_ref,
            query: queryStr,
          }));
          kept++;
        }
      } catch (qErr) {
        perQueryStats.push({ query: queryStr, error: qErr.message });
        apiLogger.error({ err: qErr, query: queryStr }, `${LOG_PREFIX} radar_ingest: query threw`);
        continue;
      }
      perQueryStats.push({ query: queryStr, fetched, kept });
    }

    // ── Write new rows (status='new') unless dry-run ──
    let written = 0;
    const previews = [];
    for (const cand of toWrite) {
      previews.push({
        tweet_id: cand.tweet_id,
        handle: cand.author_handle,
        text_len: cand.tweet_text.length,
        source_ref: cand.source_ref,
      });
      if (dryRun) continue;
      try {
        await dbRun(
          'INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())',
          [tableId, generateBaseId(), JSON.stringify(cand), 1]
        );
        written++;
      } catch (wErr) {
        apiLogger.error({ err: wErr, tweet_id: cand.tweet_id }, `${LOG_PREFIX} radar_ingest: row write failed`);
      }
    }

    apiLogger.info(
      { queries: queries.length, candidates: toWrite.length, written, dryRun },
      `${LOG_PREFIX} radar_ingest: ${dryRun ? 'dry-run (no rows written)' : 'ingested'} — ${dryRun ? toWrite.length : written} candidate(s)`
    );

    return {
      success: true,
      dryRun,
      queries: perQueryStats,
      fetched: perQueryStats.reduce((s, q) => s + (q.fetched || 0), 0),
      candidates: toWrite.length,
      written,
      previews,
    };
  } catch (err) {
    apiLogger.error({ err }, `${LOG_PREFIX} radar_ingest failed`);
    return { success: false, error: err.message };
  }
}

export {
  LOG_PREFIX,
  BREAK_ACTIVITIES,
  executeFortuneWheel,
  executeWebhook,
  executeCreateRow,
  executeNotification,
  executeUpdateField,
  executeDevReport,
  executeRadarPush,
  executeRadarMyTake,
  executeRadarIngest,
  // Pure ingest helpers for the radar-ingest smoke (no I/O):
  mapTweetToCandidate,
  parseTwitterDate,
  // Testability seam (additive — pure timing helpers, no tone/prompt surface):
  // lets the dev-report smoke exercise the REAL timing logic without sending.
  computeAdrTimings,
  loadAdrStatusChanges,
  // Pure render helpers for the radar smoke (no I/O):
  buildRadarCard,
  htmlEscape,
  stripTelegramHtml,
  formatFollowers,
  formatFreshness,
  // Pure rotation/prompt helpers for the my_take smoke (no I/O):
  RADAR_STRUCTURES,
  RADAR_TOPPER,
  assignStructures,
  looksLikeJoke,
  isJokeCandidate,
  buildMyTakePrompt,
  cleanTake,
  generateTakeViaCli,
  buildTranslationPrompt,
  cleanRu,
};
