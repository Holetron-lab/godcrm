// ============================================================
// PES Platform — Base Adapter
// ============================================================
// Abstract base class for platform adapters.
//
// PES "speaks" through adapters. Each platform (Telegram, Web,
// Discord, Console) has its own adapter that translates
// internal expressions (bodyKey + voiceKey + glyphKeys) into
// platform-native output (stickers, animations, sounds, text).
//
// The adapter also COLLECTS reactions from the owner/group and
// feeds them back into pes.react() — completing the feedback loop.
//
// Media Registry:
//   Adapters DON'T contain media. They load media packs —
//   mappings from internal keys to platform resources
//   (file_ids, URLs, paths). Swap sticker pack = swap registry.
//
// Telegram sticker packs:
//   Telegram Bot API allows using ANY public sticker pack.
//   getStickerSet(name) → stickers with file_id.
//   No need for custom art for MVP — use existing corgi packs.
//
// Lifecycle:
//   Adapter subscribes to PES events (expression, born, runaway,
//   levelUp, etc.) and reacts platform-specifically.
// ============================================================

import { EventEmitter } from 'node:events';

// ── RENDER MODES ────────────────────────────────────────────

const RENDER_MODE = {
  FULL:    'full',     // body + voice + glyphs (default)
  COMPACT: 'compact',  // glyphs only (inline display)
  RICH:    'rich',     // sticker + text + reaction (Telegram-style)
  DEBUG:   'debug',    // everything + internal state
};

// ── PRESENCE STATES ─────────────────────────────────────────

const PRESENCE = {
  ONLINE:  'online',
  TYPING:  'typing',
  IDLE:    'idle',
  SLEEPING: 'sleeping',
  OFFLINE: 'offline',
};

// ── MEDIA TYPES ─────────────────────────────────────────────

const MEDIA_TYPE = {
  STICKER:    'sticker',
  ANIMATION:  'animation',   // GIF / Lottie / TGS
  SOUND:      'sound',
  IMAGE:      'image',
  EMOJI:      'emoji',       // custom emoji (Telegram Premium)
  REACTION:   'reaction',    // emoji reaction on message
};


// ── BASE ADAPTER ────────────────────────────────────────────

class PesPlatformAdapter extends EventEmitter {
  /**
   * @param {Pes}    pes    — PES instance to connect to
   * @param {Object} config
   * @param {string} config.platformName — 'telegram', 'web', 'discord', 'console'
   * @param {string} [config.renderMode] — RENDER_MODE (default: FULL)
   * @param {boolean} [config.autoListen] — auto-subscribe to PES events (default: true)
   */
  constructor(pes, config = {}) {
    super();

    if (!pes) throw new Error('PesPlatformAdapter requires a Pes instance');

    this.pes = pes;
    this.platformName = config.platformName || 'unknown';
    this.renderMode = config.renderMode || RENDER_MODE.FULL;
    this.autoListen = config.autoListen !== false;

    // Media registry: { type → { key → resource } }
    this.media = {
      [MEDIA_TYPE.STICKER]:   {},
      [MEDIA_TYPE.ANIMATION]: {},
      [MEDIA_TYPE.SOUND]:     {},
      [MEDIA_TYPE.IMAGE]:     {},
      [MEDIA_TYPE.EMOJI]:     {},
      [MEDIA_TYPE.REACTION]:  {},
    };

    // Message tracking: expressionId → platformMessageId
    // Needed for feedback loop: when owner reacts to a message,
    // we look up which expression it was about.
    this.messageMap = new Map();
    this.messageMapMaxSize = 500;

    // Delivery stats
    this.stats = {
      sent: 0,
      failed: 0,
      reactions: 0,
    };

    // Connected flag
    this._connected = false;

    // Delivery throttle
    this._lastDeliveryTime = 0;

    // PES event subscriptions (stored for cleanup)
    this._pesListeners = [];

    // Auto-subscribe to PES events
    if (this.autoListen) {
      this._subscribeToPes();
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ABSTRACT METHODS — must be implemented by subclasses
  // ══════════════════════════════════════════════════════════════

  /**
   * Send a rendered expression to the platform.
   * @param {Object} output — formatted output from renderExpression()
   * @returns {Promise<string|null>} — platform message ID (for tracking), or null
   */
  async sendMessage(output) {
    throw new Error(`${this.platformName}: sendMessage() not implemented`);
  }

  /**
   * Start collecting reactions from the platform.
   * Should call this.onUserReaction() when a reaction is detected.
   */
  async startCollecting() {
    throw new Error(`${this.platformName}: startCollecting() not implemented`);
  }

  /**
   * Stop collecting reactions.
   */
  async stopCollecting() {
    throw new Error(`${this.platformName}: stopCollecting() not implemented`);
  }

  /**
   * Set presence/status on the platform.
   * @param {string} state — PRESENCE constant
   */
  async setPresence(state) {
    // Default: no-op. Override in subclasses that support presence.
  }

  // ══════════════════════════════════════════════════════════════
  // MEDIA REGISTRY
  // ══════════════════════════════════════════════════════════════

  /**
   * Register a single media resource.
   * @param {string} type — MEDIA_TYPE constant
   * @param {string} key  — internal key (bodyKey, voiceKey, emotion name)
   * @param {*}      resource — platform-specific resource (file_id, URL, path, etc.)
   */
  registerMedia(type, key, resource) {
    if (!this.media[type]) {
      this.media[type] = {};
    }
    this.media[type][key] = resource;
  }

  /**
   * Get a media resource by type and key.
   * @returns {*|null}
   */
  getMedia(type, key) {
    return this.media[type]?.[key] || null;
  }

  /**
   * Load a full media pack (bulk registration).
   * @param {Object} pack — { sticker: { key: resource, ... }, animation: { ... }, ... }
   */
  loadMediaPack(pack) {
    for (const [type, entries] of Object.entries(pack)) {
      if (!this.media[type]) this.media[type] = {};
      for (const [key, resource] of Object.entries(entries)) {
        this.media[type][key] = resource;
      }
    }
  }

  /**
   * Load stickers from a Telegram sticker pack name.
   * Subclass (telegram.js) should override this.
   * @param {string} packName — Telegram sticker pack name
   * @param {Object} mapping  — { stickerIndex: internalKey } or auto-detect
   */
  async loadStickerPack(packName, mapping = {}) {
    throw new Error(`${this.platformName}: loadStickerPack() not implemented — use telegram.js`);
  }

  /**
   * Check if a media resource exists.
   * @returns {boolean}
   */
  hasMedia(type, key) {
    return !!this.media[type]?.[key];
  }

  /**
   * Get all registered keys for a media type.
   * @returns {string[]}
   */
  getMediaKeys(type) {
    return Object.keys(this.media[type] || {});
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════

  /**
   * Render an ExpressionResult into platform-native output.
   * Uses current renderMode. Can be overridden for custom rendering.
   *
   * @param {ExpressionResult} result — from ExpressionEngine
   * @returns {Object} — { text, sticker, animation, sound, reaction, meta }
   */
  renderExpression(result) {
    if (!result || !result.expression) return null;

    const expr = result.expression;
    const mode = this.renderMode;

    const output = {
      text: null,
      sticker: null,
      animation: null,
      sound: null,
      reaction: null,
      notify: result.shouldNotify || false,
      priority: result.priority,
      expressionId: result.id,
      meta: {
        bodyKey: expr.bodyKey,
        voiceKey: expr.voiceKey,
        emotion: result.emotionSnapshot?.state,
      },
    };

    // ── Format body → sticker/animation ──
    if (mode !== RENDER_MODE.COMPACT) {
      output.sticker = this.formatBody(expr.bodyKey, result);
      output.animation = this.formatAnimation(expr.bodyKey, result);
    }

    // ── Format voice → sound/text ──
    if (mode !== RENDER_MODE.COMPACT) {
      const voice = this.formatVoice(expr.voiceKey, result);
      if (voice) {
        if (typeof voice === 'object' && voice.sound) {
          output.sound = voice.sound;
          output.meta.voiceText = voice.text;
        } else {
          output.meta.voiceText = voice;
        }
      }
    }

    // ── Format glyphs → text ──
    output.text = this.formatGlyphs(expr.glyphKeys, result);

    // ── Format reaction (emoji to put on owner's message) ──
    output.reaction = this.formatReaction(result);

    // ── Debug mode: add internal state ──
    if (mode === RENDER_MODE.DEBUG) {
      output.meta.emotion = result.emotionSnapshot;
      output.meta.triggerName = result.triggerName;
      output.meta.combo = result.combo;
      output.meta.suppressed = result.suppressed;
      output.meta.expression = expr.toJSON();
      output.meta.platformHints = result.platformHints;
    }

    // ── Rich mode: prefer sticker over text ──
    if (mode === RENDER_MODE.RICH) {
      // If we have a sticker, text becomes caption (shorter)
      if (output.sticker && output.text) {
        output.meta.caption = output.text;
        // Keep text for platforms that can't show stickers
      }
    }

    return output;
  }

  /**
   * Format bodyKey → sticker resource.
   * Checks media registry first, falls back to expression's renderBody().
   * @returns {*|null} — sticker resource or null
   */
  formatBody(bodyKey, result) {
    if (!bodyKey) return null;

    // Check media registry for a sticker mapped to this bodyKey
    const sticker = this.getMedia(MEDIA_TYPE.STICKER, bodyKey);
    if (sticker) return sticker;

    // Check if there's a sticker for the emotion
    const emotion = result?.emotionSnapshot?.current;
    if (emotion) {
      const emotionSticker = this.getMedia(MEDIA_TYPE.STICKER, emotion);
      if (emotionSticker) return emotionSticker;
    }

    // No sticker — return visual text from expression
    return result?.expression?.renderBody?.() || null;
  }

  /**
   * Format bodyKey → animation resource (GIF/Lottie).
   * @returns {*|null}
   */
  formatAnimation(bodyKey, result) {
    if (!bodyKey) return null;

    const anim = this.getMedia(MEDIA_TYPE.ANIMATION, bodyKey);
    if (anim) return anim;

    const emotion = result?.emotionSnapshot?.current;
    if (emotion) {
      return this.getMedia(MEDIA_TYPE.ANIMATION, emotion) || null;
    }

    return null;
  }

  /**
   * Format voiceKey → sound resource or text representation.
   * @returns {Object|string|null} — { sound, text } or text string
   */
  formatVoice(voiceKey, result) {
    if (!voiceKey) return null;

    const sound = this.getMedia(MEDIA_TYPE.SOUND, voiceKey);
    const voiceText = result?.expression?.renderVoice?.() || null;

    if (sound) {
      return { sound, text: voiceText };
    }

    // No sound file — return text representation
    return voiceText;
  }

  /**
   * Format glyphKeys → emoji/symbol string.
   * Checks media registry for custom emoji replacements.
   * @returns {string|null}
   */
  formatGlyphs(glyphKeys, result) {
    if (!glyphKeys || glyphKeys.length === 0) return null;

    // Check if we have custom emoji for any glyph
    const parts = [];
    let hasCustom = false;

    for (const key of glyphKeys) {
      const customEmoji = this.getMedia(MEDIA_TYPE.EMOJI, key);
      if (customEmoji) {
        parts.push(customEmoji);
        hasCustom = true;
      } else {
        // Fall through to default rendering
        parts.push(null);
      }
    }

    // If we have ANY custom emoji, mix them with defaults
    if (hasCustom) {
      const defaultRendered = result?.expression?.renderGlyphs?.() || '';
      const defaultChars = [...defaultRendered];
      // Replace nulls with default characters
      let charIdx = 0;
      const finalParts = [];
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] !== null) {
          finalParts.push(parts[i]);
          charIdx++; // skip the default char
        } else if (charIdx < defaultChars.length) {
          finalParts.push(defaultChars[charIdx]);
          charIdx++;
        }
      }
      return finalParts.join('');
    }

    // All default — use expression's own renderer
    return result?.expression?.renderGlyphs?.() || null;
  }

  /**
   * Format a reaction emoji for the owner's last message.
   * PES can "react" to owner's message with an emoji.
   * @returns {string|null} — emoji string or null
   */
  formatReaction(result) {
    if (!result) return null;

    // Check platform hints first
    const hint = result.platformHints?.reaction;
    if (hint) return hint;

    // Check if we have a reaction mapped to this emotion
    const emotion = result?.emotionSnapshot?.current;
    if (emotion) {
      return this.getMedia(MEDIA_TYPE.REACTION, emotion) || null;
    }

    return null;
  }

  // ══════════════════════════════════════════════════════════════
  // DELIVERY
  // ══════════════════════════════════════════════════════════════

  /**
   * Full delivery pipeline: render → send → track.
   * @param {ExpressionResult} result
   * @returns {Promise<boolean>} — success
   */
  async deliver(result) {
    if (!result) return false;
    if (result.suppressed) return false;

    // Throttle: min interval between messages (prevents chat flooding)
    const now = Date.now();
    const minInterval = result.priority >= 75 ? 5_000 :   // HIGH/CRITICAL: 5s
                        result.priority >= 50 ? 15_000 :   // NORMAL: 15s
                        60_000;                             // LOW/AMBIENT: 60s
    if (this._lastDeliveryTime && (now - this._lastDeliveryTime) < minInterval) {
      return false; // skip — too soon
    }
    this._lastDeliveryTime = now;

    try {
      // 1. Render to platform format
      const output = this.renderExpression(result);
      if (!output) return false;

      // 2. Send to platform
      const messageId = await this.sendMessage(output);

      // 3. Track for feedback
      if (messageId && result.id) {
        this.trackMessage(result.id, messageId);
      }

      this.stats.sent++;
      this.emit('delivered', { expressionId: result.id, messageId });
      return true;

    } catch (err) {
      this.stats.failed++;
      this.emit('deliveryFailed', { expressionId: result.id, error: err.message });
      return false;
    }
  }

  /**
   * Start listening to PES 'expression' events and auto-deliver.
   * Also starts collecting reactions from the platform.
   */
  async startListening() {
    this._connected = true;

    // Start collecting reactions from platform
    try {
      await this.startCollecting();
    } catch (_) {
      // Some platforms don't support reaction collecting
    }

    // Set initial presence
    try {
      const mode = this.pes.mode;
      const presenceMap = {
        active: PRESENCE.ONLINE,
        idle: PRESENCE.IDLE,
        sleeping: PRESENCE.SLEEPING,
        away: PRESENCE.OFFLINE,
      };
      await this.setPresence(presenceMap[mode] || PRESENCE.ONLINE);
    } catch (_) {}

    this.emit('listening');
  }

  /**
   * Stop listening and disconnect.
   */
  async stopListening() {
    this._connected = false;

    try {
      await this.stopCollecting();
    } catch (_) {}

    try {
      await this.setPresence(PRESENCE.OFFLINE);
    } catch (_) {}

    this.emit('stopped');
  }

  // ══════════════════════════════════════════════════════════════
  // FEEDBACK BRIDGE
  // ══════════════════════════════════════════════════════════════

  /**
   * Called when owner/group reacts to a PES message on the platform.
   * Finds the expression and feeds reaction back to PES.
   *
   * @param {string} platformMessageId — platform-specific message ID
   * @param {string} reaction         — emoji or text
   * @param {string} userId           — who reacted
   * @param {Object} [extra]          — { isOwner, speed_ms, type }
   */
  onUserReaction(platformMessageId, reaction, userId, extra = {}) {
    // Find expression by platform message ID
    const expressionId = this._lookupExpression(platformMessageId);
    if (!expressionId) {
      // Unknown message — might be a message PES didn't send
      return;
    }

    // Determine reaction type
    const reactionType = extra.type || this._classifyReaction(reaction);
    const isOwner = extra.isOwner !== undefined ? extra.isOwner : (userId === this.pes?.ownerId);

    // Feed back to PES
    try {
      this.pes.react(expressionId, {
        from: isOwner ? 'owner' : `group:${userId}`,
        type: reactionType,
        value: reaction,
        speed_ms: extra.speed_ms || null,
      });

      this.stats.reactions++;
      this.emit('reactionProcessed', { expressionId, reaction, userId });

    } catch (err) {
      this.emit('reactionError', { expressionId, error: err.message });
    }
  }

  /**
   * Track a message: expressionId → platformMessageId.
   * Keeps the map bounded (FIFO eviction).
   */
  trackMessage(expressionId, platformMessageId) {
    // Evict oldest if at capacity
    if (this.messageMap.size >= this.messageMapMaxSize) {
      const firstKey = this.messageMap.keys().next().value;
      this.messageMap.delete(firstKey);
    }
    this.messageMap.set(platformMessageId, expressionId);
  }

  // ══════════════════════════════════════════════════════════════
  // LIFECYCLE HANDLERS
  // ══════════════════════════════════════════════════════════════
  // Override these in subclasses for platform-specific behavior.

  /**
   * Called when PES is born.
   * @param {Object} data — { name, ownerId, personality }
   */
  async onBorn(data) {
    // Default: deliver a "born" expression if available
    this.emit('lifecycle', { event: 'born', data });
  }

  /**
   * Called when PES wakes up.
   */
  async onWake(data) {
    this.emit('lifecycle', { event: 'wake', data });
    try {
      await this.setPresence(PRESENCE.ONLINE);
    } catch (_) {}
  }

  /**
   * Called when PES goes to sleep.
   */
  async onSleep(data) {
    this.emit('lifecycle', { event: 'sleep', data });
    try {
      await this.setPresence(PRESENCE.SLEEPING);
    } catch (_) {}
  }

  /**
   * Called when PES runs away. IRREVERSIBLE.
   * @param {Object} data — { letter, snapshot }
   */
  async onRunaway(data) {
    this.emit('lifecycle', { event: 'runaway', data });
    try {
      await this.setPresence(PRESENCE.OFFLINE);
    } catch (_) {}
  }

  /**
   * Called when PES levels up.
   * @param {Object} data — { oldLevel, newLevel, xp }
   */
  async onLevelUp(data) {
    this.emit('lifecycle', { event: 'levelUp', data });
  }

  /**
   * Called when PES mode changes.
   * @param {Object} data — { oldMode, newMode }
   */
  async onModeChange(data) {
    const presenceMap = {
      active: PRESENCE.ONLINE,
      idle: PRESENCE.IDLE,
      sleeping: PRESENCE.SLEEPING,
      away: PRESENCE.OFFLINE,
    };
    try {
      await this.setPresence(presenceMap[data?.newMode] || PRESENCE.ONLINE);
    } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER MODE
  // ══════════════════════════════════════════════════════════════

  /**
   * Set render mode.
   * @param {string} mode — RENDER_MODE constant
   */
  setRenderMode(mode) {
    if (Object.values(RENDER_MODE).includes(mode)) {
      this.renderMode = mode;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // GETTERS
  // ══════════════════════════════════════════════════════════════

  get isConnected() {
    return this._connected;
  }

  get deliveryStats() {
    return { ...this.stats };
  }

  get trackedMessages() {
    return this.messageMap.size;
  }

  // ══════════════════════════════════════════════════════════════
  // INTERNAL
  // ══════════════════════════════════════════════════════════════

  /**
   * Subscribe to PES events and route to lifecycle handlers + delivery.
   */
  _subscribeToPes() {
    const listen = (event, handler) => {
      this.pes.on(event, handler);
      this._pesListeners.push({ event, handler });
    };

    // Auto-deliver expressions
    listen('expression', async (result) => {
      if (this._connected) {
        await this.deliver(result);
      }
    });

    // Lifecycle events
    listen('born',       (data) => this.onBorn(data));
    listen('wake',       (data) => this.onWake(data));
    listen('sleep',      (data) => this.onSleep(data));
    listen('runaway',    (data) => this.onRunaway(data));
    listen('levelUp',    (data) => this.onLevelUp(data));
    listen('modeChange', (data) => this.onModeChange(data));
  }

  /**
   * Unsubscribe from PES events.
   */
  _unsubscribeFromPes() {
    for (const { event, handler } of this._pesListeners) {
      this.pes.removeListener(event, handler);
    }
    this._pesListeners = [];
  }

  /**
   * Lookup expressionId by platform message ID.
   * @returns {string|null}
   */
  _lookupExpression(platformMessageId) {
    return this.messageMap.get(platformMessageId) || null;
  }

  /**
   * Classify a reaction string into a type.
   * @returns {string} — 'emoji_positive', 'emoji_negative', 'text', 'emoji_neutral'
   */
  _classifyReaction(reaction) {
    if (!reaction) return 'silence';

    const positive = ['👍', '❤️', '🔥', '😂', '🎉', '💯', '⭐', '👏', '💪', '😍', '🥰', '😊', '👌', '✅', '💚', '💛', '🧡'];
    const negative = ['👎', '😡', '🤬', '💩', '❌', '😤', '🙄', '😠', '👊', '🚫'];

    if (positive.includes(reaction)) return 'emoji_positive';
    if (negative.includes(reaction)) return 'emoji_negative';

    // Check if it's an emoji (single char with high unicode)
    if (reaction.length <= 4 && /\p{Emoji}/u.test(reaction)) return 'emoji_neutral';

    // It's text
    return 'text';
  }

  /**
   * Cleanup — unsubscribe, clear tracking.
   */
  destroy() {
    this._unsubscribeFromPes();
    this.messageMap.clear();
    this._connected = false;
    this.removeAllListeners();
  }
}


export {
  PesPlatformAdapter,
  RENDER_MODE,
  PRESENCE,
  MEDIA_TYPE,
};
