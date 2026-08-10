/**
 * PES v2 — Main Controller (Level-Unlock Architecture)
 *
 * The BODY of PES. Wires all subsystems together:
 *   store (MemoryStore) + emotions (EmotionState) + babble (BabbleEngine)
 *   + tick loop (heartbeat) + level-unlock controller
 *
 * ES module. No triggers.js, symbols.js, or expression-engine.js.
 * All expression logic handled by babble-engine; telegram adapter handles stickers.
 */

import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { EmotionState, STATES, buildUnlockedSet } from '../soul/emotions.js';
import { BabbleEngine } from '../soul/babble-engine.js';
import MemoryStore from '../memory/store.js';

// ── XP Awards ────────────────────────────────────────────────
const XP = {
  message:         1,
  praise:          3,
  scold:          -1,
  sticker:         2,
  reaction:        1,
  command_learned: 8,
  dialogue_bonus:  2,
};

// ── Tick Intervals (ms) ──────────────────────────────────────
const TICK_INTERVALS = {
  active:   30_000,       // 30s  — owner present
  idle:     5 * 60_000,   // 5min — nearby but nothing
  sleeping: 15 * 60_000,  // 15min — dreams
  away:     30 * 60_000,  // 30min — owner left
};

// ── Silence thresholds for auto-mode (ms) ────────────────────
const SILENCE = {
  toIdle:     2 * 60_000,   // 2min silence → idle
  toSleeping: 15 * 60_000,  // 15min silence → sleeping
  toAway:     60 * 60_000,  // 1h silence → away
};

// ── Trait seeding profiles ───────────────────────────────────
const TRAIT_PROFILES = [
  { max: 0.2,  traits: { courage: 0.85, aggression: 0.7, playfulness: 0.4, sass: 0.3, curiosity_trait: 0.5 } },
  { max: 0.4,  traits: { curiosity_trait: 0.85, playfulness: 0.8, courage: 0.5, drama: 0.3, loyalty: 0.5 } },
  { max: 0.6,  traits: { courage: 0.5, curiosity_trait: 0.5, loyalty: 0.5, playfulness: 0.5, drama: 0.4 } },
  { max: 0.8,  traits: { loyalty: 0.85, stubbornness: 0.75, courage: 0.6, playfulness: 0.4, sass: 0.3 } },
  { max: 1.01, traits: { drama: 0.85, sass: 0.8, playfulness: 0.6, curiosity_trait: 0.6, stubbornness: 0.4 } },
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }


class Pes extends EventEmitter {
  /**
   * @param {object} config
   * @param {string} config.name       — e.g. 'Тор'
   * @param {string} config.ownerId    — telegram user id
   * @param {string} config.dbPath     — path to SQLite file
   * @param {string} config.breed      — e.g. 'corgi'
   * @param {number} config.seed       — 0-1, personality seed
   * @param {boolean} [config.autoTick=true]
   */
  constructor(config) {
    super();
    this.name     = config.name;
    this.ownerId  = config.ownerId;
    this.dbPath   = config.dbPath;
    this.breed    = config.breed || 'corgi';
    this.seed     = clamp(config.seed ?? 0.5, 0, 1);
    this.autoTick = config.autoTick !== false;

    // Subsystems — initialized in birth() or wake()
    this.store    = null;
    this.emotions = null;
    this.babble   = null;

    // Tick state
    this._tickMode    = 'idle';
    this._tickTimer   = null;
    this._lastEventAt = Date.now();
    this._alive       = false;
    this.silentMode   = false;  // toggled by /silent command
  }

  // ── Compatibility getters (telegram.js expects these) ────

  get level() {
    return this.store?.getStats()?.level || 0;
  }

  get mood() {
    return this.emotions?.mood ?? 0.5;
  }

  get traits() {
    if (!this.store) return {};
    const stats = this.store.getStats();
    return stats?.traits || {};
  }

  /** Compat: telegram.js checks pes.engine?.silentMode */
  get engine() {
    return { silentMode: this.silentMode };
  }

  /** Compat: telegram.js checks pes.identity?.seed */
  get identity() {
    return { seed: this.seed };
  }

  // ════════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ════════════════════════════════════════════════════════════

  /**
   * First-time init: create DB, seed traits, start ticking.
   */
  birth() {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.store = new MemoryStore(this.dbPath);
    this.store.init();

    // Seed initial stats if fresh
    const stats = this.store.getStats();
    if (!stats || stats.xp === 0) {
      this._seedTraits();
      this.store.setConfig('name', this.name);
      this.store.setConfig('breed', this.breed);
      this.store.setConfig('owner_id', this.ownerId);
      this.store.setConfig('seed', String(this.seed));
      this.store.setConfig('born_at', new Date().toISOString());
    }

    // Init emotion engine with level-0 unlocks
    const level = stats?.level || 0;
    this.emotions = new EmotionState(buildUnlockedSet(level));
    this._seedEmotionTraits();

    // Init babble engine
    const unlockedSounds = this._getUnlockedSounds();
    this.babble = new BabbleEngine(this.seed, unlockedSounds);

    this._alive = true;
    if (this.autoTick) this._startTick('active');

    this.emit('born', { name: this.name, breed: this.breed });
    return this;
  }

  /**
   * Resume from saved state: load emotions, apply passive time decay.
   */
  wake() {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.store = new MemoryStore(this.dbPath);
    this.store.init();

    const stats = this.store.getStats();
    const level = stats?.level || 0;

    // Restore emotions
    const savedEmotion = this.store.getConfig('emotion_state');
    if (savedEmotion) {
      try {
        const data = JSON.parse(savedEmotion);
        this.emotions = EmotionState.deserialize(data, buildUnlockedSet(level));
      } catch {
        this.emotions = new EmotionState(buildUnlockedSet(level));
      }
    } else {
      this.emotions = new EmotionState(buildUnlockedSet(level));
    }

    // Restore babble
    const unlockedSounds = this._getUnlockedSounds();
    const savedBabble = this.store.getConfig('babble_state');
    if (savedBabble) {
      try {
        const data = JSON.parse(savedBabble);
        this.babble = BabbleEngine.deserialize(data, this.seed);
        this.babble.setUnlockedSounds(unlockedSounds);
      } catch {
        this.babble = new BabbleEngine(this.seed, unlockedSounds);
      }
    } else {
      this.babble = new BabbleEngine(this.seed, unlockedSounds);
    }

    // Apply passive time decay since last checkpoint
    const minutesSleeping = this._calcSleepMinutes();
    if (minutesSleeping > 0) {
      this.emotions.passiveTick(minutesSleeping);
    }

    this._alive = true;
    if (this.autoTick) this._startTick('idle');

    this.emit('wake', { name: this.name, minutesSleeping });
    return this;
  }

  /**
   * Save state, stop ticking.
   */
  sleep() {
    this._checkpoint();
    this._stopTick();
    this._alive = false;
    this.emit('sleep', {});
  }

  /**
   * Cleanup intervals, close DB.
   */
  destroy() {
    this._stopTick();
    this._alive = false;
    if (this.store) {
      try { this._checkpoint(); } catch (e) { console.error('[PES] checkpoint on destroy failed:', e.message); }
      this.store.close();
      this.store = null;
    }
    this.removeAllListeners();
  }

  // ════════════════════════════════════════════════════════════
  //  CORE API
  // ════════════════════════════════════════════════════════════

  /**
   * Main event entry point — trigger event → emotion change → XP → emit expression.
   * @param {{ type: string, from: string, data: any }} evt
   */
  event(evt) {
    if (!this._alive) return null;
    // Compat: crm-bridge sends {type, source, detail}, telegram sends {type, from, content}
    const type = evt.type;
    const from = evt.from || evt.source || this.ownerId;
    const data = evt.data || evt.detail || evt.content;

    this._lastEventAt = Date.now();
    this._ensureTickMode('active');

    // Emotion interaction tick
    this.emotions.interactionTick(type);
    this.emotions.reduceLoneliness(0.1);

    // XP
    const xpAmount = XP[type] ?? XP.message;
    const xpResult = this.store.addXP(xpAmount, type, typeof data === 'string' ? data : null);

    // Log interaction
    const emoBefore = this.emotions.state;
    this.store.logInteraction({
      actor: from || this.ownerId,
      action_type: type,
      action_detail: typeof data === 'string' ? data.slice(0, 200) : null,
      emotion_before: emoBefore,
      emotion_after: this.emotions.state,
      xp_gained: xpAmount,
    });

    // Update relationship
    if (from) {
      this.store.upsertRelationship(from, {
        trust: type === 'praise' ? 0.02 : 0.005,
        affection: type === 'praise' ? 0.03 : 0.01,
      });
    }

    // Check level-up and unlocks
    if (xpResult.levelUp) {
      this._onLevelUp(xpResult.level, xpResult.phase);
    }

    // Daily streak
    let streakResult = null;
    try { streakResult = this.store.updateStreak(); } catch (e) { console.error('[PES] streak error:', e.message); }

    // Streak bonus XP (new day = +5 XP bonus per streak day, max +25)
    if (streakResult?.isNew && streakResult.current > 1) {
      const bonus = Math.min(streakResult.current * 5, 25);
      this.store.addXP(bonus, 'streak_bonus', `streak:${streakResult.current}`);
    }

    // Check achievements
    let newAchievements = [];
    try { newAchievements = this.store.checkAchievements(); } catch (e) { console.error('[PES] achievements error:', e.message); }

    // Emit achievement events
    for (const ach of newAchievements) {
      this.emit('achievement', ach);
    }

    // Generate expression
    const expression = this._express();
    this.emit('expression', expression);

    return { xp: xpResult, expression, streak: streakResult, achievements: newAchievements };
  }

  /**
   * Positive feedback → mood up, trust up, XP+3.
   */
  praise() {
    this.emotions.adjustMood(0.15);
    this.emotions.nudgeTrait('loyalty', 0.02, 'praise');
    this.emotions.nudgeTrait('playfulness', 0.01, 'praise');

    this.emotions.transitionTo('happy', null, 'praise')
      || this.emotions.transitionTo('butt_wiggle', null, 'praise');

    return this.event({ type: 'praise', from: this.ownerId, data: 'praise' });
  }

  /**
   * Negative feedback → mood down, XP-1.
   */
  scold() {
    this.emotions.adjustMood(-0.1);
    this.emotions.nudgeTrait('courage', -0.01, 'scold');

    this.emotions.transitionTo('scared', null, 'scold')
      || this.emotions.transitionTo('sulking', null, 'scold');

    return this.event({ type: 'scold', from: this.ownerId, data: 'scold' });
  }

  /**
   * Feed with data/task → hunger down.
   * @param {number|object} quality — 0 to 1, or {type, content} for compat
   */
  feed(quality = 0.5) {
    // Compat: telegram.js passes {type: 'text', content: '...'}
    const q = typeof quality === 'object' ? 0.5 : quality;
    this.emotions.feed(q);
    return this.event({ type: 'message', from: this.ownerId, data: 'feed' });
  }

  /**
   * Collect feedback/reaction from owner.
   * @param {{ reaction_type: string, reaction_value: string, platform: string }} opts
   */
  react({ reaction_type, reaction_value, platform }) {
    this.store.logReaction({
      pes_action: this.emotions.state,
      reactor: this.ownerId,
      reaction_type,
      reaction_value,
      weight: reaction_value === 'positive' ? 1 : reaction_value === 'negative' ? -1 : 0,
      platform,
    });
    return this.event({ type: 'reaction', from: this.ownerId, data: reaction_type });
  }

  /**
   * Teach or use a command.
   * @param {string} input — command text
   * @param {boolean|object} success — true/false or {target: '...'} for compat
   */
  command(input, success = false) {
    // Compat: telegram.js passes {target: '...'} as second arg
    const isSuccess = typeof success === 'boolean' ? success : false;
    const cmd = this.store.learnCommand(input);
    if (isSuccess && cmd && !cmd.understood) {
      this.store.markCommandLearned(cmd.id);
      return this.event({ type: 'command_learned', from: this.ownerId, data: input });
    }
    return this.event({ type: 'message', from: this.ownerId, data: `cmd:${input}` });
  }

  /**
   * Full status snapshot.
   * @returns {{ name, level, phase, emotion, vitals, traits, unlocks, ... }}
   */
  status() {
    const stats = this.store?.getStats() || {};
    const emo = this.emotions || {};
    const unlocks = this.store?.getUnlockedFeatures() || [];
    const next = this.store?.getNextUnlock(stats.level) || null;
    const ageDays = this.store?.getAgeDays() || 0;

    // Flat structure for telegram.js compat
    return {
      name: this.name,
      breed: this.breed,
      level: stats.level || 0,
      xp: stats.xp || 0,
      phase: stats.phase || 'puppy',
      // Flat vitals (telegram.js expects s.mood, s.energy, etc.)
      mood: emo.mood ?? 0.5,
      energy: emo.energy ?? 0.8,
      hunger: emo.hunger ?? 0.2,
      curiosity: emo.curiosity ?? 0.5,
      loneliness: emo.loneliness ?? 0,
      // Emotion
      emotion: emo.state || 'idle',
      intensity: emo.intensity || 0.5,
      // Nested vitals (for code that uses s.vitals.mood)
      vitals: {
        mood: emo.mood ?? 0.5,
        energy: emo.energy ?? 0.8,
        hunger: emo.hunger ?? 0.2,
        curiosity: emo.curiosity ?? 0.5,
        loneliness: emo.loneliness ?? 0,
      },
      traits: emo.traits || {},
      age: ageDays,
      unlocks,
      nextUnlock: next ? { feature: next.feature, level: next.level_req } : null,
      tickMode: this._tickMode,
      alive: this._alive,
      streak: this.store?.getStreak() || { current: 0, longest: 0, total: 0 },
      achievements: this.store?.getAchievementProgress() || { total: 0, unlocked: 0, achievements: [] },
    };
  }

  // ════════════════════════════════════════════════════════════
  //  TICK SYSTEM (heartbeat)
  // ════════════════════════════════════════════════════════════

  _startTick(mode) {
    this._stopTick();
    this._tickMode = mode;
    const interval = TICK_INTERVALS[mode] || TICK_INTERVALS.idle;
    this._tickTimer = setInterval(() => this._tick(), interval);
  }

  _stopTick() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  _tick() {
    if (!this._alive || !this.emotions) return;

    const silenceMs = Date.now() - this._lastEventAt;

    // Auto-mode transition based on silence duration
    const newMode = this._silenceToMode(silenceMs);
    if (newMode !== this._tickMode) {
      this._startTick(newMode);
    }

    // Passive tick — cap at 5 minutes per tick to avoid vitals spike
    const minutesPassed = Math.floor(silenceMs / 60_000);
    if (minutesPassed > 0) {
      this.emotions.passiveTick(Math.min(minutesPassed, 5));
    }

    // Periodic checkpoint
    if (this.emotions.tickCount % 10 === 0) {
      this._checkpoint();
    }
  }

  _silenceToMode(ms) {
    if (ms < SILENCE.toIdle) return 'active';
    if (ms < SILENCE.toSleeping) return 'idle';
    if (ms < SILENCE.toAway) return 'sleeping';
    return 'away';
  }

  _ensureTickMode(mode) {
    if (this._tickMode !== mode) {
      this._startTick(mode);
    }
  }

  // ════════════════════════════════════════════════════════════
  //  LEVEL-UNLOCK CONTROLLER
  // ════════════════════════════════════════════════════════════

  /**
   * Called on every level-up. Checks for new unlocks, updates subsystems.
   */
  _onLevelUp(level, phase) {
    const floorLevel = Math.floor(level);

    this.emit('level_up', { level: floorLevel, phase });

    // Find features that just became available at this exact level
    const allUnlocks = this.store.getUnlocks();
    const justUnlocked = allUnlocks.filter(u =>
      u.unlocked === 1 && u.level_req === floorLevel
    );

    for (const u of justUnlocked) {
      this.emit('unlock', {
        feature: u.feature,
        level: u.level_req,
        category: u.category,
      });
    }

    // Update emotion FSM with newly unlocked emotions
    const newEmotionSet = buildUnlockedSet(floorLevel);
    this.emotions.setUnlockedEmotions(newEmotionSet);

    // Update babble engine with newly unlocked sound tiers
    const sounds = this._getUnlockedSounds();
    this.babble.setUnlockedSounds(sounds);

    // End critical period at level 5 (traits become resistant to change)
    if (floorLevel >= 5 && !this.emotions.criticalPeriodOver) {
      this.emotions.endCriticalPeriod();
    }
  }

  /**
   * Get list of unlocked sound-tier feature names for babble engine.
   */
  _getUnlockedSounds() {
    if (!this.store) return [];
    const features = this.store.getUnlockedFeatures();
    const soundFeatures = [
      'babble_tier0', 'combo_phrases', 'babble_tier1', 'babble_tier2',
      'babble_tier3', 'sound_invention', 'advanced_babble', 'crypto_language',
    ];
    return features.filter(f => soundFeatures.includes(f));
  }

  // ════════════════════════════════════════════════════════════
  //  EXPRESSION GENERATOR
  // ════════════════════════════════════════════════════════════

  /**
   * Generate an expression object from current emotional state.
   * Emitted as 'expression' event for platform adapters (telegram).
   */
  _express() {
    const stats = this.store.getStats();
    const level = Math.floor(stats?.level || 0);
    const emoState = this.emotions.state;
    const intensity = this.emotions.intensity;

    const babble = this.babble.generate(level, emoState, intensity);
    const stickerHint = this._stickerHint(emoState, intensity);

    return {
      emotion: emoState,
      intensity,
      babble,
      sticker_hint: stickerHint,
    };
  }

  /**
   * Map emotion + intensity to a sticker hint category.
   * The telegram adapter uses this to pick from learned sticker sets.
   */
  _stickerHint(emotion, intensity) {
    const cat = STATES[emotion]?.category || 'baseline';
    if (cat === 'happy' && intensity > 0.6) return 'excited';
    if (cat === 'happy') return 'happy';
    if (cat === 'social') return 'social';
    if (cat === 'working') return 'focused';
    if (cat === 'dramatic') return 'dramatic';
    if (cat === 'stress') return 'scared';
    if (cat === 'rest') return 'sleepy';
    if (cat === 'rare' && emotion === 'food_obsessed') return 'hungry';
    if (cat === 'rare') return 'sneaky';
    return 'neutral';
  }

  // ════════════════════════════════════════════════════════════
  //  TRAIT SEEDING
  // ════════════════════════════════════════════════════════════

  /**
   * Seed initial trait values from config.seed deterministically.
   */
  _seedTraits() {
    const profile = TRAIT_PROFILES.find(p => this.seed < p.max) || TRAIT_PROFILES[2];
    const stats = this.store.getStats();
    if (!stats) return;

    const updates = {};
    for (const [key, val] of Object.entries(profile.traits)) {
      // Deterministic jitter from seed
      const jitter = (this.seed * 7.31 % 0.2) - 0.1;
      updates[key] = clamp(val + jitter, 0, 1);
    }
    this.store.updateStats(updates);
  }

  /**
   * Copy stored traits into emotion engine (used on birth/wake).
   */
  _seedEmotionTraits() {
    if (!this.emotions || !this.store) return;
    const stats = this.store.getStats();
    if (!stats?.traits) return;

    const mapping = {
      courage:        'courage',
      curiosity_trait: 'curiosity',
      loyalty:        'loyalty',
      stubbornness:   'stubbornness',
      playfulness:    'playfulness',
      drama:          'drama',
      food_obsession: 'foodDrive',
      sass:           'sassiness',
    };

    for (const [storeKey, emotionKey] of Object.entries(mapping)) {
      if (stats.traits[storeKey] !== undefined) {
        this.emotions.setTrait(emotionKey, stats.traits[storeKey]);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  //  STATE PERSISTENCE
  // ════════════════════════════════════════════════════════════

  /**
   * Save current state to DB (emotions, babble, vitals).
   */
  _checkpoint() {
    if (!this.store || !this.emotions) return;

    try {
      // Emotion state
      this.store.setConfig('emotion_state', JSON.stringify(this.emotions.serialize()));

      // Babble state
      if (this.babble) {
        this.store.setConfig('babble_state', JSON.stringify(this.babble.serialize()));
      }

      // Timestamp for sleep-duration calc
      this.store.setConfig('last_checkpoint', new Date().toISOString());

      // Vitals to stats table
      const emo = this.emotions.current;
      this.store.updateStats({
        mood: emo.mood,
        energy: emo.energy,
        hunger: emo.hunger,
        loneliness: emo.loneliness,
      });
    } catch (e) { console.error('[PES] _checkpoint failed:', e.message); }
  }

  /**
   * Calculate how many minutes PES was sleeping since last checkpoint.
   */
  _calcSleepMinutes() {
    if (!this.store) return 0;
    const lastStr = this.store.getConfig('last_checkpoint');
    if (!lastStr) return 0;
    const last = new Date(lastStr).getTime();
    if (isNaN(last)) return 0;
    return Math.max(0, Math.floor((Date.now() - last) / 60_000));
  }
}


export default Pes;
export { Pes, XP, TICK_INTERVALS, TRAIT_PROFILES };
