// ============================================================
// PES ↔ CRM Bridge Service
// ============================================================
// Reads PES state from pes-core's SQLite DB and state.json
// Writes CRM events to a shared events queue that PES picks up
// ============================================================

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { apiLogger } from '../../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PES_ROOT = join(__dirname, '../../../pes-core');
const PES_DATA = join(PES_ROOT, 'pes-data');
const STATE_FILE = join(PES_DATA, 'bublik.state.json');
const DB_FILE = join(PES_DATA, 'bublik.db');
const EVENTS_FILE = join(PES_DATA, 'crm-events.json');

let _db = null;

/**
 * Get read-only SQLite connection to PES DB
 */
function getDb() {
  if (_db) return _db;
  if (!existsSync(DB_FILE)) {
    apiLogger.warn('PES DB not found at %s', DB_FILE);
    return null;
  }
  try {
    _db = new Database(DB_FILE, { readonly: true, fileMustExist: true });
    _db.pragma('journal_mode = WAL');
    return _db;
  } catch (err) {
    apiLogger.error({ err }, 'Failed to open PES DB');
    return null;
  }
}

/**
 * Read PES emotional state from state.json
 */
export function getState() {
  try {
    if (!existsSync(STATE_FILE)) return null;
    const raw = readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    apiLogger.error({ err }, 'Failed to read PES state');
    return null;
  }
}

/**
 * Get PES status summary for dashboard
 */
export function getStatus() {
  const state = getState();
  if (!state) return { alive: false, error: 'PES state not found' };

  const db = getDb();
  let stats = null;
  let recentInteractions = [];
  let commandCount = 0;
  let relationshipCount = 0;

  if (db) {
    try {
      stats = db.prepare('SELECT * FROM stats LIMIT 1').get();
      recentInteractions = db.prepare(
        'SELECT * FROM interactions ORDER BY id DESC LIMIT 20'
      ).all();
      commandCount = db.prepare('SELECT COUNT(*) as cnt FROM commands WHERE understood = 1').get()?.cnt || 0;
      relationshipCount = db.prepare('SELECT COUNT(*) as cnt FROM relationships').get()?.cnt || 0;
    } catch (err) {
      apiLogger.error({ err }, 'Failed to query PES DB');
    }
  }

  const emotions = state.emotions || {};
  const identity = state.identity || {};

  return {
    alive: state.alive,
    mode: state.mode,
    identity: {
      name: identity.name,
      breed: identity.breed,
      birthday: identity.birthday,
      domain: identity.domain,
      seed: identity.seed,
    },
    emotions: {
      state: emotions.state,
      intensity: emotions.intensity,
      mood: emotions.mood,
      energy: emotions.energy,
      hunger: emotions.hunger,
      curiosity: emotions.curiosity,
      loneliness: emotions.loneliness,
    },
    traits: emotions.traits || {},
    level: stats ? _xpToLevel(stats.xp) : 0,
    xp: stats?.xp || 0,
    phase: stats?.phase || 'puppy',
    stats: stats ? {
      bugsFound: stats.bugs_found,
      bugsSolved: stats.bugs_solved,
      fetchesTotal: stats.fetches_total,
      commandsLearned: commandCount,
      relationships: relationshipCount,
      totalInteractions: stats.total_interactions,
    } : null,
    recentInteractions: recentInteractions.map(i => ({
      id: i.id,
      actor: i.actor,
      actionType: i.action_type,
      emotionBefore: i.emotion_before,
      emotionAfter: i.emotion_after,
      xpGained: i.xp_gained,
      timestamp: i.timestamp,
    })),
    lastActivity: state.lastActivityAt ? new Date(state.lastActivityAt).toISOString() : null,
    savedAt: state.savedAt,
  };
}

/**
 * Get trait history (White Fang progression)
 */
export function getTraitHistory() {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT * FROM trait_change_log ORDER BY id DESC LIMIT 50'
    ).all();
  } catch {
    return [];
  }
}

/**
 * Get XP log
 */
export function getXpLog(limit = 50) {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT * FROM xp_log ORDER BY id DESC LIMIT ?'
    ).all(limit);
  } catch {
    return [];
  }
}

/**
 * Get learned commands
 */
export function getCommands() {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM commands ORDER BY id DESC').all();
  } catch {
    return [];
  }
}

/**
 * Get relationships
 */
export function getRelationships() {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM relationships ORDER BY trust DESC').all();
  } catch {
    return [];
  }
}

/**
 * Get learned preferences
 */
export function getPreferences() {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM learned_preferences ORDER BY id DESC').all();
  } catch {
    return [];
  }
}

/**
 * Get fetch log (things PES brought back)
 */
export function getFetchLog(limit = 30) {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT * FROM fetch_log ORDER BY id DESC LIMIT ?'
    ).all(limit);
  } catch {
    return [];
  }
}

/**
 * Get letters (farewell/milestone/evolution)
 */
export function getLetters() {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM letters ORDER BY id DESC').all();
  } catch {
    return [];
  }
}

/**
 * Get reaction memory
 */
export function getReactionMemory(limit = 50) {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT * FROM reaction_memory ORDER BY id DESC LIMIT ?'
    ).all(limit);
  } catch {
    return [];
  }
}

/**
 * Get emotional state history from state.json
 */
export function getEmotionHistory() {
  const state = getState();
  if (!state || !state.emotions) return [];
  return state.emotions.stateHistory || [];
}

/**
 * Get interaction timeline (for dashboard chart)
 */
export function getInteractionTimeline(days = 7) {
  const db = getDb();
  if (!db) return [];
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare(`
      SELECT
        substr(timestamp, 1, 10) as day,
        COUNT(*) as count,
        SUM(xp_gained) as total_xp,
        GROUP_CONCAT(DISTINCT action_type) as action_types
      FROM interactions
      WHERE timestamp >= ?
      GROUP BY substr(timestamp, 1, 10)
      ORDER BY day ASC
    `).all(since);
  } catch {
    return [];
  }
}

/**
 * Push a CRM event for PES to consume
 * Events are written to a JSON file that PES polls
 */
export function pushEvent(eventType, data) {
  try {
    let events = [];
    if (existsSync(EVENTS_FILE)) {
      const raw = readFileSync(EVENTS_FILE, 'utf8');
      events = JSON.parse(raw);
    }
    events.push({
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      type: eventType,
      data,
      timestamp: new Date().toISOString(),
      consumed: false,
    });
    // Keep only last 100 events
    if (events.length > 100) events = events.slice(-100);
    writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
    return true;
  } catch (err) {
    apiLogger.error({ err }, 'Failed to push CRM event to PES');
    return false;
  }
}

/**
 * Get pending CRM events (for PES to consume)
 */
export function getPendingEvents() {
  try {
    if (!existsSync(EVENTS_FILE)) return [];
    const raw = readFileSync(EVENTS_FILE, 'utf8');
    const events = JSON.parse(raw);
    return events.filter(e => !e.consumed);
  } catch {
    return [];
  }
}

/**
 * Mark events as consumed
 */
export function consumeEvents(eventIds) {
  try {
    if (!existsSync(EVENTS_FILE)) return false;
    const raw = readFileSync(EVENTS_FILE, 'utf8');
    const events = JSON.parse(raw);
    for (const e of events) {
      if (eventIds.includes(e.id)) e.consumed = true;
    }
    writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get config values from PES DB
 */
export function getConfig() {
  const db = getDb();
  if (!db) return {};
  try {
    const rows = db.prepare('SELECT key, value FROM config').all();
    const config = {};
    for (const r of rows) config[r.key] = r.value;
    return config;
  } catch {
    return {};
  }
}

/**
 * Get sticker pack info
 */
export function getStickerPacks() {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM created_sticker_packs ORDER BY id DESC').all();
  } catch {
    return [];
  }
}

/**
 * Get learned sticker count by pack
 */
export function getLearnedStickerStats() {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT set_name, COUNT(*) as count,
        SUM(CASE WHEN is_custom_emoji = 1 THEN 1 ELSE 0 END) as emoji_count
      FROM learned_stickers
      WHERE set_name IS NOT NULL
      GROUP BY set_name
      ORDER BY count DESC
    `).all();
  } catch {
    return [];
  }
}

// XP → Level formula (must match pes-core/core/pes.js)
function _xpToLevel(xp) {
  if (xp <= 0) return 0;
  let remaining = xp;
  let level = 0;
  while (level < 100) {
    const cost = 10 * Math.pow(1.08, level);
    if (remaining < cost) break;
    remaining -= cost;
    level++;
  }
  if (level < 100) {
    const nextCost = 10 * Math.pow(1.08, level);
    level += Math.round((remaining / nextCost) * 10) / 10;
  }
  return Math.max(0, Math.min(100, Math.round(level * 10) / 10));
}

/**
 * Close DB connection (for graceful shutdown)
 */
export function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
