// ============================================================
// PES Agentic Workflows — The Pet as Trigger & Face
// ============================================================
// Зверь = лицо и триггер, под ним = настоящие workflow.
//
// Built-in workflows:
//   triage       — scan CRM for new/urgent items
//   daily_summary — aggregate today's events + interactions
//   task_cleanup  — archive stale notes/reminders
//   health_check  — monitor PES vitals, flag anomalies
//   crm_digest    — summarize CRM space activity
//
// Level gates:
//   L8   — triage, health_check, daily_summary (read-only + analytics)
//   L10  — crm_digest (CRM analytics)
//   L15  — task_cleanup, custom workflows (automation)
// ============================================================

const WORKFLOW_DEFS = {
  // ── L8: Basic workflows ──────────────────────────────
  triage: {
    name: 'Triage',
    description: 'Сканирует CRM на новые/срочные записи',
    levelReq: 8,
    cooldownMs: 10 * 60 * 1000, // 10 min
    schedule: null, // manual only
    async run(ctx) {
      const { crm, store } = ctx;
      if (!crm) return { ok: false, text: 'CRM не подключена' };

      const tables = await crm.getTables();
      if (!tables.length) return { ok: false, text: 'Нет таблиц в CRM' };

      const results = [];
      let totalNew = 0;

      for (const table of tables.slice(0, 8)) {
        try {
          const rows = await crm.getRows(table.id, { limit: 5 });
          if (!rows.length) continue;

          // Check for recently created/updated rows
          const recent = rows.filter(r => {
            const created = r.created_at || r.data?.created_at;
            if (!created) return false;
            const age = Date.now() - new Date(created).getTime();
            return age < 24 * 60 * 60 * 1000; // last 24h
          });

          if (recent.length > 0) {
            totalNew += recent.length;
            results.push({
              table: table.name || table.display_name,
              count: recent.length,
              sample: recent[0].data || recent[0],
            });
          }
        } catch (_) {}
      }

      if (totalNew === 0) {
        return { ok: true, text: '✅ Всё спокойно — нет новых записей за 24ч', data: { totalNew: 0 } };
      }

      let text = `📋 Triage: ${totalNew} новых записей за 24ч\n\n`;
      for (const r of results) {
        text += `📁 ${r.table}: ${r.count} новых\n`;
        const sample = r.sample;
        const preview = Object.entries(sample)
          .filter(([k, v]) => v != null && v !== '' && !k.startsWith('_') && k !== 'id')
          .slice(0, 3)
          .map(([k, v]) => `  ${k}: ${String(v).slice(0, 60)}`)
          .join('\n');
        if (preview) text += preview + '\n';
        text += '\n';
      }

      return { ok: true, text, data: { totalNew, tables: results.length } };
    },
  },

  health_check: {
    name: 'Health Check',
    description: 'Проверяет виталы PES и флагует аномалии',
    levelReq: 8,
    cooldownMs: 5 * 60 * 1000,
    schedule: '*/30 * * * *', // every 30 min
    async run(ctx) {
      const { store } = ctx;
      const stats = store.getStats();
      if (!stats) return { ok: false, text: 'Нет данных' };

      const alerts = [];
      const report = [];

      // Vitals check
      if (stats.mood < 0.2) alerts.push('⚠️ Настроение критически низкое');
      if (stats.energy < 0.15) alerts.push('⚠️ Энергия почти на нуле');
      if (stats.hunger > 0.85) alerts.push('🍖 Очень голоден!');
      if (stats.loneliness > 0.8) alerts.push('💔 Очень одинок');

      // Interaction check
      const recent = store.getRecentInteractions(10);
      const lastInteraction = recent[0];
      if (lastInteraction) {
        const age = Date.now() - new Date(lastInteraction.timestamp).getTime();
        if (age > 6 * 60 * 60 * 1000) { // 6 hours no interaction
          alerts.push('⏰ Нет взаимодействий > 6 часов');
        }
      }

      // Pending reminders check
      try {
        const pending = store.getPendingReminders();
        if (pending.length > 0) {
          alerts.push(`📌 ${pending.length} просроченных напоминаний`);
        }
      } catch (_) {}

      // Build report
      report.push(`🐾 ${stats.level?.toFixed?.(1) || stats.level} lvl, ${stats.xp} XP`);
      report.push(`💚 mood: ${Math.round(stats.mood * 100)}%`);
      report.push(`⚡ energy: ${Math.round(stats.energy * 100)}%`);
      report.push(`🍖 hunger: ${Math.round(stats.hunger * 100)}%`);
      report.push(`🧠 interactions: ${stats.interactions_total}`);

      const hasAlerts = alerts.length > 0;
      let text = hasAlerts
        ? `🚨 Health Check — ${alerts.length} предупреждений:\n\n${alerts.join('\n')}\n\n${report.join('\n')}`
        : `✅ Health Check — всё в норме\n\n${report.join('\n')}`;

      return { ok: true, text, data: { alerts: alerts.length, vitals: { mood: stats.mood, energy: stats.energy, hunger: stats.hunger } } };
    },
  },

  // ── L12: Analytics workflows ─────────────────────────
  daily_summary: {
    name: 'Daily Summary',
    description: 'Итоги дня: взаимодействия, XP, эмоции, заметки',
    levelReq: 8,
    cooldownMs: 60 * 60 * 1000, // 1 hour
    schedule: '0 21 * * *', // every day at 21:00
    async run(ctx) {
      const { store } = ctx;
      const stats = store.getStats();
      if (!stats) return { ok: false, text: 'Нет данных' };

      // Today's interactions
      const allRecent = store.getRecentInteractions(100);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayInteractions = allRecent.filter(i => new Date(i.timestamp) >= todayStart);

      // XP earned today
      let todayXP = 0;
      try {
        const xpRows = store.db.prepare(`
          SELECT SUM(amount) as total FROM xp_log
          WHERE timestamp >= ?
        `).get(todayStart.toISOString());
        todayXP = xpRows?.total || 0;
      } catch (_) {}

      // Notes created today
      let todayNotes = 0;
      try {
        const notesRow = store.db.prepare(`
          SELECT COUNT(*) as c FROM owner_notes
          WHERE is_deleted = 0 AND created_at >= ?
        `).get(todayStart.toISOString());
        todayNotes = notesRow?.c || 0;
      } catch (_) {}

      // Emotion distribution today
      const emotionCounts = {};
      for (const i of todayInteractions) {
        const em = i.emotion_after || 'unknown';
        emotionCounts[em] = (emotionCounts[em] || 0) + 1;
      }
      const topEmotions = Object.entries(emotionCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([e, c]) => `${e} (${c})`);

      // Unique actors
      const actors = new Set(todayInteractions.map(i => i.actor).filter(Boolean));

      let text = `📊 Итоги дня:\n\n`;
      text += `🐾 Взаимодействий: ${todayInteractions.length}\n`;
      text += `⭐ XP заработано: +${todayXP}\n`;
      text += `📝 Заметок создано: ${todayNotes}\n`;
      text += `👥 Собеседников: ${actors.size}\n`;
      if (topEmotions.length) {
        text += `😊 Эмоции: ${topEmotions.join(', ')}\n`;
      }
      text += `\n📈 Уровень: ${stats.level?.toFixed?.(1) || stats.level}`;
      text += `\n💚 Настроение: ${Math.round(stats.mood * 100)}%`;

      return { ok: true, text, data: { interactions: todayInteractions.length, xp: todayXP, notes: todayNotes } };
    },
  },

  crm_digest: {
    name: 'CRM Digest',
    description: 'Обзор активности в CRM пространстве',
    levelReq: 10,
    cooldownMs: 30 * 60 * 1000,
    schedule: null,
    async run(ctx) {
      const { crm } = ctx;
      if (!crm) return { ok: false, text: 'CRM не подключена' };

      const tables = await crm.getTables();
      if (!tables.length) return { ok: false, text: 'Нет таблиц' };

      let text = `📊 CRM Digest — ${tables.length} таблиц\n\n`;
      let totalRows = 0;

      for (const table of tables.slice(0, 12)) {
        try {
          const rows = await crm.getRows(table.id, { limit: 1 });
          const name = table.name || table.display_name || `#${table.id}`;
          // Get actual count via a COUNT query approximation
          const allRows = await crm.getRows(table.id, { limit: 100 });
          const count = allRows.length;
          totalRows += count;
          text += `📁 ${name}: ${count}${count >= 100 ? '+' : ''} записей\n`;
        } catch (_) {}
      }

      text += `\n📈 Всего: ~${totalRows} записей в ${tables.length} таблицах`;

      return { ok: true, text, data: { tables: tables.length, totalRows } };
    },
  },

  // ── L20: Automation workflows ────────────────────────
  task_cleanup: {
    name: 'Task Cleanup',
    description: 'Архивирует старые заметки и просроченные напоминания',
    levelReq: 15,
    cooldownMs: 60 * 60 * 1000,
    schedule: '0 3 * * *', // 3 AM daily
    async run(ctx) {
      const { store } = ctx;
      let cleaned = 0;

      // Archive delivered reminders older than 7 days
      try {
        const old = store.db.prepare(`
          SELECT id FROM reminders
          WHERE delivered = 1 AND delivered_at < datetime('now', '-7 days')
        `).all();
        if (old.length > 0) {
          store.db.prepare(`
            DELETE FROM reminders
            WHERE delivered = 1 AND delivered_at < datetime('now', '-7 days')
          `).run();
          cleaned += old.length;
        }
      } catch (_) {}

      // Count stale notes (>30 days, unpinned)
      let staleNotes = 0;
      try {
        const stale = store.db.prepare(`
          SELECT COUNT(*) as c FROM owner_notes
          WHERE is_deleted = 0 AND pinned = 0 AND created_at < datetime('now', '-30 days')
        `).get();
        staleNotes = stale?.c || 0;
      } catch (_) {}

      let text = `🧹 Cleanup:\n`;
      text += `  🗑 Удалено доставленных напоминаний: ${cleaned}\n`;
      if (staleNotes > 0) {
        text += `  📝 Старых заметок (>30д): ${staleNotes} — можно архивировать\n`;
      }
      text += cleaned === 0 && staleNotes === 0 ? '\n✅ Всё чисто!' : '';

      return { ok: true, text, data: { cleaned, staleNotes } };
    },
  },
};

// ── Workflow Engine ──────────────────────────────────────

export class WorkflowEngine {
  constructor({ store, crm, pes }) {
    this.store = store;
    this.crm = crm;
    this.pes = pes;
    this._lastRun = {}; // { workflowId: timestamp }
    this._scheduledTimers = [];
    this._firedThisMinute = new Set();
    this._onAutoRun = null;
    this.ensureTable();
  }

  // ── List available workflows for current level ────────
  list(currentLevel) {
    return Object.entries(WORKFLOW_DEFS)
      .filter(([_, def]) => def.levelReq <= Math.floor(currentLevel))
      .map(([id, def]) => ({
        id,
        name: def.name,
        description: def.description,
        levelReq: def.levelReq,
        schedule: def.schedule || 'manual',
        lastRun: this._lastRun[id] || null,
      }));
  }

  // ── Run a workflow by ID ──────────────────────────────
  async run(workflowId, currentLevel) {
    const def = WORKFLOW_DEFS[workflowId];
    if (!def) return { ok: false, text: `❌ Workflow "${workflowId}" не найден` };
    if (def.levelReq > Math.floor(currentLevel)) {
      return { ok: false, text: `🔒 ${def.name} разблокируется на уровне ${def.levelReq}` };
    }

    // Cooldown check
    const lastRun = this._lastRun[workflowId];
    if (lastRun && (Date.now() - lastRun) < def.cooldownMs) {
      const waitSec = Math.ceil((def.cooldownMs - (Date.now() - lastRun)) / 1000);
      return { ok: false, text: `⏳ ${def.name} — cooldown ${waitSec}с` };
    }

    // Execute
    const startMs = Date.now();
    try {
      const ctx = { store: this.store, crm: this.crm, pes: this.pes };
      const result = await def.run(ctx);
      this._lastRun[workflowId] = Date.now();

      // Log to DB
      this._logRun(workflowId, result.ok, Date.now() - startMs, result.data);

      // Trigger PES event
      if (this.pes) {
        this.pes.event({
          type: 'workflow_completed',
          from: 'system',
          data: { workflow: workflowId, success: result.ok },
        });
      }

      return result;
    } catch (err) {
      this._logRun(workflowId, false, Date.now() - startMs, { error: err.message });
      return { ok: false, text: `❌ ${def.name} ошибка: ${err.message}` };
    }
  }

  // ── Schedule-based auto-run (accurate time-based) ─────
  startScheduler(currentLevel) {
    this.stopScheduler();
    this._schedulerLevel = currentLevel;

    // Check every 60 seconds if any scheduled workflow should fire
    this._schedulerTimer = setInterval(() => {
      this._tickScheduler();
    }, 60 * 1000);

    // Run first tick immediately
    this._tickScheduler();
    console.log('[WORKFLOW] Scheduler started, level', Math.floor(currentLevel));
  }

  _tickScheduler() {
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentHour = now.getHours();

    // Clear fired set each tick (fires every 60s, so previous minute's keys are stale)
    this._firedThisMinute.clear();

    for (const [id, def] of Object.entries(WORKFLOW_DEFS)) {
      if (!def.schedule) continue;

      const parsed = this._parseCron(def.schedule);
      if (!parsed) continue;

      // Check if current time matches the cron pattern
      if (!this._cronMatches(parsed, currentMinute, currentHour)) continue;

      // Prevent double-fire within same minute
      const key = `${id}_${currentHour}_${currentMinute}`;
      if (this._firedThisMinute.has(key)) continue;

      // Level check
      let level = this._schedulerLevel;
      try {
        const stats = this.store.getStats();
        if (stats) level = stats.level;
      } catch (_) {}

      if (def.levelReq > Math.floor(level)) continue;

      this._firedThisMinute.add(key);
      console.log(`[WORKFLOW] Auto-running ${id} (matched ${def.schedule})`);

      this.run(id, level).then(result => {
        // Notify via onAutoRun callback if set
        if (this._onAutoRun && result.ok) {
          this._onAutoRun(id, result);
        }
      }).catch(err => {
        console.error(`[WORKFLOW] Scheduled ${id} error:`, err.message);
      });
    }
  }

  // Set callback for auto-run notifications (telegram sends message)
  onAutoRun(callback) {
    this._onAutoRun = callback;
  }

  stopScheduler() {
    if (this._schedulerTimer) clearInterval(this._schedulerTimer);
    this._schedulerTimer = null;
    this._scheduledTimers = [];
  }

  // ── Get run history ───────────────────────────────────
  getHistory(limit = 10) {
    try {
      return this.store.db.prepare(`
        SELECT * FROM workflow_runs ORDER BY id DESC LIMIT ?
      `).all(limit);
    } catch (_) {
      return [];
    }
  }

  // ── Internal: log run to DB ───────────────────────────
  _logRun(workflowId, success, durationMs, data) {
    try {
      this.store.db.prepare(`
        INSERT INTO workflow_runs (workflow_id, success, duration_ms, result_data)
        VALUES (?, ?, ?, ?)
      `).run(workflowId, success ? 1 : 0, durationMs, data ? JSON.stringify(data) : null);
    } catch (_) {
      // Table might not exist yet on first run
    }
  }

  // ── Internal: parse cron expression ──────────────────
  _parseCron(schedule) {
    // Supports: "*/N * * * *", "M H * * *"
    const parts = schedule.trim().split(/\s+/);
    if (parts.length < 5) return null;
    const [minPart, hourPart] = parts;
    return { minPart, hourPart };
  }

  _cronMatches(parsed, currentMin, currentHour) {
    const { minPart, hourPart } = parsed;

    // Check minute
    if (minPart.startsWith('*/')) {
      const interval = parseInt(minPart.slice(2));
      if (isNaN(interval) || currentMin % interval !== 0) return false;
    } else if (minPart !== '*') {
      if (parseInt(minPart) !== currentMin) return false;
    }

    // Check hour
    if (hourPart.startsWith('*/')) {
      const interval = parseInt(hourPart.slice(2));
      if (isNaN(interval) || currentHour % interval !== 0) return false;
    } else if (hourPart !== '*') {
      if (parseInt(hourPart) !== currentHour) return false;
    }

    return true;
  }

  // ── Ensure workflow_runs table exists ───────────────
  ensureTable() {
    try {
      this.store.db.prepare(`
        CREATE TABLE IF NOT EXISTS workflow_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workflow_id TEXT NOT NULL,
          success INTEGER DEFAULT 1,
          duration_ms INTEGER DEFAULT 0,
          result_data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    } catch (_) {}
  }
}

export { WORKFLOW_DEFS };
export default WorkflowEngine;
