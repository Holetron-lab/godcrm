// ============================================================
// PES v2 Memory Store — Level-Unlock Architecture
// ============================================================
// Clean rebuild. No migrations. Level-gated features.
// ============================================================

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TRAITS = [
  'courage', 'curiosity_trait', 'loyalty', 'stubbornness',
  'playfulness', 'drama', 'food_obsession', 'sass', 'aggression'
];

const PHASE_THRESHOLDS = {
  puppy: 0, young: 200, adult: 500, experienced: 1000, cyber: 2000
};

// ── Level-Unlock Tree ────────────────────────────────────
// Every feature PES can do, gated by level.
const UNLOCK_TREE = [
  // Level 0 — birth
  { feature: 'basic_emotions',     level: 0,  category: 'emotion' },
  { feature: 'babble_tier0',       level: 0,  category: 'sound' },
  { feature: 'sticker_react',      level: 0,  category: 'core' },
  // Level 2
  { feature: 'combo_phrases',      level: 2,  category: 'sound' },
  { feature: 'emoji_learn',        level: 2,  category: 'core' },
  // Level 3
  { feature: 'notes',              level: 3,  category: 'ability' },
  { feature: 'emotion_social',     level: 3,  category: 'emotion' },
  // Level 4
  { feature: 'reminders',          level: 4,  category: 'ability' },
  { feature: 'babble_tier1',       level: 4,  category: 'sound' },
  // Level 5
  { feature: 'emotion_working',    level: 5,  category: 'emotion' },
  { feature: 'search_memory',      level: 5,  category: 'ability' },
  // Level 6
  { feature: 'file_storage',       level: 6,  category: 'ability' },
  { feature: 'babble_tier2',       level: 6,  category: 'sound' },
  // Level 8
  { feature: 'contacts',           level: 8,  category: 'ability' },
  { feature: 'emotion_dramatic',   level: 8,  category: 'emotion' },
  { feature: 'crm_read',           level: 8,  category: 'crm' },
  // Level 10
  { feature: 'emotion_full',       level: 10, category: 'emotion' },
  { feature: 'babble_tier3',       level: 10, category: 'sound' },
  { feature: 'crm_write',          level: 10, category: 'crm' },
  // Level 12
  { feature: 'orchestrator',       level: 12, category: 'ability' },
  { feature: 'analytics',          level: 12, category: 'crm' },
  // Level 15
  { feature: 'sound_invention',    level: 15, category: 'sound' },
  { feature: 'crm_tasks',          level: 15, category: 'crm' },
  // Level 20
  { feature: 'advanced_babble',    level: 20, category: 'sound' },
  { feature: 'automation',         level: 20, category: 'ability' },
  // Level 25
  { feature: 'social_pets',        level: 10, category: 'social' },
  { feature: 'templates',          level: 25, category: 'ability' },
  // Level 30+
  { feature: 'spells',             level: 30, category: 'ability' },
  { feature: 'crypto_language',    level: 40, category: 'sound' },
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function now() { return new Date().toISOString(); }

export class MemoryStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');

    this._checkpointInterval = setInterval(() => {
      try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    }, 5 * 60 * 1000);
  }

  // ── Init ─────────────────────────────────────────────────

  init() {
    const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    this.db.exec(sql);
    this._seedUnlocks();
    this._seedAchievements();
    return this;
  }

  _seedUnlocks() {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO unlocks (feature, level_req, category) VALUES (?, ?, ?)'
    );
    const tx = this.db.transaction(() => {
      for (const u of UNLOCK_TREE) {
        insert.run(u.feature, u.level, u.category);
      }
    });
    tx();
  }

  // ── Config ───────────────────────────────────────────────

  getConfig(key) {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setConfig(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
  }

  // ── Stats ────────────────────────────────────────────────

  getStats() {
    let row = this.db.prepare('SELECT * FROM stats WHERE id = 1').get();
    if (!row) {
      this.db.prepare('INSERT OR IGNORE INTO stats (id) VALUES (1)').run();
      row = this.db.prepare('SELECT * FROM stats WHERE id = 1').get();
      if (!row) return null;
    }
    row.traits = {};
    for (const t of TRAITS) row.traits[t] = row[t];
    try { row.trait_phases = JSON.parse(row.trait_phases); } catch { row.trait_phases = {}; }
    return row;
  }

  updateStats(data) {
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(data)) {
      if (k === 'id') continue;
      sets.push(`${k} = ?`);
      vals.push(typeof v === 'object' ? JSON.stringify(v) : v);
    }
    if (sets.length === 0) return;
    vals.push(1);
    this.db.prepare(`UPDATE stats SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  // ── XP ───────────────────────────────────────────────────

  addXP(amount, reason, detail = null) {
    this.db.prepare('INSERT INTO xp_log (amount, reason, detail) VALUES (?, ?, ?)').run(amount, reason, detail);
    const stats = this.getStats();
    const newXP = stats.xp + amount;
    const newLevel = this._xpToLevel(newXP);
    const newPhase = this._levelToPhase(newLevel);
    const leveledUp = Math.floor(newLevel) > Math.floor(stats.level || 0);
    this.updateStats({ xp: newXP, level: newLevel, phase: newPhase });
    // Check unlocks
    const unlocked = this._checkUnlocks(newLevel);
    // Return compat object (telegram.js expects these fields)
    return {
      xp: newXP, level: newLevel, phase: newPhase,
      levelUp: leveledUp, leveledUp,
      added: amount, dailyXP: amount, dailyCap: 999,
      unlocked,
    };
  }

  _xpToLevel(xp) {
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

  _levelToPhase(level) {
    if (level >= 80) return 'cyber';
    if (level >= 60) return 'experienced';
    if (level >= 40) return 'adult';
    if (level >= 20) return 'young';
    return 'puppy';
  }

  // ── Unlocks ──────────────────────────────────────────────

  _checkUnlocks(level) {
    const newUnlocks = this.db.prepare(
      'SELECT * FROM unlocks WHERE level_req <= ? AND unlocked = 0'
    ).all(Math.floor(level));

    if (newUnlocks.length === 0) return [];

    const update = this.db.prepare(
      'UPDATE unlocks SET unlocked = 1, unlocked_at = ? WHERE id = ?'
    );
    const ts = now();
    const unlocked = [];
    for (const u of newUnlocks) {
      update.run(ts, u.id);
      unlocked.push(u.feature);
    }
    return unlocked;
  }

  isUnlocked(feature) {
    const row = this.db.prepare('SELECT unlocked FROM unlocks WHERE feature = ?').get(feature);
    return row ? row.unlocked === 1 : false;
  }

  getUnlocks() {
    return this.db.prepare('SELECT * FROM unlocks ORDER BY level_req').all();
  }

  getUnlockedFeatures() {
    return this.db.prepare('SELECT feature FROM unlocks WHERE unlocked = 1').all().map(r => r.feature);
  }

  getNextUnlock(currentLevel) {
    return this.db.prepare(
      'SELECT * FROM unlocks WHERE unlocked = 0 AND level_req <= ? ORDER BY level_req LIMIT 1'
    ).get(Math.floor(currentLevel));
  }

  // ── Interactions ─────────────────────────────────────────

  logInteraction({ actor, action_type, action_detail, emotion_before, emotion_after, xp_gained, context }) {
    this.db.prepare(`
      INSERT INTO interactions (actor, action_type, action_detail, emotion_before, emotion_after, xp_gained, context)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(actor, action_type, action_detail || null, emotion_before || null, emotion_after || null, xp_gained || 0, context ? JSON.stringify(context) : null);
    this.updateStats({ interactions_total: (this.getStats().interactions_total || 0) + 1, last_interaction: now() });
  }

  getRecentInteractions(limit = 20) {
    return this.db.prepare('SELECT * FROM interactions ORDER BY id DESC LIMIT ?').all(limit);
  }

  // ── Relationships ────────────────────────────────────────

  addOrUpdateRelationship(entity, data) {
    const existing = this.getRelationship(entity);
    if (existing) {
      const sets = [];
      const vals = [];
      if (data.trust !== undefined) { sets.push('trust = ?'); vals.push(clamp(data.trust, 0, 1)); }
      if (data.affection !== undefined) { sets.push('affection = ?'); vals.push(clamp(data.affection, 0, 1)); }
      if (data.relationship_phase !== undefined) { sets.push('relationship_phase = ?'); vals.push(data.relationship_phase); }
      sets.push('interactions_count = interactions_count + 1');
      sets.push('last_seen = ?'); vals.push(now());
      vals.push(entity);
      this.db.prepare(`UPDATE relationships SET ${sets.join(', ')} WHERE entity = ?`).run(...vals);
    } else {
      this.db.prepare(`
        INSERT INTO relationships (entity, trust, affection, interactions_count, relationship_phase)
        VALUES (?, ?, ?, 1, ?)
      `).run(
        entity,
        clamp(data.trust ?? 0.1, 0, 1),
        clamp(data.affection ?? 0.1, 0, 1),
        data.relationship_phase || 'stranger'
      );
    }
    return this.getRelationship(entity);
  }

  getRelationship(entity) {
    return this.db.prepare('SELECT * FROM relationships WHERE entity = ?').get(entity);
  }

  upsertRelationship(entity, data) {
    const existing = this.getRelationship(entity);
    if (existing) {
      const trust = clamp((data.trust ?? 0) + existing.trust, 0, 1);
      const affection = clamp((data.affection ?? 0) + existing.affection, 0, 1);
      const count = existing.interactions_count + 1;
      let phase = existing.relationship_phase;
      if (trust > 0.8 && affection > 0.8) phase = 'bonded';
      else if (trust > 0.6 && affection > 0.6) phase = 'favorite';
      else if (trust > 0.4) phase = 'friend';
      else if (count > 5) phase = 'acquaintance';
      this.db.prepare(`
        UPDATE relationships SET trust = ?, affection = ?, interactions_count = ?,
        relationship_phase = ?, last_seen = ? WHERE entity = ?
      `).run(trust, affection, count, phase, now(), entity);
    } else {
      this.db.prepare(`
        INSERT INTO relationships (entity, trust, affection, interactions_count)
        VALUES (?, ?, ?, 1)
      `).run(entity, clamp(data.trust ?? 0.1, 0, 1), clamp(data.affection ?? 0.1, 0, 1));
    }
  }

  // ── Commands ─────────────────────────────────────────────

  getCommand(input) {
    return this.db.prepare('SELECT * FROM commands WHERE input = ?').get(input);
  }

  learnCommand(input, category = 'custom') {
    const existing = this.getCommand(input);
    if (existing) {
      this.db.prepare('UPDATE commands SET attempts = attempts + 1 WHERE id = ?').run(existing.id);
      return existing;
    }
    this.db.prepare('INSERT INTO commands (input, category) VALUES (?, ?)').run(input, category);
    return this.getCommand(input);
  }

  markCommandLearned(id) {
    this.db.prepare('UPDATE commands SET understood = 1, learned_at = ? WHERE id = ?').run(now(), id);
  }

  // ── Reactions ────────────────────────────────────────────

  logReaction({ pes_action, reactor, reaction_type, reaction_value, weight, platform }) {
    this.db.prepare(`
      INSERT INTO reaction_memory (pes_action, reactor, reaction_type, reaction_value, weight, platform)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(pes_action, reactor, reaction_type, reaction_value || null, weight || 0, platform || null);
  }

  // ── Stickers ─────────────────────────────────────────────

  learnSticker({ file_id, file_unique_id, set_name, emoji, emotion_key }) {
    const existing = this.db.prepare('SELECT * FROM learned_stickers WHERE file_unique_id = ?').get(file_unique_id);
    if (existing) {
      this.db.prepare('UPDATE learned_stickers SET times_seen = times_seen + 1 WHERE id = ?').run(existing.id);
      return existing;
    }
    this.db.prepare(`
      INSERT INTO learned_stickers (file_id, file_unique_id, set_name, emoji, emotion_key)
      VALUES (?, ?, ?, ?, ?)
    `).run(file_id, file_unique_id, set_name || null, emoji || null, emotion_key || null);
    return this.db.prepare('SELECT * FROM learned_stickers WHERE file_unique_id = ?').get(file_unique_id);
  }

  getStickerByEmotion(emotion) {
    return this.db.prepare(
      'SELECT * FROM learned_stickers WHERE emotion_key = ? ORDER BY preference_score DESC, times_seen DESC LIMIT 5'
    ).all(emotion);
  }

  updateStickerPreference(file_unique_id, delta) {
    this.db.prepare('UPDATE learned_stickers SET preference_score = preference_score + ? WHERE file_unique_id = ?').run(delta, file_unique_id);
  }

  // ── Sticker discovery ────────────────────────────────────

  discoverStickerSet(set_name, source = 'owner') {
    this.db.prepare('INSERT OR IGNORE INTO sticker_discovery (set_name, source) VALUES (?, ?)').run(set_name, source);
  }

  getDiscoveredSets() {
    return this.db.prepare('SELECT * FROM sticker_discovery ORDER BY match_score DESC').all();
  }

  // ── Emojis ───────────────────────────────────────────────

  learnEmoji(emoji, owner_sent = false) {
    const existing = this.db.prepare('SELECT * FROM learned_emojis WHERE emoji = ?').get(emoji);
    if (existing) {
      this.db.prepare('UPDATE learned_emojis SET times_seen = times_seen + 1, owner_sent = MAX(owner_sent, ?) WHERE id = ?')
        .run(owner_sent ? 1 : 0, existing.id);
      return;
    }
    this.db.prepare('INSERT INTO learned_emojis (emoji, owner_sent) VALUES (?, ?)').run(emoji, owner_sent ? 1 : 0);
  }

  getTopOwnerEmojis(limit = 5) {
    return this.db.prepare(
      'SELECT emoji FROM learned_emojis WHERE owner_sent = 1 ORDER BY times_seen DESC LIMIT ?'
    ).all(limit).map(r => r.emoji);
  }

  // ── Notes (Level 3) ─────────────────────────────────────

  addNote(ownerId, text, tags = [], category = null) {
    this.db.prepare(`
      INSERT INTO owner_notes (owner_id, text, tags, category) VALUES (?, ?, ?, ?)
    `).run(ownerId, text, JSON.stringify(tags), category);
  }

  searchNotes(queryOrOwnerId, optsOrQuery) {
    // Compat: old API is searchNotes(query, {owner_id, limit}), new is searchNotes(ownerId, query)
    let ownerId, query, limit;
    if (typeof optsOrQuery === 'object' && optsOrQuery !== null) {
      // Old style: searchNotes(query, {owner_id, limit})
      query = queryOrOwnerId;
      ownerId = optsOrQuery.owner_id;
      limit = optsOrQuery.limit || 10;
    } else {
      // New style: searchNotes(ownerId, query)
      ownerId = queryOrOwnerId;
      query = optsOrQuery;
      limit = 10;
    }
    return this.db.prepare(`
      SELECT * FROM owner_notes WHERE owner_id = ? AND is_deleted = 0 AND text LIKE ?
      ORDER BY created_at DESC LIMIT ?
    `).all(ownerId, `%${query}%`, limit);
  }

  getNotes(ownerId, limit = 10) {
    return this.db.prepare(`
      SELECT * FROM owner_notes WHERE owner_id = ? AND is_deleted = 0
      ORDER BY created_at DESC LIMIT ?
    `).all(ownerId, limit);
  }

  // ── Reminders (Level 4) ──────────────────────────────────

  addReminder(text, remindAt) {
    this.db.prepare('INSERT INTO reminders (text, remind_at) VALUES (?, ?)').run(text, remindAt);
  }

  getPendingReminders() {
    return this.db.prepare(`
      SELECT * FROM reminders WHERE delivered = 0 AND remind_at <= ?
    `).all(now());
  }

  markReminderDelivered(id) {
    this.db.prepare('UPDATE reminders SET delivered = 1, delivered_at = ? WHERE id = ?').run(now(), id);
  }

  // ── Files (Level 6) ──────────────────────────────────────

  saveFile({ ownerId, file_id, file_unique_id, file_type, file_name, description, tags }) {
    this.db.prepare(`
      INSERT OR IGNORE INTO owner_files (owner_id, telegram_file_id, telegram_file_unique_id, file_type, file_name, description, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ownerId, file_id, file_unique_id, file_type || 'document', file_name || null, description || null, JSON.stringify(tags || []));
  }

  searchFiles(ownerId, query) {
    return this.db.prepare(`
      SELECT * FROM owner_files WHERE owner_id = ? AND is_deleted = 0 AND (file_name LIKE ? OR description LIKE ? OR tags LIKE ?)
      ORDER BY created_at DESC LIMIT 10
    `).all(ownerId, `%${query}%`, `%${query}%`, `%${query}%`);
  }

  // ── Contacts (Level 8) ──────────────────────────────────

  addContact(ownerId, { name, phone, email, birthday, relationship, notes }) {
    this.db.prepare(`
      INSERT INTO owner_contacts (owner_id, name, phone, email, birthday, relationship, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ownerId, name, phone || null, email || null, birthday || null, relationship || null, notes || null);
  }

  searchContacts(ownerId, query) {
    return this.db.prepare(`
      SELECT * FROM owner_contacts WHERE owner_id = ? AND is_deleted = 0 AND (name LIKE ? OR phone LIKE ? OR notes LIKE ?)
      ORDER BY name LIMIT 10
    `).all(ownerId, `%${query}%`, `%${query}%`, `%${query}%`);
  }

  // ── Sessions ─────────────────────────────────────────────

  startSession() {
    this.db.prepare('INSERT INTO sessions DEFAULT VALUES').run();
    const stats = this.getStats();
    this.updateStats({ session_count: (stats.session_count || 0) + 1 });
    return this.db.prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT 1').get();
  }

  endSession(id, interactionsCount, xpEarned) {
    this.db.prepare('UPDATE sessions SET ended_at = ?, interactions_count = ?, xp_earned = ? WHERE id = ?')
      .run(now(), interactionsCount, xpEarned, id);
  }

  // ── Babble state ─────────────────────────────────────────

  saveBabbleState(data) {
    this.db.prepare(`
      UPDATE babble_state SET
        invented_sounds = ?, owner_emojis = ?, sound_memory = ?, updated_at = ?
      WHERE id = 1
    `).run(
      JSON.stringify(data.invented_sounds || []),
      JSON.stringify(data.owner_emojis || []),
      JSON.stringify(data.sound_memory || []),
      now()
    );
  }

  getBabbleState() {
    const row = this.db.prepare('SELECT * FROM babble_state WHERE id = 1').get();
    if (!row) return { invented_sounds: [], owner_emojis: [], sound_memory: [] };
    return {
      invented_sounds: JSON.parse(row.invented_sounds || '[]'),
      owner_emojis: JSON.parse(row.owner_emojis || '[]'),
      sound_memory: JSON.parse(row.sound_memory || '[]'),
    };
  }

  // ── Letters ──────────────────────────────────────────────

  createLetter(type, recipient, content) {
    this.db.prepare('INSERT INTO letters (letter_type, recipient, content) VALUES (?, ?, ?)')
      .run(type, recipient, typeof content === 'string' ? content : JSON.stringify(content));
  }

  // ── Snapshot (for transfer/export) ───────────────────────

  createSnapshot() {
    return {
      stats: this.getStats(),
      config: this.db.prepare('SELECT * FROM config').all(),
      unlocks: this.getUnlocks(),
      interactions_count: this.db.prepare('SELECT COUNT(*) as c FROM interactions').get().c,
      relationships: this.db.prepare('SELECT * FROM relationships').all(),
      commands: this.db.prepare('SELECT * FROM commands WHERE understood = 1').all(),
      babble: this.getBabbleState(),
    };
  }

  // ── Compatibility layer (telegram.js calls these) ────────
  // Minimal impls — telegram.js v1 API surface. All actively used.

  getOriginByFileId() { return null; }
  markEmojiUsed() {}
  getLearnedEmojis(opts = {}) {
    try {
      const limit = opts?.limit || 20;
      if (opts?.owner_only) {
        return this.db.prepare('SELECT * FROM learned_emojis WHERE owner_sent = 1 ORDER BY times_seen DESC LIMIT ?').all(limit);
      }
      return this.db.prepare('SELECT * FROM learned_emojis ORDER BY times_seen DESC LIMIT ?').all(limit);
    } catch { return []; }
  }
  getLearnedStickers(opts = {}) {
    try {
      const limit = opts?.limit || 20;
      return this.db.prepare('SELECT * FROM learned_stickers ORDER BY times_seen DESC LIMIT ?').all(limit);
    } catch { return []; }
  }
  getMainCollectionPack() { return null; }
  setMainCollectionPack() {}
  incrementPackStickerCount() {}
  saveCreatedPack() {}
  getCreatedPacks() { return []; }
  saveStickerOrigin() {}
  getCustomEmojiStickers() { return []; }
  getStickersByRelevance({ emotion_key, limit } = {}) {
    if (!emotion_key) return [];
    return this.getStickerByEmotion(emotion_key).slice(0, limit || 5);
  }
  markStickerUsed(fileUniqueId) {
    try { this.db.prepare('UPDATE learned_stickers SET times_used = times_used + 1 WHERE file_unique_id = ?').run(fileUniqueId); } catch {}
  }
  recordPattern() {}
  getTopPatterns() { return []; }
  getExplorablePacks() { return []; }
  getUntriedStickersFromPack() { return []; }
  saveDiscovery() {}
  markStickerTried() {}
  incrementDiscoveryTried() {}
  recalculatePreference() {}
  getStickerCount() {
    try { return this.db.prepare('SELECT COUNT(*) as c FROM learned_stickers').get()?.c || 0; } catch { return 0; }
  }
  getNoteCount() {
    try { return this.db.prepare('SELECT COUNT(*) as c FROM owner_notes WHERE is_deleted = 0').get()?.c || 0; } catch { return 0; }
  }
  getAgeDays() {
    const stats = this.getStats();
    if (!stats?.created_at) return 0;
    return Math.floor((Date.now() - new Date(stats.created_at).getTime()) / 86400000);
  }
  saveNote({ owner_id, text, tags, category, pinned, source_message_id, remind_at }) {
    this.db.prepare(`
      INSERT INTO owner_notes (owner_id, text, tags, category, pinned, remind_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(owner_id, text, JSON.stringify(tags || []), category || null, pinned ? 1 : 0, remind_at || null);
    return true;
  }
  createReminder(text, remindAt) {
    this.addReminder(text, remindAt);
  }
  getDueReminders() {
    return this.db.prepare(`
      SELECT * FROM reminders WHERE delivered = 0 AND remind_at <= ?
    `).all(now());
  }
  getDueNoteReminders() {
    return this.db.prepare(`
      SELECT * FROM owner_notes WHERE remind_at IS NOT NULL AND remind_sent = 0 AND is_deleted = 0 AND remind_at <= ?
    `).all(now());
  }
  markNoteReminderSent(id) {
    this.db.prepare('UPDATE owner_notes SET remind_sent = 1 WHERE id = ?').run(id);
  }
  getUpcomingNoteReminders(minutes = 30) {
    const future = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    return this.db.prepare(`
      SELECT * FROM owner_notes WHERE remind_at IS NOT NULL AND remind_sent = 0 AND is_deleted = 0 AND remind_at <= ? AND remind_at > ?
    `).all(future, now());
  }
  deleteNote(id) {
    this.db.prepare('UPDATE owner_notes SET is_deleted = 1 WHERE id = ?').run(id);
  }

  // ── Pet Friendships (Level 10) ──────────────────────────

  sendFriendRequest(friendChatId, petName, breed = null) {
    this.db.prepare(`
      INSERT OR IGNORE INTO pet_friendships (friend_chat_id, friend_pet_name, friend_breed, status)
      VALUES (?, ?, ?, 'pending')
    `).run(String(friendChatId), petName, breed);
  }

  acceptFriendRequest(friendChatId) {
    this.db.prepare(`
      UPDATE pet_friendships SET status = 'accepted', last_interaction = ?
      WHERE friend_chat_id = ? AND status = 'pending'
    `).run(now(), String(friendChatId));
  }

  rejectFriendRequest(friendChatId) {
    this.db.prepare(`
      UPDATE pet_friendships SET status = 'rejected'
      WHERE friend_chat_id = ? AND status = 'pending'
    `).run(String(friendChatId));
  }

  getFriendship(friendChatId) {
    return this.db.prepare('SELECT * FROM pet_friendships WHERE friend_chat_id = ?').get(String(friendChatId));
  }

  getFriends() {
    return this.db.prepare("SELECT * FROM pet_friendships WHERE status = 'accepted' ORDER BY trust_level DESC").all();
  }

  getPendingFriendRequests() {
    return this.db.prepare("SELECT * FROM pet_friendships WHERE status = 'pending' ORDER BY created_at DESC").all();
  }

  removeFriend(friendChatId) {
    this.db.prepare('DELETE FROM pet_friendships WHERE friend_chat_id = ?').run(String(friendChatId));
  }

  sendGift(friendChatId, giftType, giftName, giftEmoji, moodEffect = 0.05) {
    this.db.prepare(`
      INSERT INTO pet_gifts (direction, friend_chat_id, gift_type, gift_name, gift_emoji, mood_effect)
      VALUES ('sent', ?, ?, ?, ?, ?)
    `).run(String(friendChatId), giftType, giftName, giftEmoji, moodEffect);
    this.db.prepare(`
      UPDATE pet_friendships SET gifts_sent = gifts_sent + 1, trust_level = MIN(1.0, trust_level + 0.02), last_interaction = ?
      WHERE friend_chat_id = ?
    `).run(now(), String(friendChatId));
  }

  receiveGift(friendChatId, giftType, giftName, giftEmoji, moodEffect = 0.05) {
    this.db.prepare(`
      INSERT INTO pet_gifts (direction, friend_chat_id, gift_type, gift_name, gift_emoji, mood_effect)
      VALUES ('received', ?, ?, ?, ?, ?)
    `).run(String(friendChatId), giftType, giftName, giftEmoji, moodEffect);
    this.db.prepare(`
      UPDATE pet_friendships SET gifts_received = gifts_received + 1, trust_level = MIN(1.0, trust_level + 0.03), last_interaction = ?
      WHERE friend_chat_id = ?
    `).run(now(), String(friendChatId));
  }

  getGiftHistory(friendChatId = null, limit = 20) {
    if (friendChatId) {
      return this.db.prepare('SELECT * FROM pet_gifts WHERE friend_chat_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(String(friendChatId), limit);
    }
    return this.db.prepare('SELECT * FROM pet_gifts ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  getFriendCount() {
    try { return this.db.prepare("SELECT COUNT(*) as c FROM pet_friendships WHERE status = 'accepted'").get()?.c || 0; } catch { return 0; }
  }

  // ── Daily Streaks ──────────────────────────────────────

  updateStreak() {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const row = this.db.prepare('SELECT * FROM daily_streaks WHERE id = 1').get();
    if (!row) {
      this.db.prepare('INSERT OR IGNORE INTO daily_streaks (id) VALUES (1)').run();
      this.db.prepare('UPDATE daily_streaks SET current_streak = 1, longest_streak = 1, last_active_date = ?, total_active_days = 1 WHERE id = 1').run(today);
      return { current: 1, longest: 1, isNew: true, total: 1 };
    }

    if (row.last_active_date === today) {
      return { current: row.current_streak, longest: row.longest_streak, isNew: false, total: row.total_active_days };
    }

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let newStreak;
    if (row.last_active_date === yesterday) {
      newStreak = row.current_streak + 1;
    } else {
      newStreak = 1; // streak broken
    }
    const newLongest = Math.max(row.longest_streak, newStreak);
    const newTotal = row.total_active_days + 1;

    this.db.prepare('UPDATE daily_streaks SET current_streak = ?, longest_streak = ?, last_active_date = ?, total_active_days = ? WHERE id = 1')
      .run(newStreak, newLongest, today, newTotal);

    return { current: newStreak, longest: newLongest, isNew: true, total: newTotal };
  }

  getStreak() {
    const row = this.db.prepare('SELECT * FROM daily_streaks WHERE id = 1').get();
    if (!row) return { current: 0, longest: 0, total: 0 };
    return { current: row.current_streak, longest: row.longest_streak, total: row.total_active_days, lastDate: row.last_active_date };
  }

  // ── Achievements ──────────────────────────────────────

  _seedAchievements() {
    const ACHIEVEMENTS = [
      { key: 'first_message',    name: 'Первое слово',       desc: 'Первое сообщение',                   emoji: '💬', cat: 'social',   threshold: 1 },
      { key: 'msg_100',          name: 'Болтун',             desc: '100 сообщений',                      emoji: '🗣️', cat: 'social',   threshold: 100 },
      { key: 'msg_1000',         name: 'Тысячник',           desc: '1000 сообщений',                     emoji: '📢', cat: 'social',   threshold: 1000 },
      { key: 'feed_50',          name: 'Кормилец',           desc: 'Покормил 50 раз',                    emoji: '🍖', cat: 'care',     threshold: 50 },
      { key: 'praise_30',        name: 'Добрый хозяин',      desc: '30 похвал',                          emoji: '❤️', cat: 'care',     threshold: 30 },
      { key: 'level_5',          name: 'Юниор',              desc: 'Достигнуть уровня 5',                emoji: '⭐', cat: 'growth',   threshold: 5 },
      { key: 'level_10',         name: 'Мастер',             desc: 'Достигнуть уровня 10',               emoji: '🌟', cat: 'growth',   threshold: 10 },
      { key: 'streak_7',         name: 'Неделя вместе',      desc: 'Streak 7 дней подряд',               emoji: '🔥', cat: 'streak',   threshold: 7 },
      { key: 'streak_30',        name: 'Месяц верности',     desc: 'Streak 30 дней подряд',              emoji: '💎', cat: 'streak',   threshold: 30 },
      { key: 'notes_10',         name: 'Записная книжка',    desc: 'Сохранить 10 заметок',               emoji: '📝', cat: 'ability',  threshold: 10 },
    ];
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO achievements (key, name, description, emoji, category, threshold) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const tx = this.db.transaction(() => {
      for (const a of ACHIEVEMENTS) {
        insert.run(a.key, a.name, a.desc, a.emoji, a.cat, a.threshold);
      }
    });
    tx();
  }

  checkAchievements(context = {}) {
    const stats = this.getStats();
    const streak = this.getStreak();
    const noteCount = this.getNoteCount();
    const newlyUnlocked = [];

    const checks = {
      first_message:  stats.interactions_total >= 1,
      msg_100:        stats.interactions_total >= 100,
      msg_1000:       stats.interactions_total >= 1000,
      feed_50:        (context.feedCount || this._countActions('feed')) >= 50,
      praise_30:      stats.times_praised >= 30,
      level_5:        Math.floor(stats.level) >= 5,
      level_10:       Math.floor(stats.level) >= 10,
      streak_7:       streak.current >= 7,
      streak_30:      streak.current >= 30,
      notes_10:       noteCount >= 10,
    };

    const progressValues = {
      first_message:  stats.interactions_total,
      msg_100:        stats.interactions_total,
      msg_1000:       stats.interactions_total,
      feed_50:        context.feedCount || this._countActions('feed'),
      praise_30:      stats.times_praised,
      level_5:        Math.floor(stats.level),
      level_10:       Math.floor(stats.level),
      streak_7:       streak.current,
      streak_30:      streak.current,
      notes_10:       noteCount,
    };

    for (const [key, met] of Object.entries(checks)) {
      const progress = progressValues[key] || 0;
      // Update progress
      this.db.prepare('UPDATE achievements SET progress = ? WHERE key = ? AND unlocked = 0').run(progress, key);

      if (met) {
        const row = this.db.prepare('SELECT * FROM achievements WHERE key = ? AND unlocked = 0').get(key);
        if (row) {
          this.db.prepare('UPDATE achievements SET unlocked = 1, unlocked_at = ?, progress = ? WHERE key = ?')
            .run(now(), progress, key);
          newlyUnlocked.push({ key, name: row.name, emoji: row.emoji, description: row.description });
        }
      }
    }

    return newlyUnlocked;
  }

  _countActions(actionType) {
    try {
      const row = this.db.prepare("SELECT COUNT(*) as c FROM interactions WHERE action_detail = ?").get(actionType);
      return row?.c || 0;
    } catch { return 0; }
  }

  getAchievements() {
    return this.db.prepare('SELECT * FROM achievements ORDER BY unlocked DESC, category, threshold').all();
  }

  getUnlockedAchievements() {
    return this.db.prepare('SELECT * FROM achievements WHERE unlocked = 1 ORDER BY unlocked_at DESC').all();
  }

  getAchievementProgress() {
    const all = this.getAchievements();
    const unlocked = all.filter(a => a.unlocked);
    return { total: all.length, unlocked: unlocked.length, achievements: all };
  }

  // ── Cleanup ──────────────────────────────────────────────

  close() {
    if (this._checkpointInterval) clearInterval(this._checkpointInterval);
    try { this.db.close(); } catch (_) {}
  }
}

export default MemoryStore;
export { UNLOCK_TREE, TRAITS, PHASE_THRESHOLDS };
